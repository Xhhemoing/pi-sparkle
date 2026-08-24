import { DomainValidationError } from "../domain/errors.js";
import {
  createAgentInstanceId,
  createEventId,
  createRunId,
  createTaskId,
  type IdGenerator,
  type RunId,
  type TaskId
} from "../domain/ids.js";
import { defaultRunLimits } from "../domain/limits.js";
import type { ProjectSnapshot } from "../domain/project.js";
import type { Run } from "../domain/run.js";
import { isAgentRole, type AgentRole } from "../domain/roles.js";
import type { RunStatus } from "../domain/status.js";
import { nowIso, type IsoTimestamp } from "../domain/timestamp.js";
import type { RequirementContract } from "../domain/contract.js";
import { createAgentProfileRegistry, defaultAgentProfiles, type AgentProfileRegistry } from "../agents/registry.js";
import { buildProjectContextIndex, type ProjectContextIndex } from "../context/index.js";
import { createClusterHost, type ClusterHost } from "../cluster/host.js";
import { assertCoverageAllowsStart } from "../requirement/coverage.js";
import type { TaskAssignment } from "../routing/assign.js";
import {
  ChildCoordinator,
  type ChildRunHandle,
  type ChildRunOutcome,
  type ChildTaskInput
} from "./child-coordinator.js";
import { groundChildTask } from "./child-grounding.js";
import { applyChildThreeLine } from "./child-tracking.js";
import { bindEpisodeToRun, settleBoundEpisode } from "./episode-bind.js";
import {
  DEFAULT_HUMAN_CONFIDENCE,
  defaultDecisionPolicy,
  validateApprovalReplyAgainstPlan,
  type ApprovalReply,
  type Flowchart,
  type FlowNode
} from "../domain/flowchart.js";
import {
  applyLearnedRouting,
  loadLearnedRouting,
  type LearnedRoutingPolicy
} from "../learning/learned-routing.js";
import { discoverProject } from "../project/discovery.js";
import { analyzeTask } from "../routing/analyze-task.js";
import type { ModelRouter, RoutingDecision } from "../supervisor/model-router.js";
import type { AgentExecutor } from "../execution/contract.js";
import {
  childNodeResultFromChildOutcome,
  executeFlowchartNode,
  formatFlowchartNodePrompt
} from "./flowchart-executor.js";
import {
  createFlowchartSupervisor,
  restoreFlowchartSupervisor,
  type ChildNodeResult,
  type FlowchartRunLimits,
  type FlowchartRunStatus,
  type FlowchartSupervisor,
  type FlowchartSupervisorSnapshot,
  type PendingApproval
} from "../supervisor/flowchart-supervisor.js";
import { validateFlowchartRunLimits } from "../supervisor/flowchart-snapshot.js";
import { CheckpointStore } from "./checkpoint-store.js";
import { EventStore } from "./event-store.js";
import { routingContextFields, type Event, type ModelRoutedPayload } from "./events.js";
import { injectionEventPayload, validateInjection } from "./injection.js";
import { createFilePauseController, type PauseController } from "./pause-controller.js";
import {
  hasUnmatchedPause,
  materializeCheckpoint,
  replayRun,
  validateCheckpoint,
  type FlowchartCheckpointState,
  type ReconstructedRun,
  type RunCheckpoint
} from "./replay.js";

export interface FlowchartRunDeps {
  stateRoot: string;
  router: ModelRouter;
  now?: () => IsoTimestamp;
  generateId?: IdGenerator;
  pause?: PauseController;
  /** When set, RUNNING nodes without a --results entry are executed. */
  executor?: AgentExecutor;
  registry?: AgentProfileRegistry;
  /** Enable mailbox + bounded spawn when executing childTasks. */
  cluster?: boolean;
}

export interface FlowchartRunInput {
  projectRoot: string;
  flowchart: Flowchart;
  objective?: string;
  limits?: Partial<FlowchartRunLimits> & { maxRounds?: number };
  /** Fake child results keyed by node id; applied when that node is RUNNING. */
  childResults?: Readonly<Record<string, ChildNodeResult>>;
  /** When set, leased nodes run through ChildCoordinator instead of the thin executor. */
  childTasks?: readonly ChildTaskInput[];
  contract?: RequirementContract;
  assignments?: readonly TaskAssignment[];
  resolvedQuestionIds?: readonly string[];
}

export interface FlowchartContinuation {
  approvalReply?: ApprovalReply;
  answer?: string;
  childResults?: Readonly<Record<string, ChildNodeResult>>;
  unpause?: boolean;
}

export interface FlowchartRunOutcome {
  runId: RunId;
  status: RunStatus;
  events: Event[];
  checkpoint: RunCheckpoint;
  project: ProjectSnapshot;
  snapshot: FlowchartSupervisorSnapshot;
  pendingApproval?: PendingApproval;
}

function resolveLimits(partial?: Partial<FlowchartRunLimits> & { maxRounds?: number }): {
  flowchart: FlowchartRunLimits;
  maxRounds: number;
} {
  const flowchart = validateFlowchartRunLimits({
    maxConcurrentNodes: partial?.maxConcurrentNodes ?? 4,
    maxConsecutiveStalls: partial?.maxConsecutiveStalls ?? 3,
    remainingTimeMs: partial?.remainingTimeMs ?? Number.MAX_SAFE_INTEGER,
    ...(partial?.remainingCostUsd !== undefined ? { remainingCostUsd: partial.remainingCostUsd } : {}),
    ...(partial?.minHumanConfidence !== undefined ? { minHumanConfidence: partial.minHumanConfidence } : {})
  });
  return { flowchart, maxRounds: partial?.maxRounds ?? defaultRunLimits().maxRounds };
}

