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
import { tryParseModelRef } from "../config/model-ref.js";
import {
  assertAtMostOneTerminal,
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
  limits: ChildRunLimits;
  /** Optional predecessor task ids; used when compiling `--children` into a flowchart. */
  dependsOn?: readonly TaskId[];
  /** Model id assigned by smart routing for this child. */
  assignedModel?: string;
  /** First-attempt cascade: escalate only on deterministic model FAIL. */
  cascade?: LiveCascadePlan;
  /** Spawn-tree depth when this task was dynamically spawned by a cluster agent. */
  clusterDepth?: number;
  /** The cluster agent that spawned this task, when applicable. */
  clusterParentAgentId?: AgentInstanceId;
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
  cancel(): void;
}

interface AttemptResult {
  timedOut: boolean;
  agentId: AgentInstanceId;
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
  private readonly questionResolvers = new Map<MessageId, () => void>();
  private readonly pendingQuestionsList: AgentQuestion[] = [];

  constructor(deps: ChildCoordinatorDeps) {
    this.stateRoot = deps.stateRoot;
    this.executor = deps.executor;
    this.project = deps.project;
    this.parentRunId = deps.parentRunId;
    this.now = deps.now ?? nowIso;
    this.generateId = deps.generateId === undefined ? undefined : deps.generateId;
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

    const done = this.gate.acquire().then(async () => {
      try {
        return await this.runTask(input, childRunId, parentSignal);
      } finally {
        this.gate.release();
      }
    });

    return {
      childRunId,
      taskId,
      done,
      cancel: () => {
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

  private async runTask(
    input: ChildTaskInput,
    childRunId: RunId,
    parentSignal: AbortSignal
  ): Promise<ChildRunOutcome> {
    const childRun: Run = {
      id: childRunId,
      projectId: this.project.id,
      parentRunId: this.parentRunId,
      rootTaskId: input.taskId,
      status: "RUNNING",
      limits: defaultRunLimits(),
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
    let lastAgentId: AgentInstanceId | undefined;

    for (let attempt = 1; attempt <= input.limits.maxAttempts; attempt += 1) {
      attempts = attempt;
      // A new attempt supersedes the previous agent: hand off its cluster
      // slot and undrained mail so the successor (same role) inherits them.
      if (lastAgentId !== undefined) {
        this.cluster?.deregister(lastAgentId, "handoff");
      }
      const attemptInput =
        assignedModel === undefined ? input : { ...input, assignedModel };
      const attemptResult = await this.runAttempt(attemptInput, childRunId, parentSignal, attempt);
      lastAgentId = attemptResult.agentId;
      messages.push(...attemptResult.messages);

      if (parentSignal.aborted) {
        outcome = "CANCELLED";
        summary = "parent run cancelled";
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

    if (lastAgentId !== undefined) {
      this.cluster?.deregister(lastAgentId, "complete");
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
      this.cluster.register(childAgentId, input.role, input.taskId, {
        depth: input.clusterDepth ?? 0,
        ...(input.clusterParentAgentId !== undefined
          ? { parentAgentId: input.clusterParentAgentId }
          : {})
      });
    }
    const attemptController = new AbortController();
    this.attemptControllers.set(childRunId, attemptController);
    const signal = AbortSignal.any([parentSignal, attemptController.signal]);

    const assigned = input.assignedModel;
    const assignedRef = assigned === undefined ? undefined : tryParseModelRef(assigned);
    const request = {
      runId: childRunId,
      taskId: input.taskId,
      agentInstanceId: childAgentId,
      prompt: this.buildChildPrompt(input, childAgentId),
      workingDirectory: this.project.rootPath,
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

    const seen: AgentMessage[] = [];
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
          seen,
          signal
        );
        // Do not break on the first terminal: a second TASK_RESULT must be
        // rejected by assertAtMostOneTerminal as a protocol violation.
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
      agentId: childAgentId,
      ...(terminalMessage !== undefined ? { terminalMessage } : {}),
      ...(executorOutcome !== undefined ? { executorOutcome } : {}),
      ...(failureReason !== undefined ? { failureReason } : {}),
      messages: seen
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
    seen: AgentMessage[],
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
        assertAtMostOneTerminal([...seen, message]);
        seen.push(message);
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
