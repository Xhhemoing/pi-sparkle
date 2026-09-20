import { DomainValidationError } from "../domain/errors.js";
import { createAgentProfileRegistry, defaultAgentProfiles } from "../agents/registry.js";
import { createTaskId, type RunId } from "../domain/ids.js";
import type { AgentExecutor } from "../execution/contract.js";
import {
  closeClosedLoop,
  openClosedLoop,
  runClosedLoopCheck,
  type ClosedLoopResult,
  type ClosedLoopSession
} from "../execution/closed-loop.js";
import type { ClosedLoopAcceptance } from "../execution/acceptance.js";
import { saveLoopArtifact, type LoopArtifactRef } from "../execution/loop-artifact.js";
import { createWorktreeCodingTools } from "../pi-adapter/worktree-coding-tools.js";
import { startParentRun, type RunningRun } from "../run/coordinator.js";
import type { ChildTaskInput } from "../run/child-coordinator.js";
import {
  prepareNativeWrite,
  type NativeWritePreflight,
  type NativeWritePreflightInput,
  type NativeWriteVerificationInput
} from "./write-preflight.js";

export interface NativeWriteTool {
  readonly name: string;
  readonly execute: (toolCallId: string, params: unknown, signal?: AbortSignal) => Promise<unknown>;
}

export interface NativeWriteExecutorFactoryInput {
  readonly candidatePath: string;
  readonly sourceRevision: string;
  readonly objective: string;
  readonly tools: readonly NativeWriteTool[];
  readonly signal: AbortSignal;
}

export type NativeWriteExecutorFactory =
  (input: NativeWriteExecutorFactoryInput) => AgentExecutor | Promise<AgentExecutor>;

export interface NativeWriteSessionOptions {
  readonly stateRoot: string;
  readonly executorFactory: NativeWriteExecutorFactory;
  readonly sandboxRoot?: string;
}

export interface NativeWriteSessionInput {
  readonly sourceRepo: string;
  readonly objective: string;
  readonly verification: NativeWriteVerificationInput;
  readonly signal?: AbortSignal;
}

export interface NativeWriteSessionResult {
  readonly runId: RunId;
  readonly status: "COMPLETED" | "FAILED" | "CANCELLED";
  readonly candidatePath: string;
  readonly sourceRevision: string;
  readonly artifact: LoopArtifactRef;
  readonly acceptance: ClosedLoopAcceptance;
  readonly reason: string;
  readonly executionEvents: number;
}

interface ActiveWrite {
  readonly controller: AbortController;
  readonly cancel: () => void;
  running: RunningRun | undefined;
  promise?: Promise<NativeWriteSessionResult>;
}

function verificationArgs(input: NativeWriteVerificationInput): readonly string[] {
  return input.args === undefined ? [] : [...input.args];
}

function stopReason(closed: boolean, signal: AbortSignal): "shutdown" | "cancelled" | undefined {
  if (closed) return "shutdown";
  if (signal.aborted) return "cancelled";
  return undefined;
}

function resultStatus(status: string): "COMPLETED" | "FAILED" | "CANCELLED" {
  if (status === "COMPLETED") return "COMPLETED";
  if (status === "CANCELLED") return "CANCELLED";
  return "FAILED";
}

function failedAcceptance(
  preflight: NativeWritePreflight,
  candidatePath: string,
  artifactHash: string,
  reason: string
): ClosedLoopAcceptance {
  return {
    artifactHash,
    revision: preflight.revision,
    cwd: candidatePath,
    command: preflight.verification.command,
    args: [...preflight.verification.args],
    accepted: false,
    reason
  };
}

function implementerTask(objective: string, registry: ReturnType<typeof createAgentProfileRegistry>): ChildTaskInput {
  return {
    taskId: createTaskId(),
    role: "implementer",
    objective,
    profile: registry.resolve("implementer"),
    inputArtifactIds: [],
    acceptanceCriteria: [],
    limits: { maxAttempts: 1, timeoutMs: 300_000, maxWallTimeMs: 300_000 }
  };
}