function toModelRoutedPayload(decision: RoutingDecision): ModelRoutedPayload {
  return {
    taskId: decision.taskId,
    role: decision.role,
    complexity: decision.complexity,
    model: decision.model,
    justification: decision.justification,
    confidence: decision.confidence,
    approvalPlan: decision.approvalPlan,
    statusAfterRoute: decision.statusAfterRoute,
    policyVersion: decision.policyVersion,
    estimatedCostUsd: decision.estimatedCostUsd,
    estimatedDurationMs: decision.estimatedDurationMs,
    ...routingContextFields(decision)
  };
}

function hasOpenWaiting(events: readonly Event[]): boolean {
  let waiting = false;
  for (const event of events) {
    if (event.type === "RUN_WAITING_FOR_USER") waiting = true;
    else if (event.type === "USER_ANSWER") waiting = false;
  }
  return waiting;
}

function hasEvent(events: readonly Event[], type: Event["type"]): boolean {
  return events.some((event) => event.type === type);
}

function childResultsMap(results?: Readonly<Record<string, ChildNodeResult>>): Map<string, ChildNodeResult> {
  return new Map(Object.entries(results ?? {}));
}

function childTaskMap(tasks: readonly ChildTaskInput[] | undefined): Map<TaskId, ChildTaskInput> {
  const map = new Map<TaskId, ChildTaskInput>();
  for (const task of tasks ?? []) map.set(task.taskId, task);
  return map;
}

/**
 * Run-level cancellation for one flowchart run: the abort signal shared by every
 * executor call and every child launched under the run, plus the child handles
 * that are still in flight. Both halves are needed — the signal stops a live
 * attempt, while {@link ChildRunHandle.cancel} also covers the queued and
 * between-attempts windows, where no attempt controller exists to abort.
 */
class RunAbortScope {
  private readonly controller = new AbortController();
  private readonly live = new Set<ChildRunHandle>();

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get aborted(): boolean {
    return this.controller.signal.aborted;
  }

  /** Registers a child so teardown can cancel it; forgotten once it settles. */
  track(handle: ChildRunHandle): ChildRunHandle {
    this.live.add(handle);
    const forget = (): void => {
      this.live.delete(handle);
    };
    void handle.done.then(forget, forget);
    return handle;
  }

  /**
   * Aborts the run and waits for the children it cancelled to settle, so a
   * failed, paused, or finished run never returns while a child it launched is
   * still spending. A child can spawn peers as it unwinds, so cancellation
   * repeats until nothing is left in flight.
   */
  async cancelAndSettle(): Promise<void> {
    this.cancel();
    while (this.live.size > 0) {
      await Promise.allSettled([...this.live].map((handle) => handle.done));
      this.cancel();
    }
  }

  private cancel(): void {
    this.controller.abort();
    for (const handle of this.live) handle.cancel();
  }
}

function childTasksFromDefinition(
  definition: Flowchart,
  registry: AgentProfileRegistry
): ChildTaskInput[] {
  const tasks: ChildTaskInput[] = [];
  for (const node of definition.nodes) {
    const role = mappedAgentRole(node.role);
    if (role === undefined) continue;
    tasks.push({
      taskId: node.taskId,
      role,
      objective: node.objective,
      profile: registry.resolve(role),
      inputArtifactIds: [],
      acceptanceCriteria: [],
      limits: { maxAttempts: 2, timeoutMs: 60_000, maxWallTimeMs: 3_600_000 }
    });
  }
  return tasks;
}

function attachChildRuntime(input: {
  readonly stateRoot: string;
  readonly executor: AgentExecutor;
  readonly runId: RunId;
  readonly project: ProjectSnapshot;
  readonly registry: AgentProfileRegistry;
  readonly cluster: boolean;
  readonly generateId?: IdGenerator;
  readonly now: () => IsoTimestamp;
  readonly abort: RunAbortScope;
}): {
  childCoordinator: ChildCoordinator;
  spawnHandles: ChildRunHandle[];
  index: ProjectContextIndex;
} {
  const spawnHandles: ChildRunHandle[] = [];
  let childCoordinator!: ChildCoordinator;
  let clusterHost: ClusterHost | undefined;
  if (input.cluster) {
    clusterHost = createClusterHost({
      registry: input.registry,
      maxTasks: defaultRunLimits().maxTasks,
      ...(input.generateId !== undefined ? { generateId: input.generateId } : {}),
      onSpawn: (spawned) => {
        if (!isAgentRole(spawned.role)) return;
        // A run that has already torn down must not start new paid work for a
        // child that is itself being cancelled.
        if (input.abort.aborted) return;
        spawnHandles.push(
          input.abort.track(
            childCoordinator.startChildTask(
              {
                taskId: spawned.taskId,
                role: spawned.role,
                objective: spawned.objective,
                profile: input.registry.resolve(spawned.role),
                inputArtifactIds: [],
                acceptanceCriteria: [],
                limits: { maxAttempts: 1, timeoutMs: 60_000, maxWallTimeMs: 3_600_000 }
              },
              input.abort.signal
            )
          )
        );
      }
    });
  }
  childCoordinator = new ChildCoordinator({
    stateRoot: input.stateRoot,
    executor: input.executor,
    parentRunId: input.runId,
    project: input.project,
    registry: input.registry,
    maxConcurrentTasks: defaultRunLimits().maxConcurrentTasks,
    now: input.now,
    ...(input.generateId !== undefined ? { generateId: input.generateId } : {}),
    ...(clusterHost !== undefined ? { cluster: clusterHost } : {})
  });
  return {
    childCoordinator,
    spawnHandles,
    index: buildProjectContextIndex(input.project)
  };
}

