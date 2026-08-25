import { DomainValidationError } from "../domain/errors.js";
import {
  createAgentInstanceId,
  createEventId,
  createMessageId,
  createRunId,
  type AgentInstanceId,
  type ArtifactId,
  type EvidenceId,
  type IdGenerator,
  type MessageId,
  type RunId,
  type TaskId
} from "../domain/ids.js";
import { defaultRunLimits } from "../domain/limits.js";
import type { ProjectSnapshot } from "../domain/project.js";
import type { Run } from "../domain/run.js";
import type { AcceptanceCriterion } from "../domain/task.js";
import { nowIso, type IsoTimestamp } from "../domain/timestamp.js";
import type { AgentProfile, AgentProfileRegistry } from "../agents/registry.js";
import type { ContextPacket } from "../context/packet.js";
import type { AgentExecutor, ExecutionEvent } from "../execution/contract.js";
import { formatChildPrompt } from "./child-prompt.js";
import { CHILD_CRASH_PREFIX, recordChildCrashTerminal } from "./crash-terminal.js";
import { tryParseModelRef } from "../config/model-ref.js";
import {
  isTerminalMessage,
  SUPERVISOR,
  validateAgentMessage,
  validateApprovalReplyForPlan,
  type AgentMessage,
  type AgentQuestion,
  type ApprovalReply,
  type ChildRunLimits,
  type TaskRequest,
  type TaskResult
} from "../protocol/v1.js";
import { isAgentRole } from "../domain/roles.js";
import type { ClusterHost } from "../cluster/host.js";
import { EventStore } from "./event-store.js";
import type { Event } from "./events.js";
import { classifyTaskFailure } from "../routing/failure-class.js";
import {
  decideLiveCascade,
  evidenceFromTaskResult,
  type LiveCascadePlan
} from "../routing/live-cascade.js";

export interface ChildCoordinatorDeps {
  stateRoot: string;
  executor: AgentExecutor;
  parentRunId: RunId;
  project: ProjectSnapshot;
  registry: AgentProfileRegistry;
  maxConcurrentTasks: number;
  /**
   * Run-level USD ceiling from `RunLimits.maxCostUsd`, applied to every child
   * attempt this coordinator leases. It bounds one execution, not the run:
   * there is no cross-child spend accumulator, so N children under a $X run
   * cap can still spend up to N·$X between them. Undefined stays undefined —
   * a run that named no ceiling must not be handed an invented one.
   */
  maxCostUsd?: number;
  now?: () => IsoTimestamp;
  generateId?: IdGenerator;
  schedule?: (fn: () => void, ms: number) => { cancel(): void };
  /**
   * Supplies an explicit answer when a child asks a QUESTION. Plain text
   * answers a question with no approval plan; a question carrying a plan must
   * be answered with an explicit {@link QuestionResponse} approvalReply.
   */
  onQuestion?: (question: AgentQuestion) => Promise<QuestionResponse> | QuestionResponse;
  /** Optional agent-cluster session for peer mail and spawn. */
  cluster?: ClusterHost;
}

/** A plain answer, or an answer plus the selective approval decision. */
export type QuestionResponse = string | { answer: string; approvalReply?: ApprovalReply };

export interface ChildTaskInput {
  taskId: TaskId;
  role: string;
  objective: string;
  profile: AgentProfile;
  inputArtifactIds: ArtifactId[];
  acceptanceCriteria: AcceptanceCriterion[];
  /**
   * Per-child budget. The coordinator enforces `maxAttempts` (the retry
   * ladder), `timeoutMs` (per attempt), and `maxWallTimeMs` (one deadline for
   * the whole child run). It does **not** enforce `maxCostUsd`: no spend is
   * observable here, so that field is a declaration only — see the disclosure
   * on {@link ChildRunLimits}.
   */
  limits: ChildRunLimits;
  /** Optional predecessor task ids; used when compiling `--children` into a flowchart. */
  dependsOn?: readonly TaskId[];
  /** Model id assigned by smart routing for this child. */
  assignedModel?: string;
  /** First-attempt cascade: escalate only on deterministic model FAIL. */
  cascade?: LiveCascadePlan;
  /** Bounded repo facts compiled at launch; omitted items stay inspectable. */
  contextPacket?: ContextPacket;
  /** Predecessor task summaries so later children do not re-invent findings. */
  predecessorNotes?: readonly string[];
}

