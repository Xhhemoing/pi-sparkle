import { DomainValidationError } from "../domain/errors.js";
import type { ArtifactId, EvidenceId, MessageId } from "../domain/ids.js";
import { nowIso } from "../domain/timestamp.js";
import type { AgentExecutionRequest, AgentExecutor, ExecutionEvent } from "../execution/contract.js";
import { SUPERVISOR } from "../protocol/v1.js";

/**
 * Scripted events, no live loop, and deliberately no `steerText`: a caller who
 * steers a run backed by this executor gets an explicit refusal instead of a
 * no-op that looks like it worked.
 */
export class FakeExecutor implements AgentExecutor {
  constructor(private readonly steps: readonly ExecutionEvent[]) {}

  async *execute(_request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    if (signal.aborted) {
      yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
      return;
    }
    for (const step of this.steps) yield step;
  }
}

/**
 * A run that stays in flight until it is aborted, which makes it the stand-in
 * for anything that has to happen mid-run. It does implement `steerText`,
 * recording each accepted steer in {@link steers}, so the run-level steering
 * path can be exercised without a provider.
 */
export class GatedExecutor implements AgentExecutor {
  sawAbort = false;
  readonly steers: string[] = [];
  readonly started: Promise<void>;
  private inFlight = false;
  private resolveStarted!: () => void;

  constructor() {
    this.started = new Promise<void>((resolve) => {
      this.resolveStarted = resolve;
    });
  }

  steerText(text: string): void {
    if (text.trim() === "") {
      throw new DomainValidationError("steer text must be a non-empty string");
    }
    if (!this.inFlight) {
      throw new DomainValidationError("cannot steer: no agent run is in flight");
    }
    this.steers.push(text);
  }

  async *execute(_request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    this.inFlight = true;
    try {
      yield* this.stream(signal);
    } finally {
      this.inFlight = false;
    }
  }

  private async *stream(signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    this.resolveStarted();
    yield { type: "TEXT_DELTA", text: "working" };
    if (signal.aborted) {
      this.sawAbort = true;
      yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
      return;
    }
    await new Promise<void>((resolve) => {
      signal.addEventListener(
        "abort",
        () => {
          this.sawAbort = true;
          resolve();
        },
        { once: true }
      );
    });
    yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
  }
}

/** Deterministic child that emits a protocol v1 TASK_RESULT, used by `--children`. */
export class ProtocolChildExecutor implements AgentExecutor {
  async *execute(
    request: AgentExecutionRequest,
    signal: AbortSignal
  ): AsyncIterable<ExecutionEvent> {
    if (signal.aborted) {
      yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
      return;
    }
    yield {
      type: "MESSAGE",
      message: {
        protocolVersion: 1,
        id: `msg_fake-${request.agentInstanceId}` as MessageId,
        occurredAt: nowIso(),
        runId: request.runId,
        taskId: request.taskId,
        from: request.agentInstanceId,
        to: SUPERVISOR,
        type: "TASK_RESULT",
        outcome: "SUCCESS",
        summary: "fake child completed the task",
        artifactIds: [`art_fake-${request.taskId}` as ArtifactId],
        evidenceIds: [`evd_fake-${request.taskId}` as EvidenceId],
        verification: { kind: "PASSED", evidenceIds: [`evd_fake-${request.taskId}` as EvidenceId] }
      }
    };
    yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
  }
}