async function drainSpawnedChildren(
  handles: ChildRunHandle[],
  finished: Map<TaskId, ChildRunOutcome>,
  from: number
): Promise<void> {
  let start = from;
  while (start < handles.length) {
    const batch = handles.slice(start);
    start = handles.length;
    const outcomes = await Promise.all(batch.map((handle) => handle.done));
    for (const outcome of outcomes) finished.set(outcome.taskId, outcome);
  }
}

function applyRunningResults(
  supervisor: FlowchartSupervisor,
  definition: Flowchart,
  results: Map<string, ChildNodeResult>
): number {
  let applied = 0;
  for (const node of definition.nodes) {
    if (supervisor.nodeState(node.id) !== "RUNNING") continue;
    const result = results.get(node.id);
    if (result === undefined) continue;
    supervisor.applyChildResult(node.id, result);
    results.delete(node.id);
    applied += 1;
  }
  return applied;
}

async function executeClusteredNode(
  ctx: FlowchartLoopContext,
  node: FlowNode,
  spec: ChildTaskInput
): Promise<void> {
  const coordinator = ctx.childCoordinator;
  const index = ctx.index;
  if (coordinator === undefined || index === undefined) {
    throw new DomainValidationError("clustered flowchart node is missing child coordinator");
  }
  const model = ctx.supervisor.nodeRuntime(node.id).model ?? spec.assignedModel;
  const depIds = spec.dependsOn ?? [];
  const predecessors = depIds.flatMap((id) => {
    const outcome = ctx.finishedChildren.get(id);
    return outcome === undefined
      ? []
      : [{ taskId: outcome.taskId, summary: outcome.summary, artifactIds: outcome.artifactIds }];
  });
  const grounded = groundChildTask({
    child: model !== undefined ? { ...spec, assignedModel: model } : spec,
    predecessors,
    index,
    ...(ctx.contract !== undefined ? { contract: ctx.contract } : {})
  });
  const spawnedBefore = ctx.spawnHandles.length;
  const handle = ctx.abort.track(coordinator.startChildTask(grounded, ctx.abort.signal));
  const outcome = await handle.done;
  ctx.finishedChildren.set(outcome.taskId, outcome);
  await drainSpawnedChildren(ctx.spawnHandles, ctx.finishedChildren, spawnedBefore);
  const current = await ctx.eventStore.readAll();
  const gated = applyChildThreeLine({
    events: current.events,
    child: outcome,
    spec,
    nowIso: ctx.now(),
    generateEventId: () => createEventId(ctx.generateId),
    ...(ctx.contract !== undefined ? { contract: ctx.contract } : {})
  });
  for (const event of gated.events.slice(current.events.length)) {
    await ctx.append(event);
  }
  ctx.supervisor.applyChildResult(node.id, childNodeResultFromChildOutcome(outcome));
}

async function executeRemainingRunningNodes(ctx: FlowchartLoopContext): Promise<number> {
  let applied = 0;
  for (const node of ctx.definition.nodes) {
    if (ctx.supervisor.nodeState(node.id) !== "RUNNING") continue;
    const spec = ctx.childByTaskId.get(node.taskId);
    if (spec !== undefined && ctx.childCoordinator !== undefined) {
      await executeClusteredNode(ctx, node, spec);
      applied += 1;
      continue;
    }
    if (ctx.executor === undefined) continue;
    const agentInstanceId = createAgentInstanceId(ctx.generateId);
    await ctx.append(ctx.make("AGENT_STARTED", { agentInstanceId, taskId: node.taskId }, node.taskId));
    const model = ctx.supervisor.nodeRuntime(node.id).model;
    let result;
    try {
      result = await executeFlowchartNode({
        executor: ctx.executor,
        runId: ctx.runId,
        taskId: node.taskId,
        prompt: formatFlowchartNodePrompt(node, model),
        workingDirectory: ctx.project.rootPath,
        agentInstanceId,
        signal: ctx.abort.signal,
        ...(model !== undefined ? { modelId: model } : {}),
        ...(ctx.generateId !== undefined ? { generateId: ctx.generateId } : {})
      });
    } catch {
      result = { outcome: "FAILURE" as const };
    }
    const agentOutcome = result.outcome === "FAILURE" ? "FAILURE" : "SUCCESS";
    await ctx.append(ctx.make("AGENT_FINISHED", { agentInstanceId, outcome: agentOutcome }, node.taskId));
    ctx.supervisor.applyChildResult(node.id, result);
    applied += 1;
  }
  return applied;
}

function nodeTaskId(definition: Flowchart, nodeId: string): TaskId {
  const node = definition.nodes.find((entry) => entry.id === nodeId);
  if (node === undefined) throw new DomainValidationError(`unknown flowchart node: ${nodeId}`);
  return node.taskId;
}

function flowchartStatus(supervisor: FlowchartSupervisor): FlowchartRunStatus {
  return supervisor.status;
}

function failedReason(supervisor: FlowchartSupervisor): string {
  const failed = Object.entries(supervisor.snapshot().nodes)
    .filter(([, node]) => node.state === "FAILED")
    .map(([id]) => id);
  if (failed.length === 1) return `flowchart node failed: ${failed[0]}`;
  if (failed.length > 1) return `flowchart nodes failed: ${failed.join(", ")}`;
  return "flowchart run failed";
}