export type ChildOutcome = "SUCCESS" | "PARTIAL" | "FAILURE" | "CANCELLED" | "TIMEOUT";

export interface ChildRunOutcome {
  childRunId: RunId;
  taskId: TaskId;
  outcome: ChildOutcome;
  attempts: number;
  summary: string;
  messages: AgentMessage[];
  terminalResult?: TaskResult;
  evidenceIds: EvidenceId[];
  artifactIds: ArtifactId[];
}

export interface ChildRunHandle {
  childRunId: RunId;
  taskId: TaskId;
  done: Promise<ChildRunOutcome>;
  /**
   * Requests cancellation in every window: while the child is queued behind the
   * concurrency gate, while an attempt is live, and between attempts. The
   * request is durable for the lifetime of the child run, so a cancel that
   * lands when no attempt controller exists still settles the child as
   * CANCELLED instead of being dropped.
   */
  cancel(): void;
}

interface AttemptResult {
  timedOut: boolean;
  terminalMessage?: TaskResult;
  executorOutcome?: "SUCCESS" | "FAILURE" | "CANCELLED";
  failureReason?: string;
  messages: AgentMessage[];
}

const SUMMARY_LIMIT = 500;

function bounded(text: string, limit = SUMMARY_LIMIT): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

/** Simple FIFO semaphore enforcing maxConcurrentTasks. */
class ConcurrencyGate {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
  }

  release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next !== undefined) next();
  }
}

/**
 * Accumulates one attempt's validated messages and enforces the at-most-one
 * terminal invariant incrementally. Each message is validated once by the
 * caller and checked against a flag here, so a transcript of n messages costs
 * O(n) validations instead of re-validating the whole prefix per message.
 */
class AttemptTranscript {
  readonly messages: AgentMessage[] = [];
  private sawTerminal = false;

  /** Appends a validated message, rejecting a second terminal TASK_RESULT. */
  accept(message: AgentMessage): void {
    if (isTerminalMessage(message)) {
      if (this.sawTerminal) {
        // Wording pinned against protocol/v1's assertAtMostOneTerminal by
        // test/unit/run/child-coordinator-limits.test.ts.
        throw new DomainValidationError("Duplicate terminal TASK_RESULT message");
      }
      this.sawTerminal = true;
    }
    this.messages.push(message);
  }
}

/** Delays above this are clamped by setTimeout and would fire immediately. */
const MAX_TIMER_MS = 2_147_483_647;

const realSchedule = (fn: () => void, ms: number): { cancel(): void } => {
  const handle = setTimeout(fn, ms);
  return { cancel: () => clearTimeout(handle) };
};

export class ChildCoordinator {
  readonly parentRunId: RunId;
  private readonly executor: AgentExecutor;
  private readonly project: ProjectSnapshot;
  private readonly stateRoot: string;
  private readonly now: () => IsoTimestamp;
  private readonly generateId: IdGenerator | undefined;
  private readonly maxCostUsd: number | undefined;
  private readonly schedule: (fn: () => void, ms: number) => { cancel(): void };
  private readonly gate: ConcurrencyGate;
  private readonly parentAgentInstanceId: AgentInstanceId;
  private readonly parentStore: EventStore;
  private readonly onQuestion:
    | ((question: AgentQuestion) => Promise<QuestionResponse> | QuestionResponse)
    | undefined;
  private readonly cluster: ClusterHost | undefined;
  private readonly childStores = new Map<RunId, EventStore>();

  /** Active attempt controller per child run, for external cancellation. */
  private readonly attemptControllers = new Map<RunId, AbortController>();