function acceptedResult(
  preflight: NativeWritePreflight,
  session: ClosedLoopSession,
  checked: ClosedLoopResult,
  runId: RunId,
  executionEvents: number
): NativeWriteSessionResult {
  return {
    runId,
    status: checked.acceptance.accepted ? "COMPLETED" : "FAILED",
    candidatePath: session.worktree.cwd,
    sourceRevision: preflight.revision,
    artifact: checked.artifact,
    acceptance: checked.acceptance,
    reason: checked.acceptance.accepted ? "accepted" : checked.acceptance.reason,
    executionEvents
  };
}

function failedExecutor(reason: string): AgentExecutor {
  return {
    async *execute() {
      // The parent coordinator turns this into a durable FAILED run. The
      // original factory error is retained in the native-write artifact.
      void reason;
      yield { type: "EXECUTION_FINISHED", outcome: "FAILURE" };
    }
  };
}

/**
 * Runs one implementer in a retained detached worktree. The source checkout
 * is never the mutable target, and only a successful host check can accept it.
 */
export class NativeWriteSession {
  private readonly active = new Set<ActiveWrite>();
  private closed = false;

  constructor(private readonly options: NativeWriteSessionOptions) {}

  get activeCount(): number {
    return this.active.size;
  }

  execute(input: NativeWriteSessionInput): Promise<NativeWriteSessionResult> {
    if (this.closed) {
      return Promise.reject(new DomainValidationError("native write session is shut down"));
    }

    const controller = new AbortController();
    if (input.signal?.aborted) controller.abort();
    const combinedSignal = input.signal === undefined
      ? controller.signal
      : AbortSignal.any([input.signal, controller.signal]);
    let active!: ActiveWrite;
    active = {
      controller,
      running: undefined,
      cancel: () => {
        controller.abort();
        active.running?.cancel();
      }
    };
    this.active.add(active);

    const onAbort = (): void => active.cancel();
    input.signal?.addEventListener("abort", onAbort, { once: true });
    const operation = this.executeInternal(input, combinedSignal, active).finally(() => {
      input.signal?.removeEventListener("abort", onAbort);
      this.active.delete(active);
    });
    active.promise = operation;
    return operation;
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    const active = [...this.active];
    for (const operation of active) operation.cancel();
    await Promise.allSettled(active.flatMap((operation) =>
      operation.promise === undefined ? [] : [operation.promise]
    ));
  }