async function finishIfSettled(ctx: FlowchartLoopContext): Promise<FlowchartRunOutcome | undefined> {
  const status = flowchartStatus(ctx.supervisor);
  if (status === "WAITING_FOR_USER") {
    await persistWaiting(ctx);
    return finish(ctx);
  }
  if (status === "COMPLETED") {
    await persistCompleted(ctx);
    return finish(ctx);
  }
  if (status === "BLOCKED") {
    await persistBlocked(ctx);
    return finish(ctx);
  }
  if (status === "FAILED") {
    await persistFailed(ctx, failedReason(ctx.supervisor));
    return finish(ctx);
  }
  return undefined;
}

interface FlowchartLoopContext {
  supervisor: FlowchartSupervisor;
  definition: Flowchart;
  flowchartLimits: FlowchartRunLimits;
  maxRounds: number;
  results: Map<string, ChildNodeResult>;
  eventStore: EventStore;
  checkpointStore: CheckpointStore;
  append: (event: Event) => Promise<void>;
  make: (type: Event["type"], payload: unknown, taskId?: TaskId) => Event;
  now: () => IsoTimestamp;
  project: ProjectSnapshot;
  runId: RunId;
  generateId?: IdGenerator;
  pause?: PauseController;
  executor?: AgentExecutor;
  stateRoot: string;
  abort: RunAbortScope;
  childByTaskId: Map<TaskId, ChildTaskInput>;
  finishedChildren: Map<TaskId, ChildRunOutcome>;
  spawnHandles: ChildRunHandle[];
  childCoordinator?: ChildCoordinator;
  index?: ProjectContextIndex;
  contract?: RequirementContract;
}

async function persistCheckpoint(ctx: FlowchartLoopContext): Promise<RunCheckpoint> {
  const snapshot = ctx.supervisor.snapshot();
  ctx.flowchartLimits = limitsFromSnapshot(ctx.flowchartLimits, snapshot);
  const read = await ctx.eventStore.readAll();
  const replayed = replayRun(read.events);
  const flowchart: FlowchartCheckpointState = {
    definition: ctx.definition,
    snapshot,
    limits: ctx.flowchartLimits
  };
  const checkpoint = validateCheckpoint(materializeCheckpoint(replayed, ctx.now(), flowchart));
  await ctx.checkpointStore.write(checkpoint);
  return checkpoint;
}

function limitsFromSnapshot(
  base: FlowchartRunLimits,
  snapshot: FlowchartSupervisorSnapshot
): FlowchartRunLimits {
  return validateFlowchartRunLimits({
    maxConcurrentNodes: base.maxConcurrentNodes,
    maxConsecutiveStalls: base.maxConsecutiveStalls,
    remainingTimeMs: snapshot.remainingTimeMs ?? base.remainingTimeMs ?? Number.MAX_SAFE_INTEGER,
    ...(snapshot.remainingCostUsd !== undefined
      ? { remainingCostUsd: snapshot.remainingCostUsd }
      : base.remainingCostUsd !== undefined
        ? { remainingCostUsd: base.remainingCostUsd }
        : {}),
    ...(base.minHumanConfidence !== undefined ? { minHumanConfidence: base.minHumanConfidence } : {})
  });
}

async function persistLedger(ctx: FlowchartLoopContext): Promise<void> {
  const ledger = ctx.supervisor.snapshot().ledger;
  await ctx.append(
    ctx.make("LEDGER_UPDATED", {
      revision: ledger.revision,
      round: ledger.round,
      consecutiveStalls: ledger.consecutiveStalls,
      isBlocked: ledger.isBlocked
    })
  );
}

async function persistWaiting(ctx: FlowchartLoopContext): Promise<void> {
  const pending = ctx.supervisor.pendingApproval;
  if (pending === undefined) {
    throw new DomainValidationError("flowchart is WAITING_FOR_USER without a pending approval");
  }
  const read = await ctx.eventStore.readAll();
  if (hasOpenWaiting(read.events)) return;
  await ctx.append(
    ctx.make(
      "RUN_WAITING_FOR_USER",
      { messageId: pending.question.id, approvalPlan: pending.plan },
      nodeTaskId(ctx.definition, pending.nodeId)
    )
  );
}

async function persistBlocked(ctx: FlowchartLoopContext): Promise<void> {
  const read = await ctx.eventStore.readAll();
  if (hasEvent(read.events, "RUN_BLOCKED")) return;
  const ledger = ctx.supervisor.snapshot().ledger;
  const requiredEvidence = ledger.requiredEvidence.map((entry) => entry.description);
  await ctx.append(
    ctx.make("STALL_DETECTED", {
      round: ledger.round,
      consecutiveStalls: ledger.consecutiveStalls,
      requiredEvidence
    })
  );
  await ctx.append(ctx.make("RUN_BLOCKED", { reason: "no progress for too many rounds", requiredEvidence }));
}

async function persistCompleted(ctx: FlowchartLoopContext): Promise<void> {
  const read = await ctx.eventStore.readAll();
  if (hasEvent(read.events, "RUN_COMPLETED")) return;
  await ctx.append(ctx.make("RUN_COMPLETED", {}));
}

async function persistFailed(ctx: FlowchartLoopContext, reason: string): Promise<void> {
  // Stop paying for children before recording the failure, not after.
  await ctx.abort.cancelAndSettle();
  const read = await ctx.eventStore.readAll();
  if (hasEvent(read.events, "RUN_FAILED")) return;
  await ctx.append(ctx.make("RUN_FAILED", { reason }));
}