  /**
   * Child runs whose cancellation was requested. An attempt controller only
   * exists while an attempt is executing, so the request has to outlive it:
   * `runTask` consults this set after the gate lets the child in and before
   * every attempt.
   */
  private readonly cancelledChildren = new Set<RunId>();
  private readonly questionResolvers = new Map<MessageId, () => void>();
  private readonly pendingQuestionsList: AgentQuestion[] = [];

  constructor(deps: ChildCoordinatorDeps) {
    this.stateRoot = deps.stateRoot;
    this.executor = deps.executor;
    this.project = deps.project;
    this.parentRunId = deps.parentRunId;
    this.now = deps.now ?? nowIso;
    this.generateId = deps.generateId === undefined ? undefined : deps.generateId;
    this.maxCostUsd = deps.maxCostUsd;
    this.schedule = deps.schedule ?? realSchedule;
    this.gate = new ConcurrencyGate(deps.maxConcurrentTasks);
    this.parentAgentInstanceId = createAgentInstanceId(
      deps.generateId === undefined ? undefined : deps.generateId
    );
    this.parentStore = new EventStore(deps.stateRoot, deps.parentRunId);
    this.onQuestion = deps.onQuestion === undefined ? undefined : deps.onQuestion;
    this.cluster = deps.cluster;
  }

  get pendingQuestions(): readonly AgentQuestion[] {
    return [...this.pendingQuestionsList];
  }

  /**
   * Supplies an explicit user answer for a previously received QUESTION. A
   * selective approval reply is correlated against the plan carried by the
   * pending question, which is the authoritative copy; the reply never supplies
   * its own plan. A question that carries a plan can only be answered with a
   * matching reply, so free text can never stand in for an approval decision.
   */
  async answerQuestion(messageId: MessageId, answer: string, approvalReply?: ApprovalReply): Promise<void> {
    if (answer.trim() === "") {
      throw new DomainValidationError("answer must be a non-empty string");
    }
    const resolve = this.questionResolvers.get(messageId);
    if (resolve === undefined) {
      throw new DomainValidationError(`No pending question for message ${messageId}`);
    }
    const question = this.pendingQuestionsList.find((q) => q.id === messageId);
    const approvalPlan = question?.approvalPlan;
    if (approvalPlan === undefined) {
      if (approvalReply !== undefined) {
        throw new DomainValidationError(`Question ${messageId} has no pending approval plan`);
      }
    } else {
      if (approvalReply === undefined) {
        throw new DomainValidationError(
          `Question ${messageId} requires an approval reply for plan ${approvalPlan.id}`
        );
      }
      validateApprovalReplyForPlan(approvalPlan, approvalReply);
    }
    if (question !== undefined) {
      await this.appendParentEvent(
        "USER_ANSWER",
        { messageId, answer, ...(approvalReply !== undefined ? { approvalReply } : {}) },
        question.taskId
      );
    }
    this.questionResolvers.delete(messageId);
    const index = this.pendingQuestionsList.findIndex((q) => q.id === messageId);
    if (index >= 0) this.pendingQuestionsList.splice(index, 1);
    resolve();
  }

  startChildTask(
    input: ChildTaskInput,
    parentSignal: AbortSignal,
    options?: { childRunId?: RunId }
  ): ChildRunHandle {
    const childRunId = options?.childRunId ?? createRunId(this.generateId);
    const taskId = input.taskId;

    let settled = false;
    const done = this.gate.acquire().then(async () => {
      try {
        return await this.runTask(input, childRunId, parentSignal);
      } catch (error) {
        await this.recordCrashTerminal(childRunId, taskId, error);
        throw error;
      } finally {
        settled = true;
        this.cancelledChildren.delete(childRunId);
        this.gate.release();
      }
    });

    return {
      childRunId,
      taskId,
      done,
      cancel: () => {
        if (settled) return;
        this.cancelledChildren.add(childRunId);
        const controller = this.attemptControllers.get(childRunId);
        if (controller !== undefined) controller.abort();
      }
    };
  }