  private async executeInternal(
    input: NativeWriteSessionInput,
    signal: AbortSignal,
    active: ActiveWrite
  ): Promise<NativeWriteSessionResult> {
    const preflightInput: NativeWritePreflightInput = { ...input, signal };
    const preflight = prepareNativeWrite(preflightInput);
    const beforeWorktreeStop = stopReason(this.closed, signal);
    if (beforeWorktreeStop !== undefined) {
      throw new DomainValidationError(`native write ${beforeWorktreeStop}`);
    }

    const session = await openClosedLoop({
      sourceRepo: preflight.sourceRepo,
      ...(this.options.sandboxRoot !== undefined ? { sandboxRoot: this.options.sandboxRoot } : {})
    });
    if (session.revisionAtStart !== preflight.revision) {
      await this.disposeBeforeRun(session);
      throw new DomainValidationError("source revision changed between preflight and worktree allocation");
    }
    const afterWorktreeStop = stopReason(this.closed, signal);
    if (afterWorktreeStop !== undefined) {
      // No run exists to retain evidence for. A pre-execution cancellation
      // removes only this session-owned worktree and never touches the source.
      await this.disposeBeforeRun(session);
      throw new DomainValidationError(`native write ${afterWorktreeStop}`);
    }

    // A clean check before worktree allocation cannot observe a user edit that
    // races with `git worktree add`. Recheck before the factory gets any tools
    // so a late source change is refused before model execution.
    try {
      const afterAllocation = prepareNativeWrite({
        sourceRepo: preflight.sourceRepo,
        objective: preflight.objective,
        verification: preflight.verification,
        signal
      });
      if (afterAllocation.revision !== preflight.revision) {
        throw new DomainValidationError("source revision changed before executor allocation");
      }
    } catch (error) {
      await this.disposeBeforeRun(session);
      throw error;
    }

    const tools = createWorktreeCodingTools({ worktreeRoot: session.worktree.cwd })
      .filter((tool) => tool.name === "sparkle_read_file" || tool.name === "sparkle_write_file");
    let factoryError: string | undefined;
    let executor: AgentExecutor;
    try {
      executor = await this.options.executorFactory({
        candidatePath: session.worktree.cwd,
        sourceRevision: preflight.revision,
        objective: preflight.objective,
        tools,
        signal
      });
    } catch (error) {
      factoryError = error instanceof Error ? error.message : String(error);
      executor = failedExecutor(factoryError);
    }
    const factoryStop = stopReason(this.closed, signal);
    if (factoryStop !== undefined) {
      await this.disposeBeforeRun(session);
      throw new DomainValidationError(`native write ${factoryStop}`);
    }

    const registry = createAgentProfileRegistry(defaultAgentProfiles());
    const running = startParentRun({ stateRoot: this.options.stateRoot, executor }, {
      projectRoot: session.worktree.cwd,
      objective: preflight.objective,
      children: [implementerTask(preflight.objective, registry)]
    });
    active.running = running;
    const startStop = stopReason(this.closed, signal);
    if (startStop !== undefined) running.cancel();
    const outcome = await running.done;
    active.running = undefined;

    const terminalStop = stopReason(this.closed, signal);
    if (terminalStop !== undefined || outcome.status === "CANCELLED") {
      return this.failureResult(
        preflight,
        session,
        terminalStop === "shutdown" ? "shutdown" : "cancelled",
        {
          runId: outcome.runId,
          status: terminalStop === undefined ? resultStatus(outcome.status) : "CANCELLED",
          events: outcome.events
        }
      );
    }

    if (factoryError !== undefined || outcome.status !== "COMPLETED") {
      const reason = factoryError === undefined
        ? `executor did not complete successfully (status=${outcome.status})`
        : `executor factory failed: ${factoryError}`;
      return this.failureResult(preflight, session, reason, {
        runId: outcome.runId,
        status: "FAILED",
        events: outcome.events
      });
    }

    const beforeCheckStop = stopReason(this.closed, signal);
    if (beforeCheckStop !== undefined) {
      return this.failureResult(preflight, session, beforeCheckStop, {
        runId: outcome.runId,
        status: "CANCELLED",
        events: outcome.events
      });
    }

    let checked;
    try {
      checked = await runClosedLoopCheck({
        session,
        stateRoot: this.options.stateRoot,
        runId: outcome.runId,
        command: preflight.verification.command,
        args: preflight.verification.args,
        note: "native isolated write"
      });
    } catch (error) {
      return this.failureResult(preflight, session, `independent verification failed: ${error instanceof Error ? error.message : String(error)}`, {
        runId: outcome.runId,
        status: "FAILED",
        events: outcome.events
      });
    }
    const afterCheckStop = stopReason(this.closed, signal);
    if (afterCheckStop !== undefined) {
      return this.failureResult(preflight, session, afterCheckStop, {
        runId: outcome.runId,
        status: "CANCELLED",
        events: outcome.events
      });
    }
    return acceptedResult(preflight, session, checked, outcome.runId, outcome.events.length);
  }

  private async disposeBeforeRun(session: ClosedLoopSession): Promise<void> {
    await closeClosedLoop(session).catch(() => undefined);
  }

  private async failureResult(
    preflight: NativeWritePreflight,
    session: ClosedLoopSession,
    reason: string,
    outcome: {
      runId: RunId;
      status: "FAILED" | "CANCELLED" | "COMPLETED";
      events: readonly unknown[];
    }
  ): Promise<NativeWriteSessionResult> {
    const artifact = await saveLoopArtifact({
      stateRoot: this.options.stateRoot,
      runId: outcome.runId,
      body: {
        kind: "native-write-failure",
        objective: preflight.objective,
        sourceRevision: preflight.revision,
        candidatePath: session.worktree.cwd,
        reason,
        executionEvents: outcome.events.length,
        verification: {
          command: preflight.verification.command,
          args: verificationArgs(preflight.verification)
        }
      }
    });
    return {
      runId: outcome.runId,
      status: outcome.status,
      candidatePath: session.worktree.cwd,
      sourceRevision: preflight.revision,
      artifact,
      acceptance: failedAcceptance(preflight, session.worktree.cwd, artifact.sha256, reason),
      reason,
      executionEvents: outcome.events.length
    };
  }
}