async function finish(ctx: FlowchartLoopContext): Promise<FlowchartRunOutcome> {
  // Terminal teardown: whatever the status, the run stops here, so nothing it
  // launched may outlive it.
  await ctx.abort.cancelAndSettle();
  const checkpoint = await persistCheckpoint(ctx);
  const beforeSettle = await ctx.eventStore.readAll();
  await settleBoundEpisode({
    stateRoot: ctx.stateRoot,
    events: beforeSettle.events,
    status: replayRun(beforeSettle.events).status,
    append: ctx.append,
    make: (type, payload) => ctx.make(type, payload)
  });
  const read = await ctx.eventStore.readAll();
  const replayed = replayRun(read.events);
  const pendingApproval = ctx.supervisor.pendingApproval;
  return {
    runId: ctx.runId,
    status: replayed.status,
    events: read.events,
    checkpoint,
    project: ctx.project,
    snapshot: ctx.supervisor.snapshot(),
    ...(pendingApproval !== undefined ? { pendingApproval } : {})
  };
}

async function applyApproval(
  ctx: FlowchartLoopContext,
  reply: ApprovalReply,
  answer?: string
): Promise<void> {
  const pending = ctx.supervisor.pendingApproval;
  if (pending === undefined) {
    throw new DomainValidationError("No pending approval to answer");
  }
  const validated = validateApprovalReplyAgainstPlan(pending.plan, reply);
  const correlated: ApprovalReply = {
    approvalPlanId: pending.plan.id,
    selectedActionIds: validated.selectedActionIds
  };
  const text =
    answer !== undefined && answer.trim() !== ""
      ? answer
      : correlated.selectedActionIds.length > 0
        ? `Selected ${correlated.selectedActionIds.join(", ")}`
        : "Selected none";
  await ctx.append(
    ctx.make(
      "USER_ANSWER",
      { messageId: pending.question.id, answer: text, approvalReply: correlated },
      nodeTaskId(ctx.definition, pending.nodeId)
    )
  );
  ctx.supervisor.applyApprovalReply(correlated);
}

async function pauseIfRequested(ctx: FlowchartLoopContext): Promise<FlowchartRunOutcome | undefined> {
  if (ctx.pause === undefined) return undefined;
  const token = await ctx.pause.token(ctx.runId);
  if (!token.paused) return undefined;
  // A paused run keeps no work alive: children stop before the pause is recorded.
  await ctx.abort.cancelAndSettle();
  const read = await ctx.eventStore.readAll();
  if (!hasUnmatchedPause(read.events)) {
    await ctx.append(
      ctx.make("PAUSE_REQUESTED", token.reason !== undefined ? { reason: token.reason } : {})
    );
  }
  return finish(ctx);
}

async function runFlowchartLoop(ctx: FlowchartLoopContext): Promise<FlowchartRunOutcome> {
  for (let round = 1; round <= ctx.maxRounds; round += 1) {
    const pausedAtStart = await pauseIfRequested(ctx);
    if (pausedAtStart !== undefined) return pausedAtStart;

    const settled = await finishIfSettled(ctx);
    if (settled !== undefined) return settled;

    const leases = ctx.supervisor.leaseReadyNodes();
    for (const lease of leases) {
      await ctx.append(ctx.make("MODEL_ROUTED", toModelRoutedPayload(lease.decision), lease.taskId));
    }
    if (leases.length > 0) await persistCheckpoint(ctx);

    const afterLease = await finishIfSettled(ctx);
    if (afterLease !== undefined) return afterLease;

    const pausedAfterLease = await pauseIfRequested(ctx);
    if (pausedAfterLease !== undefined) return pausedAfterLease;

    const appliedResults = applyRunningResults(ctx.supervisor, ctx.definition, ctx.results);
    const appliedExecutor = await executeRemainingRunningNodes(ctx);
    const applied = appliedResults + appliedExecutor;
    if (applied > 0) {
      const advanced = ctx.supervisor.advanceRound();
      await persistLedger(ctx);
      await persistCheckpoint(ctx);
      if (advanced.blocked) {
        await persistBlocked(ctx);
        return finish(ctx);
      }
      const afterApply = await finishIfSettled(ctx);
      if (afterApply !== undefined) return afterApply;
      continue;
    }

    const idleSettled = await finishIfSettled(ctx);
    if (idleSettled !== undefined) return idleSettled;

    const advanced = ctx.supervisor.advanceRound();
    await persistLedger(ctx);
    await persistCheckpoint(ctx);
    if (advanced.blocked) {
      await persistBlocked(ctx);
      return finish(ctx);
    }
  }

  const exhausted = await finishIfSettled(ctx);
  if (exhausted !== undefined) return exhausted;
  await persistFailed(ctx, `maxRounds (${ctx.maxRounds}) exhausted without completion`);
  return finish(ctx);
}

/**
 * Tears the run down when an error escapes. A throw from mid node (a child that
 * fails to launch, a rejected append) never reaches {@link finish}, so without
 * this the children started for that node keep running with nobody awaiting them.
 */
async function withRunTeardown(
  ctx: FlowchartLoopContext,
  body: () => Promise<FlowchartRunOutcome>
): Promise<FlowchartRunOutcome> {
  try {
    return await body();
  } catch (error) {
    await ctx.abort.cancelAndSettle();
    throw error;
  }
}

function makeEventFactory(
  runId: RunId,
  now: () => IsoTimestamp,
  generateId: IdGenerator | undefined,
  actor = "flowchart-supervisor"
): (type: Event["type"], payload: unknown, taskId?: TaskId) => Event {
  return (type, payload, taskId) =>
    ({
      id: createEventId(generateId),
      schemaVersion: 1,
      occurredAt: now(),
      runId,
      ...(taskId !== undefined ? { taskId } : {}),
      type,
      actor,
      payload
    }) as Event;
}