  private makeEvent(type: Event["type"], payload: unknown, runId: RunId, taskId?: TaskId): Event {
    return {
      id: createEventId(this.generateId),
      schemaVersion: 1,
      occurredAt: this.now(),
      runId,
      ...(taskId !== undefined ? { taskId } : {}),
      type,
      actor: "child-coordinator",
      payload
    } as Event;
  }

  private appendParentEvent(type: Event["type"], payload: unknown, taskId?: TaskId): Promise<void> {
    return this.parentStore.append(this.makeEvent(type, payload, this.parentRunId, taskId));
  }

  private childStore(childRunId: RunId): EventStore {
    let store = this.childStores.get(childRunId);
    if (store === undefined) {
      store = new EventStore(this.stateRoot, childRunId);
      this.childStores.set(childRunId, store);
    }
    return store;
  }

  private appendChildEvent(
    childRunId: RunId,
    type: Event["type"],
    payload: unknown,
    taskId?: TaskId
  ): Promise<void> {
    return this.childStore(childRunId).append(this.makeEvent(type, payload, childRunId, taskId));
  }

  /**
   * Closes the log of a child whose run threw instead of settling. Without it
   * the child's own event log stops wherever the throw landed — replay sees a
   * child that never ended, even though nothing is running it any more.
   *
   * The contract (already-terminal guard, best-effort append, caller rethrows)
   * lives in `run/crash-terminal.ts` alongside the run planes'; the child's
   * prefix and its own log are what this call supplies. Pinned by
   * `test/integration/m2.5/children-flowchart.test.ts`.
   */
  private recordCrashTerminal(childRunId: RunId, taskId: TaskId, error: unknown): Promise<void> {
    return recordChildCrashTerminal(
      {
        readEvents: async () => (await this.childStore(childRunId).readAll()).events,
        appendFailed: (reason) => this.appendChildEvent(childRunId, "RUN_FAILED", { reason }, taskId)
      },
      error,
      CHILD_CRASH_PREFIX
    );
  }

  private buildTaskRequest(input: ChildTaskInput, childRunId: RunId, childAgentId: AgentInstanceId): TaskRequest {
    return {
      protocolVersion: 1,
      id: createMessageId(this.generateId),
      occurredAt: this.now(),
      runId: childRunId,
      taskId: input.taskId,
      from: this.parentAgentInstanceId,
      to: childAgentId,
      type: "TASK_REQUEST",
      objective: input.objective,
      inputArtifactIds: input.inputArtifactIds,
      acceptanceCriteria: input.acceptanceCriteria,
      limits: input.limits
    };
  }

  /**
   * The USD ceiling one attempt on this task may spend: the tighter of the
   * task's own `ChildRunLimits.maxCostUsd` and the run-level cap. A per-task
   * budget cannot buy its way past the run's, and a run cap cannot loosen a
   * task that asked for less. Undefined when neither side named one.
   */
  private costCapFor(limits: ChildRunLimits): number | undefined {
    const caps = [limits.maxCostUsd, this.maxCostUsd].filter(
      (cap): cap is number => cap !== undefined
    );
    return caps.length === 0 ? undefined : Math.min(...caps);
  }