function mappedAgentRole(role: FlowNode["role"]): AgentRole | undefined {
  if (isAgentRole(role)) return role;
  if (role === "critic") return "reviewer";
  if (role === "actor") return "implementer";
  return undefined;
}

function familyForFlowNode(node: FlowNode): string {
  const mapped = mappedAgentRole(node.role);
  if (mapped !== undefined) return analyzeTask(node.objective, mapped).family;
  return node.role;
}

function applyLearnedToNode(node: FlowNode, learned: LearnedRoutingPolicy): FlowNode {
  const family = familyForFlowNode(node);
  const originalPreferred = node.modelPolicy.preferredModel;
  const seedPreferred = originalPreferred ?? node.modelPolicy.allowedModels[0]!;
  const applied = applyLearnedRouting(
    family,
    node.modelPolicy.allowedModels,
    seedPreferred,
    learned
  );
  const prefer = learned.prefer.find((entry) => entry.family === family)?.modelId;
  const preferApplied = prefer !== undefined && applied.allowedModels.includes(prefer);
  const modelPolicy =
    preferApplied || originalPreferred !== undefined
      ? { allowedModels: applied.allowedModels, preferredModel: applied.preferredModel }
      : { allowedModels: applied.allowedModels };
  return { ...node, modelPolicy };
}

function applyLearnedToFlowchart(
  flowchart: Flowchart,
  learned: LearnedRoutingPolicy | undefined
): Flowchart {
  if (learned === undefined) return flowchart;
  return {
    ...flowchart,
    nodes: flowchart.nodes.map((node) => applyLearnedToNode(node, learned))
  };
}

async function flowchartForSupervisor(
  stateRoot: string,
  projectRoot: string,
  flowchart: Flowchart
): Promise<Flowchart> {
  const learned = await loadLearnedRouting(stateRoot, projectRoot);
  return applyLearnedToFlowchart(flowchart, learned);
}

export async function startFlowchartRun(
  deps: FlowchartRunDeps,
  input: FlowchartRunInput
): Promise<FlowchartRunOutcome> {
  const now = deps.now ?? nowIso;
  const generateId = deps.generateId;
  const runId = createRunId(generateId);
  const resolved = resolveLimits(input.limits);
  const project = await discoverProject(input.projectRoot, {
    now,
    ...(generateId !== undefined ? { generateId } : {})
  });
  const eventStore = new EventStore(deps.stateRoot, runId);
  const checkpointStore = new CheckpointStore(deps.stateRoot, runId);
  const rootTaskId = createTaskId(generateId);
  const defaults = defaultRunLimits();
  const run: Run = {
    id: runId,
    projectId: project.id,
    rootTaskId,
    status: "PLANNING",
    limits: {
      ...defaults,
      maxConsecutiveStalls: resolved.flowchart.maxConsecutiveStalls,
      maxRounds: resolved.maxRounds
    },
    createdAt: now(),
    updatedAt: now()
  };

  const supervisor = createFlowchartSupervisor({
    flowchart: await flowchartForSupervisor(deps.stateRoot, project.rootPath, input.flowchart),
    router: deps.router,
    limits: resolved.flowchart,
    ...(input.objective !== undefined ? { objective: input.objective } : {}),
    runId,
    ...(generateId !== undefined ? { generateId } : {}),
    now
  });

  const make = makeEventFactory(runId, now, generateId);
  const append = (event: Event) => eventStore.append(event);
  if (input.contract !== undefined && input.childTasks !== undefined) {
    assertCoverageAllowsStart(
      input.contract,
      input.childTasks.map((child) => ({
        id: child.taskId,
        acceptanceCriteria: child.acceptanceCriteria
      })),
      input.resolvedQuestionIds !== undefined ? { resolvedQuestionIds: input.resolvedQuestionIds } : undefined
    );
  }
  if ((input.childTasks?.length ?? 0) > 0 && deps.executor === undefined) {
    throw new DomainValidationError("flowchart childTasks require an executor");
  }
  await append(make("PROJECT_DISCOVERED", { project }));
  await append(make("RUN_CREATED", { run }));
  await bindEpisodeToRun({
    stateRoot: deps.stateRoot,
    runId,
    projectId: project.id,
    objective: input.objective ?? input.flowchart.id,
    append,
    make: (type, payload) => make(type, payload),
    ...(generateId !== undefined ? { generateId } : {}),
    ...(input.contract !== undefined ? { contract: input.contract, skipContract: false } : { skipContract: true })
  });
  await append(make("RUN_STARTED", {}));
  if (input.assignments !== undefined) {
    for (const assignment of input.assignments) {
      await append(make("MODEL_ROUTED", toModelRoutedPayload(assignment.decision), assignment.taskId));
    }
  }

  const abort = new RunAbortScope();
  const registry = deps.registry ?? createAgentProfileRegistry(defaultAgentProfiles());
  const plannedChildren = input.childTasks ?? [];
  const childByTaskId = childTaskMap(plannedChildren);
  const finishedChildren = new Map<TaskId, ChildRunOutcome>();
  let spawnHandles: ChildRunHandle[] = [];
  let childCoordinator: ChildCoordinator | undefined;
  let index: ProjectContextIndex | undefined;
  if (deps.executor !== undefined && plannedChildren.length > 0) {
    const attached = attachChildRuntime({
      stateRoot: deps.stateRoot,
      executor: deps.executor,
      runId,
      project,
      registry,
      cluster: deps.cluster !== false,
      now,
      abort,
      ...(generateId !== undefined ? { generateId } : {})
    });
    childCoordinator = attached.childCoordinator;
    index = attached.index;
    spawnHandles = attached.spawnHandles;
  }

  const ctx: FlowchartLoopContext = {
    supervisor,
    definition: input.flowchart,
    flowchartLimits: resolved.flowchart,
    maxRounds: resolved.maxRounds,
    results: childResultsMap(input.childResults),
    eventStore,
    checkpointStore,
    append,
    make,
    now,
    project,
    runId,
    stateRoot: deps.stateRoot,
    abort,
    childByTaskId,
    finishedChildren,
    spawnHandles,
    ...(generateId !== undefined ? { generateId } : {}),
    ...(deps.pause !== undefined ? { pause: deps.pause } : {}),
    ...(deps.executor !== undefined ? { executor: deps.executor } : {}),
    ...(childCoordinator !== undefined ? { childCoordinator } : {}),
    ...(index !== undefined ? { index } : {}),
    ...(input.contract !== undefined ? { contract: input.contract } : {})
  };
  await persistCheckpoint(ctx);
  return withRunTeardown(ctx, () => runFlowchartLoop(ctx));
}