  private async runTask(
    input: ChildTaskInput,
    childRunId: RunId,
    parentSignal: AbortSignal
  ): Promise<ChildRunOutcome> {
    // The child's own RUN_CREATED is the record of what this run was allowed
    // to spend, so the ceiling belongs in it rather than only in the request.
    const costCap = this.costCapFor(input.limits);
    const childRun: Run = {
      id: childRunId,
      projectId: this.project.id,
      parentRunId: this.parentRunId,
      rootTaskId: input.taskId,
      status: "RUNNING",
      limits: {
        ...defaultRunLimits(),
        ...(costCap !== undefined ? { maxCostUsd: costCap } : {})
      },
      createdAt: this.now(),
      updatedAt: this.now()
    };

    await this.appendChildEvent(childRunId, "RUN_CREATED", { run: childRun }, input.taskId);
    await this.appendChildEvent(childRunId, "RUN_STARTED", {}, input.taskId);
    await this.appendParentEvent("CHILD_RUN_CREATED", { childRun }, input.taskId);

    const messages: AgentMessage[] = [];
    let attempts = 0;
    let terminalResult: TaskResult | undefined;
    let outcome: ChildOutcome = "FAILURE";
    let summary = "child execution ended without a terminal result";
    let assignedModel = input.assignedModel;

    // The protocol requires a positive integer wall budget; limits built
    // in-process bypass that validator, so anything non-positive or
    // non-representable fails closed as an already-exhausted deadline.
    const wallLimitMs = input.limits.maxWallTimeMs;
    const wallBudgetMs = Number.isFinite(wallLimitMs)
      ? Math.min(Math.max(wallLimitMs, 0), MAX_TIMER_MS)
      : 0;
    let wallExpired = wallBudgetMs <= 0;
    // One deadline timer for the whole child run: an attempt therefore ends at
    // min(timeoutMs, remaining wall budget), whichever timer fires first.
    const wallTimer = wallExpired
      ? undefined
      : this.schedule(() => {
          wallExpired = true;
          const controller = this.attemptControllers.get(childRunId);
          if (controller !== undefined) controller.abort();
        }, wallBudgetMs);
    const wallSummary = (): string =>
      `wall-clock limit of ${wallLimitMs}ms exhausted after ${attempts} attempt(s)`;

    try {
      for (let attempt = 1; attempt <= input.limits.maxAttempts; attempt += 1) {
        if (this.cancelledChildren.has(childRunId)) {
          outcome = "CANCELLED";
          summary = attempt === 1 ? "cancelled before start" : "cancelled between attempts";
          break;
        }
        if (wallExpired) {
          outcome = "TIMEOUT";
          summary = wallSummary();
          break;
        }
        attempts = attempt;
        const attemptInput =
          assignedModel === undefined ? input : { ...input, assignedModel };
        const attemptResult = await this.runAttempt(attemptInput, childRunId, parentSignal, attempt);
        messages.push(...attemptResult.messages);

        if (parentSignal.aborted) {
          outcome = "CANCELLED";
          summary = "parent run cancelled";
          break;
        }
        // The deadline timer aborts the live attempt, so report the wall limit
        // instead of the abort's downstream shape (attempt timeout / executor
        // cancellation). A terminal result or a protocol violation that still
        // arrived keeps its own honest outcome below.
        if (
          wallExpired &&
          attemptResult.terminalMessage === undefined &&
          attemptResult.failureReason === undefined
        ) {
          await this.appendParentEvent("TASK_TIMEOUT", { childRunId, attempt }, input.taskId);
          outcome = "TIMEOUT";
          summary = wallSummary();
          break;
        }
        if (attemptResult.timedOut) {
          await this.appendParentEvent("TASK_TIMEOUT", { childRunId, attempt }, input.taskId);
          if (attempt < input.limits.maxAttempts) {
            await this.appendParentEvent(
              "TASK_RETRY",
              { childRunId, attempt, reason: "task timed out" },
              input.taskId
            );
            continue;
          }
          outcome = "TIMEOUT";
          summary = `task timed out after ${attempt} attempt(s)`;
          break;
        }

        // Protocol violations (malformed messages, duplicate terminals, unleased
        // senders) fail the task immediately: retrying reproduces the same error.
        if (attemptResult.failureReason !== undefined) {
          outcome = "FAILURE";
          summary = attemptResult.failureReason;
          break;
        }

        const terminal = attemptResult.terminalMessage;
        if (terminal !== undefined) {
          const cascaded = this.maybeCascadeRetry({
            input,
            assignedModel,
            terminal,
            attempt
          });
          if (cascaded !== undefined) {
            assignedModel = cascaded.nextModelId;
            await this.appendParentEvent(
              "TASK_RETRY",
              {
                childRunId,
                attempt,
                reason: cascaded.reason,
                previousModel: cascaded.previousModelId,
                nextModel: cascaded.nextModelId,
                ...(cascaded.nextVersion !== undefined ? { nextModelVersion: cascaded.nextVersion } : {})
              },
              input.taskId
            );
            continue;
          }
          terminalResult = terminal;
          outcome = terminal.outcome === "CANCELLED" ? "CANCELLED" : terminal.outcome;
          summary = terminal.summary;
          break;
        }

        const executorOutcome = attemptResult.executorOutcome;
        if (executorOutcome === "SUCCESS") {
          outcome = "FAILURE";
          summary = "executor finished without a terminal TASK_RESULT";
          break;
        }
        if (executorOutcome === "CANCELLED") {
          outcome = "CANCELLED";
          summary = "executor cancelled";
          break;
        }
        if (attempt < input.limits.maxAttempts) {
          await this.appendParentEvent(
            "TASK_RETRY",
            { childRunId, attempt, reason: "attempt failed" },
            input.taskId
          );
          continue;
        }
        outcome = "FAILURE";
        summary = executorOutcome === "FAILURE" ? "executor reported failure" : summary;
        break;
      }
    } finally {
      if (wallTimer !== undefined) wallTimer.cancel();
    }

    // Terminal child-run event.
    if (outcome === "CANCELLED") {
      await this.appendChildEvent(childRunId, "RUN_CANCEL_REQUESTED", {}, input.taskId);
    } else if (outcome === "FAILURE" || outcome === "TIMEOUT") {
      await this.appendChildEvent(childRunId, "RUN_FAILED", { reason: summary }, input.taskId);
    } else {
      await this.appendChildEvent(childRunId, "RUN_COMPLETED", {}, input.taskId);
    }

    const evidenceIds = terminalResult?.evidenceIds ?? [];
    const artifactIds = terminalResult?.artifactIds ?? [];
    return {
      childRunId,
      taskId: input.taskId,
      outcome,
      attempts,
      summary,
      messages,
      ...(terminalResult !== undefined ? { terminalResult } : {}),
      evidenceIds,
      artifactIds
    };
  }

  private maybeCascadeRetry(input: {
    readonly input: ChildTaskInput;
    readonly assignedModel: string | undefined;
    readonly terminal: TaskResult;
    readonly attempt: number;
  }): { previousModelId: string; nextModelId: string; nextVersion?: string; reason: string } | undefined {
    const plan = input.input.cascade;
    const previousModelId = input.assignedModel;
    if (plan === undefined || previousModelId === undefined) return undefined;
    if (input.attempt >= input.input.limits.maxAttempts) return undefined;
    const evidence = evidenceFromTaskResult(input.terminal);
    const failureClass = classifyTaskFailure({
      outcome: input.terminal.outcome,
      verificationKind: input.terminal.verification.kind,
      summary: input.terminal.summary,
      ...(input.terminal.failure !== undefined ? { failure: input.terminal.failure } : {})
    });
    const decision = decideLiveCascade({
      plan,
      previousModelId,
      evidence,
      ...(failureClass !== undefined ? { failureClass } : {})
    });
    if (decision.action !== "escalate") return undefined;
    return {
      previousModelId,
      nextModelId: decision.nextModelId,
      reason: decision.reason,
      ...(decision.nextVersion !== undefined ? { nextVersion: decision.nextVersion } : {})
    };
  }

  private async runAttempt(
    input: ChildTaskInput,
    childRunId: RunId,
    parentSignal: AbortSignal,
    _attempt: number
  ): Promise<AttemptResult> {
    const childAgentId = createAgentInstanceId(this.generateId);
    if (this.cluster !== undefined && isAgentRole(input.role)) {
      this.cluster.register(childAgentId, input.role, input.taskId);
    }
    const attemptController = new AbortController();
    this.attemptControllers.set(childRunId, attemptController);
    const signal = AbortSignal.any([parentSignal, attemptController.signal]);

    const assigned = input.assignedModel;
    const assignedRef = assigned === undefined ? undefined : tryParseModelRef(assigned);
    const costCap = this.costCapFor(input.limits);
    const request = {
      runId: childRunId,
      taskId: input.taskId,
      agentInstanceId: childAgentId,
      prompt: this.buildChildPrompt(input, childAgentId),
      workingDirectory: this.project.rootPath,
      ...(costCap !== undefined ? { maxCostUsd: costCap } : {}),
      ...(assigned !== undefined ? { modelId: assignedRef?.modelId ?? assigned } : {}),
      ...(assignedRef !== undefined ? { providerId: assignedRef.providerId } : {}),
      ...(this.cluster !== undefined ? { cluster: this.cluster.viewFor(childAgentId) } : {})
    };

    const taskRequest = this.buildTaskRequest(input, childRunId, childAgentId);
    await this.appendChildEvent(
      childRunId,
      "AGENT_STARTED",
      { agentInstanceId: childAgentId, taskId: input.taskId },
      input.taskId
    );
    await this.appendParentEvent("CHILD_MESSAGE", { message: taskRequest }, input.taskId);

    let timedOut = false;
    const timer = this.schedule(() => {
      timedOut = true;
      attemptController.abort();
    }, input.limits.timeoutMs);

    const transcript = new AttemptTranscript();
    let terminalMessage: TaskResult | undefined;
    let executorOutcome: "SUCCESS" | "FAILURE" | "CANCELLED" | undefined;
    let failureReason: string | undefined;

    try {
      for await (const executionEvent of this.executor.execute(request, signal)) {
        if (timedOut || parentSignal.aborted) break;
        const terminal = await this.handleExecutionEvent(
          executionEvent,
          childRunId,
          input.taskId,
          childAgentId,
          transcript,
          signal
        );
        // Do not break on the first terminal: a second TASK_RESULT must be
        // rejected by the transcript as a protocol violation.
        if (terminal !== undefined) terminalMessage = terminal;
        if (executionEvent.type === "EXECUTION_FINISHED") {
          executorOutcome = executionEvent.outcome;
        }
      }
    } catch (error) {
      executorOutcome = "FAILURE";
      failureReason = error instanceof Error ? error.message : String(error);
    } finally {
      timer.cancel();
      this.attemptControllers.delete(childRunId);
    }

    if (terminalMessage === undefined && executorOutcome === undefined && !timedOut && !parentSignal.aborted) {
      executorOutcome = "FAILURE";
    }

    const finishedOutcome =
      terminalMessage !== undefined
        ? terminalMessage.outcome === "PARTIAL"
          ? "SUCCESS"
          : terminalMessage.outcome
        : (executorOutcome ?? "FAILURE");
    await this.appendChildEvent(
      childRunId,
      "AGENT_FINISHED",
      {
        agentInstanceId: childAgentId,
        outcome: finishedOutcome
      },
      input.taskId
    );

    return {
      timedOut,
      ...(terminalMessage !== undefined ? { terminalMessage } : {}),
      ...(executorOutcome !== undefined ? { executorOutcome } : {}),
      ...(failureReason !== undefined ? { failureReason } : {}),
      messages: transcript.messages
    };
  }