export async function resumeFlowchartRun(
  deps: FlowchartRunDeps,
  runId: RunId,
  continuation: FlowchartContinuation = {}
): Promise<FlowchartRunOutcome> {
  const now = deps.now ?? nowIso;
  const generateId = deps.generateId;
  const eventStore = new EventStore(deps.stateRoot, runId);
  const checkpointStore = new CheckpointStore(deps.stateRoot, runId);

  const read = await eventStore.readAll();
  if (read.events.length === 0) {
    throw new DomainValidationError(`Run ${runId} not found`);
  }
  const replayed = replayRun(read.events);
  if (replayed.run === undefined) {
    throw new DomainValidationError(`Run ${runId} has no RUN_CREATED event`);
  }
  if (replayed.project === undefined) {
    throw new DomainValidationError(`Run ${runId} has no PROJECT_DISCOVERED event`);
  }

  const raw = await checkpointStore.read();
  if (raw === undefined) {
    throw new DomainValidationError(
      `Flowchart run ${runId} has no durable checkpoint; refusing to invent state`
    );
  }
  const checkpoint = validateCheckpoint(raw);
  if (checkpoint.flowchart === undefined) {
    throw new DomainValidationError(`Flowchart run ${runId} checkpoint is missing flowchart snapshot`);
  }

  const { definition, snapshot, limits } = checkpoint.flowchart;
  const supervisor = restoreFlowchartSupervisor(
    {
      flowchart: await flowchartForSupervisor(deps.stateRoot, replayed.project.rootPath, definition),
      router: deps.router,
      limits,
      runId,
      ...(generateId !== undefined ? { generateId } : {}),
      now
    },
    snapshot
  );

  const make = makeEventFactory(runId, now, generateId);
  const abort = new RunAbortScope();
  const registry = deps.registry ?? createAgentProfileRegistry(defaultAgentProfiles());
  const rebuilt = deps.executor !== undefined ? childTasksFromDefinition(definition, registry) : [];
  const childByTaskId = childTaskMap(rebuilt);
  const finishedChildren = new Map<TaskId, ChildRunOutcome>();
  let spawnHandles: ChildRunHandle[] = [];
  let childCoordinator: ChildCoordinator | undefined;
  let index: ProjectContextIndex | undefined;
  if (deps.executor !== undefined && rebuilt.length > 0) {
    const attached = attachChildRuntime({
      stateRoot: deps.stateRoot,
      executor: deps.executor,
      runId,
      project: replayed.project,
      registry,
      cluster: deps.cluster !== false,
      now,
      abort,
      ...(generateId !== undefined ? { generateId } : {})
    });
    childCoordinator = attached.childCoordinator;
    index = attached.index;
    spawnHandles = attached.spawnHandles;
  }
  const ctx: FlowchartLoopContext = {
    supervisor,
    definition,
    flowchartLimits: limits,
    maxRounds: replayed.run.limits.maxRounds,
    results: childResultsMap(continuation.childResults),
    eventStore,
    checkpointStore,
    append: (event) => eventStore.append(event),
    make,
    now,
    project: replayed.project,
    runId,
    stateRoot: deps.stateRoot,
    abort,
    childByTaskId,
    finishedChildren,
    spawnHandles,
    ...(generateId !== undefined ? { generateId } : {}),
    ...(deps.pause !== undefined ? { pause: deps.pause } : {}),
    ...(deps.executor !== undefined ? { executor: deps.executor } : {}),
    ...(childCoordinator !== undefined ? { childCoordinator } : {}),
    ...(index !== undefined ? { index } : {})
  };

  return withRunTeardown(ctx, () => resumeRestoredRun(ctx, continuation));
}

/** The resume-specific prologue (unpause, approval, pending results) plus the loop. */
async function resumeRestoredRun(
  ctx: FlowchartLoopContext,
  continuation: FlowchartContinuation
): Promise<FlowchartRunOutcome> {
  if (continuation.unpause === true) {
    const pause = ctx.pause ?? createFilePauseController(ctx.stateRoot, ctx.now);
    await pause.clearPause(ctx.runId);
    const latest = await ctx.eventStore.readAll();
    if (hasUnmatchedPause(latest.events)) {
      await ctx.append(ctx.make("PAUSE_CLEARED", {}));
    }
  }

  const latestReplay = replayRun((await ctx.eventStore.readAll()).events);
  if (
    latestReplay.status === "COMPLETED" ||
    latestReplay.status === "FAILED" ||
    latestReplay.status === "CANCELLED"
  ) {
    return finish(ctx);
  }

  const paused = await pauseIfRequested(ctx);
  if (paused !== undefined) return paused;

  if (continuation.approvalReply !== undefined) {
    await applyApproval(ctx, continuation.approvalReply, continuation.answer);
  }

  const appliedResults = applyRunningResults(ctx.supervisor, ctx.definition, ctx.results);
  const appliedExecutor = await executeRemainingRunningNodes(ctx);
  const applied = appliedResults + appliedExecutor;
  if (continuation.approvalReply !== undefined || applied > 0) {
    const advanced = ctx.supervisor.advanceRound();
    await persistLedger(ctx);
    await persistCheckpoint(ctx);
    if (advanced.blocked) {
      await persistBlocked(ctx);
      return finish(ctx);
    }
  }

  return runFlowchartLoop(ctx);
}