  /**
   * Handles one execution event. Returns the terminal TASK_RESULT when the
   * child sent one, otherwise undefined.
   */
  private async handleExecutionEvent(
    event: ExecutionEvent,
    childRunId: RunId,
    taskId: TaskId,
    childAgentId: AgentInstanceId,
    transcript: AttemptTranscript,
    signal: AbortSignal
  ): Promise<TaskResult | undefined> {
    switch (event.type) {
      case "TEXT_DELTA":
        await this.appendChildEvent(
          childRunId,
          "AGENT_EVENT",
          { agentInstanceId: childAgentId, kind: "TEXT_DELTA", summary: `text delta (${event.text.length} chars)` },
          taskId
        );
        return undefined;
      case "THINKING_DELTA":
        await this.appendChildEvent(
          childRunId,
          "AGENT_EVENT",
          {
            agentInstanceId: childAgentId,
            kind: "THINKING_DELTA",
            summary: `thinking delta (${event.bytes} bytes)`
          },
          taskId
        );
        return undefined;
      case "TOOL_STARTED":
        await this.appendChildEvent(
          childRunId,
          "AGENT_EVENT",
          { agentInstanceId: childAgentId, kind: "TOOL_STARTED", summary: bounded(event.toolName) },
          taskId
        );
        return undefined;
      case "TOOL_FINISHED":
        await this.appendChildEvent(
          childRunId,
          "AGENT_EVENT",
          {
            agentInstanceId: childAgentId,
            kind: "TOOL_FINISHED",
            summary: event.isError ? "tool error" : "tool finished"
          },
          taskId
        );
        return undefined;
      case "TURN_FINISHED":
        return undefined;
      case "MESSAGE": {
        let message: AgentMessage;
        try {
          message = validateAgentMessage(event.message);
        } catch (error) {
          throw new DomainValidationError(
            `Invalid message from child: ${error instanceof Error ? error.message : String(error)}`
          );
        }
        if (message.from !== childAgentId) {
          throw new DomainValidationError(`Message from unleased agent ${message.from}`);
        }
        if (message.taskId !== taskId || message.runId !== childRunId) {
          throw new DomainValidationError(`Message does not match the leased task ${taskId}`);
        }
        transcript.accept(message);
        await this.appendParentEvent("CHILD_MESSAGE", { message }, taskId);

        if (message.type === "PEER_MESSAGE") {
          if (this.cluster === undefined) {
            throw new DomainValidationError("PEER_MESSAGE requires a cluster session");
          }
          this.cluster.send({
            from: message.from,
            body: message.body,
            ...(message.to !== SUPERVISOR ? { to: message.to } : {}),
            ...(message.addressRole !== undefined ? { addressRole: message.addressRole } : {})
          });
          return undefined;
        }
        if (message.type === "QUESTION") {
          this.pendingQuestionsList.push(message);
          const answered = new Promise<void>((resolve) => {
            if (signal.aborted) {
              resolve();
              return;
            }
            const onAbort = () => {
              this.questionResolvers.delete(message.id);
              resolve();
            };
            signal.addEventListener("abort", onAbort, { once: true });
            this.questionResolvers.set(message.id, () => {
              signal.removeEventListener("abort", onAbort);
              resolve();
            });
          });
          await this.appendParentEvent(
            "RUN_WAITING_FOR_USER",
            {
              messageId: message.id,
              ...(message.approvalPlan !== undefined ? { approvalPlan: message.approvalPlan } : {})
            },
            taskId
          );
          if (this.onQuestion !== undefined) {
            const response = await this.onQuestion(message);
            if (typeof response === "string") {
              await this.answerQuestion(message.id, response);
            } else {
              await this.answerQuestion(message.id, response.answer, response.approvalReply);
            }
            return undefined;
          }
          await answered;
          return undefined;
        }
        if (message.type === "TASK_RESULT") {
          return message;
        }
        return undefined;
      }
      case "EXECUTION_FINISHED":
        return undefined;
    }
  }

  private buildChildPrompt(input: ChildTaskInput, agentId: AgentInstanceId): string {
    const session = this.cluster;
    const cluster =
      session === undefined
        ? {}
        : {
            peersLine: (() => {
              const peers = session.peers().filter((peer) => peer.agentId !== agentId);
              return peers.length === 0
                ? "(none)"
                : peers.map((peer) => `${peer.role}:${peer.agentId}`).join(", ");
            })(),
            inbox: session.inbox(agentId)
          };
    return formatChildPrompt({
      role: input.role,
      objective: input.objective,
      profile: input.profile,
      ...(input.assignedModel !== undefined ? { assignedModel: input.assignedModel } : {}),
      ...cluster,
      ...(input.contextPacket !== undefined ? { packet: input.contextPacket } : {}),
      ...(input.predecessorNotes !== undefined ? { predecessorNotes: input.predecessorNotes } : {}),
      acceptanceCriteria: input.acceptanceCriteria
    });
  }
}