const INJECTABLE_STATUSES: ReadonlySet<RunStatus> = new Set([
  "PAUSED",
  "WAITING_FOR_USER",
  "BLOCKED",
  "RUNNING"
]);

async function restoreFlowchartSession(
  deps: FlowchartRunDeps,
  runId: RunId,
  results?: Readonly<Record<string, ChildNodeResult>>
): Promise<{ ctx: FlowchartLoopContext; replayed: ReconstructedRun }> {
  const now = deps.now ?? nowIso;
  const generateId = deps.generateId;
  const eventStore = new EventStore(deps.stateRoot, runId);
  const checkpointStore = new CheckpointStore(deps.stateRoot, runId);
  const read = await eventStore.readAll();
  if (read.events.length === 0) {
    throw new DomainValidationError(`Run ${runId} not found`);
  }
  const replayed = replayRun(read.events);
  if (replayed.run === undefined) {
    throw new DomainValidationError(`Run ${runId} has no RUN_CREATED event`);
  }
  if (replayed.project === undefined) {
    throw new DomainValidationError(`Run ${runId} has no PROJECT_DISCOVERED event`);
  }
  const raw = await checkpointStore.read();
  if (raw === undefined) {
    throw new DomainValidationError(
      `Flowchart run ${runId} has no durable checkpoint; refusing to invent state`
    );
  }
  const checkpoint = validateCheckpoint(raw);
  if (checkpoint.flowchart === undefined) {
    throw new DomainValidationError(`Flowchart run ${runId} checkpoint is missing flowchart snapshot`);
  }
  const { definition, snapshot, limits } = checkpoint.flowchart;
  const supervisor = restoreFlowchartSupervisor(
    {
      flowchart: await flowchartForSupervisor(deps.stateRoot, replayed.project.rootPath, definition),
      router: deps.router,
      limits,
      runId,
      ...(generateId !== undefined ? { generateId } : {}),
      now
    },
    snapshot
  );
  const ctx: FlowchartLoopContext = {
    supervisor,
    definition,
    flowchartLimits: limits,
    maxRounds: replayed.run.limits.maxRounds,
    results: childResultsMap(results),
    eventStore,
    checkpointStore,
    append: (event) => eventStore.append(event),
    make: makeEventFactory(runId, now, generateId),
    now,
    project: replayed.project,
    runId,
    stateRoot: deps.stateRoot,
    abort: new RunAbortScope(),
    childByTaskId: childTaskMap([]),
    finishedChildren: new Map<TaskId, ChildRunOutcome>(),
    spawnHandles: [],
    ...(generateId !== undefined ? { generateId } : {}),
    ...(deps.pause !== undefined ? { pause: deps.pause } : {})
  };
  return { ctx, replayed };
}

export async function pauseFlowchartRun(
  deps: FlowchartRunDeps,
  runId: RunId,
  reason?: string
): Promise<FlowchartRunOutcome> {
  const { ctx, replayed } = await restoreFlowchartSession(deps, runId);
  if (
    replayed.status === "COMPLETED" ||
    replayed.status === "FAILED" ||
    replayed.status === "CANCELLED" ||
    replayed.status === "BLOCKED"
  ) {
    throw new DomainValidationError(`cannot pause a ${replayed.status} run`);
  }
  const pause = deps.pause ?? createFilePauseController(deps.stateRoot, ctx.now);
  const token = await pause.requestPause(runId, reason);
  const read = await ctx.eventStore.readAll();
  if (!hasUnmatchedPause(read.events)) {
    await ctx.append(
      ctx.make("PAUSE_REQUESTED", token.reason !== undefined ? { reason: token.reason } : {})
    );
  }
  return finish(ctx);
}

export async function injectFlowchartRun(
  deps: FlowchartRunDeps,
  runId: RunId,
  request: unknown
): Promise<FlowchartRunOutcome> {
  const { ctx, replayed } = await restoreFlowchartSession(deps, runId);
  if (!INJECTABLE_STATUSES.has(replayed.status)) {
    throw new DomainValidationError(`cannot inject into a ${replayed.status} run`);
  }
  const policy = defaultDecisionPolicy(ctx.flowchartLimits.minHumanConfidence ?? DEFAULT_HUMAN_CONFIDENCE);
  const injection = validateInjection(request, {
    policy,
    nodeState: (nodeId) => {
      try {
        return ctx.supervisor.nodeState(nodeId);
      } catch {
        return undefined;
      }
    }
  });
  const injectMake = makeEventFactory(runId, ctx.now, ctx.generateId, injection.actor);
  await ctx.append(injectMake("INJECTION_REQUESTED", injectionEventPayload(injection)));
  ctx.supervisor.applyInjection(injection);
  const advanced = ctx.supervisor.advanceRound();
  await persistLedger(ctx);
  if (advanced.blocked) {
    await persistBlocked(ctx);
  }
  return finish(ctx);
}
