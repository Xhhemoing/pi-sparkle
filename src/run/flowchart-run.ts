import { DomainValidationError } from "../domain/errors.js";
import {
  createAgentInstanceId,
  createEventId,
  createRunId,
  createTaskId,
  type EventId,
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
import { cheapFirstTiers } from "../routing/live-cascade.js";
import type { ChildRunLimits, TaskRequest } from "../protocol/v1.js";
import {
  ChildCoordinator,
  type ChildRunHandle,
  type ChildRunOutcome,
  type ChildTaskInput
} from "./child-coordinator.js";
import { groundChildTask } from "./child-grounding.js";
import { applyChildThreeLine } from "./child-tracking.js";
import { summarizeClusterMail, withRunLifecycleLock, type ClusterMailReport } from "./coordinator.js";
import { recordCrashTerminal } from "./crash-terminal.js";
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
  reopenBlockedFlowchartSnapshot,
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
import type { FileLockOptions } from "../persist/file-lock.js";
import { routingContextFields, type Event, type ModelRoutedPayload } from "./events.js";
import { injectionEventPayload, validateInjection } from "./injection.js";
import { createFilePauseController, type PauseController } from "./pause-controller.js";
import {
  hasUnmatchedPause,
  materializeCheckpoint,
  replayedTerminalStatus,
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
  /** Bounds the run's own acquisition of {@link withRunLifecycleLock}. */
  runLock?: FileLockOptions;
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
  /**
   * The requirement contract the run started under. A resume that is given one
   * assesses its children against it, exactly as {@link startFlowchartRun}
   * does; a resume that is not still assesses them against none.
   *
   * It has to be supplied because nothing durable carries it: the contract
   * reaches a run through `startFlowchartRun`'s input, and only its acceptance
   * criteria survive, on the bound episode. The constraints the tracking gate
   * reads are on no record a run id can reach — see the disclosure in
   * `.agent_workspace/loop4-r7-t1.md`.
   */
  contract?: RequirementContract;
}

export interface FlowchartRunOutcome {
  runId: RunId;
  status: RunStatus;
  events: Event[];
  checkpoint: RunCheckpoint;
  project: ProjectSnapshot;
  snapshot: FlowchartSupervisorSnapshot;
  pendingApproval?: PendingApproval;
  /** Undelivered peer mail; absent when the run had no cluster. */
  clusterMail?: ClusterMailReport;
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

/**
 * The catalog fields {@link cheapFirstTiers} reads.
 *
 * It comes from the resuming process's own router, not from the log: the log
 * records which model ids were eligible, but not their versions or costs, so
 * the tiers have to be re-derived against a live catalog. A resume configured
 * against a different catalog therefore rebuilds different tiers — the same
 * exposure a fresh start has, and the reason the run's router is the source
 * rather than a second one built here.
 */
type CascadeCatalog = readonly {
  readonly id: string;
  readonly version?: string;
  readonly estimatedCostUsd: number;
}[];

/**
 * The last `TASK_REQUEST` the log carries per task.
 *
 * Every attempt records one and they differ only in the message envelope, so
 * the last is the run's most recent statement of what that node was asked to
 * do. A node an earlier resume already re-specified therefore rebuilds to the
 * spec that resume really sent: the rebuild is a fixed point, not a second
 * guess layered on the first.
 */
function loggedTaskRequests(events: readonly Event[]): Map<TaskId, TaskRequest> {
  const requests = new Map<TaskId, TaskRequest>();
  for (const event of events) {
    if (event.type !== "CHILD_MESSAGE") continue;
    const message = event.payload.message;
    if (message.type !== "TASK_REQUEST") continue;
    requests.set(message.taskId, message);
  }
  return requests;
}

/**
 * The routing decision that carries a task's true {@link AgentRole}.
 *
 * Two producers write `MODEL_ROUTED` for one task: the pre-run assignment,
 * which knows the `AgentRole` the caller asked for, and the supervisor's
 * per-node routing, which only knows the flowchart role — and that role has
 * already coarsened `tester` into `actor`. Only the assignment is a record of
 * the child's spec, so this selects on `agentRole` rather than taking the
 * first or the last event for the task. Taking the wrong one silently
 * reintroduces the coarsening the rebuild exists to remove.
 */
function assignedRoutes(events: readonly Event[]): Map<TaskId, ModelRoutedPayload> {
  const routes = new Map<TaskId, ModelRoutedPayload>();
  for (const event of events) {
    if (event.type !== "MODEL_ROUTED") continue;
    if (event.payload.agentRole === undefined) continue;
    routes.set(event.payload.taskId, event.payload);
  }
  return routes;
}

/**
 * The per-attempt timeout a substituted budget gets. `RunLimits` carries no
 * per-attempt field, so this is the one number no source on the log can
 * supply; it is the value every rebuilt child used to get for all three.
 */
const FALLBACK_CHILD_TIMEOUT_MS = 60_000;

/**
 * The budget for a node the log has never seen run.
 *
 * Such a node has no request to reconstruct, so the rebuild substitutes one —
 * but from a budget this run's caller actually authorised: a sibling's logged
 * request first, then the run's own declared per-task limits. The old rebuild
 * handed every resumed child `{2, 60_000, 3_600_000}` whatever the caller had
 * asked for, which is how a resumed node came to be able to spend twelve times
 * the caller's wall budget.
 */
function fallbackChildLimits(
  events: readonly Event[],
  requests: ReadonlyMap<TaskId, TaskRequest>
): ChildRunLimits {
  const sibling = requests.values().next();
  if (sibling.done !== true) return sibling.value.limits;
  for (const event of events) {
    if (event.type !== "RUN_CREATED") continue;
    const limits = event.payload.run.limits;
    return {
      maxAttempts: limits.maxAttemptsPerTask,
      timeoutMs: FALLBACK_CHILD_TIMEOUT_MS,
      maxWallTimeMs: limits.maxWallTimeMs
    };
  }
  const defaults = defaultRunLimits();
  return {
    maxAttempts: defaults.maxAttemptsPerTask,
    timeoutMs: FALLBACK_CHILD_TIMEOUT_MS,
    maxWallTimeMs: defaults.maxWallTimeMs
  };
}

/** Predecessor task ids per task, read off the checkpointed edges. */
function dependenciesByTask(definition: Flowchart): Map<TaskId, TaskId[]> {
  const taskIdByNode = new Map(definition.nodes.map((node) => [node.id, node.taskId]));
  const dependencies = new Map<TaskId, TaskId[]>();
  for (const edge of definition.edges) {
    const from = taskIdByNode.get(edge.from);
    const to = taskIdByNode.get(edge.to);
    if (from === undefined || to === undefined) continue;
    const existing = dependencies.get(to);
    if (existing === undefined) dependencies.set(to, [from]);
    else if (!existing.includes(from)) existing.push(from);
  }
  return dependencies;
}

/**
 * The child specs a resumed run relaunches, rebuilt from the parent log.
 *
 * The checkpointed definition is the *node set*: which nodes exist, and which
 * of them are children at all. The log is the *spec source*: `TASK_REQUEST`
 * carries the objective, artifacts, acceptance criteria and budget the caller
 * wrote, and the assignment's `MODEL_ROUTED` carries the true `AgentRole` plus
 * the `highRisk` and `eligibleModels` that regenerate the cascade through the
 * shipped planner. Nothing here needs a schema — every field was already
 * durable, which is why R4-6's refusal to persist executor config does not
 * apply to child specs.
 *
 * The predecessor it replaces, `childTasksFromDefinition`, synthesised each
 * spec from the node alone: empty criteria, empty artifacts, no model, no
 * cascade, the role coarsened back to `implementer`, and one hard-coded budget
 * for every caller. A resumed child was not the child the run started.
 */
function childTasksFromLog(
  events: readonly Event[],
  definition: Flowchart,
  registry: AgentProfileRegistry,
  catalog: CascadeCatalog
): ChildTaskInput[] {
  const requests = loggedTaskRequests(events);
  const routes = assignedRoutes(events);
  const substituted = fallbackChildLimits(events, requests);
  const dependencies = dependenciesByTask(definition);
  const tasks: ChildTaskInput[] = [];
  for (const node of definition.nodes) {
    // The definition decides membership, so a resume launches children for the
    // same nodes it always did; the log only decides what they are asked to do.
    const nodeRole = mappedAgentRole(node.role);
    if (nodeRole === undefined) continue;
    const request = requests.get(node.taskId);
    const routed = routes.get(node.taskId);
    const role = routed?.agentRole ?? nodeRole;
    const dependsOn = dependencies.get(node.taskId) ?? [];
    tasks.push({
      taskId: node.taskId,
      role,
      objective: request?.objective ?? node.objective,
      profile: registry.resolve(role),
      inputArtifactIds: request === undefined ? [] : [...request.inputArtifactIds],
      acceptanceCriteria: request === undefined ? [] : [...request.acceptanceCriteria],
      limits: request?.limits ?? substituted,
      ...(dependsOn.length > 0 ? { dependsOn } : {}),
      ...(routed !== undefined
        ? {
            assignedModel: routed.model,
            cascade: {
              highRisk: routed.highRisk,
              tiers: cheapFirstTiers(routed.eligibleModels, catalog)
            }
          }
        : {})
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
  clusterHost?: ClusterHost;
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
    index: buildProjectContextIndex(input.project),
    ...(clusterHost !== undefined ? { clusterHost } : {})
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
  clusterHost?: ClusterHost;
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
    limits: ctx.flowchartLimits,
    // Written on every checkpoint, not just the pre-loop one: a resume, a
    // pause and an injection all rewrite this record, and a writer that
    // omitted the contract would silently strip it from the run.
    ...(ctx.contract !== undefined ? { contract: ctx.contract } : {})
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

/**
 * The run's terminal is whatever its log already replays.
 *
 * The three terminal recorders below all consult this before appending, so a run
 * records exactly one terminal — the first one that landed. The case that forced
 * the rule: a clustered child that returns `outcome: SUCCESS` with
 * `verification: { kind: "FAILED" }` drives the three-line gate to
 * `queue_analysis`, which appends `RUN_BLOCKED` ("terminal BLOCKED until an
 * explicit unblock", per `gate-apply.ts`), and the same result fails the node, so
 * the loop then reached {@link persistFailed}. The log said BLOCKED and FAILED at
 * once, `replayRun` flagged it, and the FAILED buried a state
 * {@link RESUMABLE_CRASH_STATUSES} and `INJECTABLE_STATUSES` both treat as
 * operator-actionable. The gate wins: that run ends BLOCKED with the analysis
 * queued, and stays resumable.
 *
 * Refusing is silent by construction — a terminal the log already carries is not
 * news, and the loop reports the status it replays either way.
 */
async function alreadyTerminal(ctx: FlowchartLoopContext): Promise<boolean> {
  const read = await ctx.eventStore.readAll();
  return replayedTerminalStatus(read.events) !== undefined;
}

async function persistBlocked(ctx: FlowchartLoopContext): Promise<void> {
  if (await alreadyTerminal(ctx)) return;
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
  if (await alreadyTerminal(ctx)) return;
  await ctx.append(ctx.make("RUN_COMPLETED", {}));
}

async function persistFailed(ctx: FlowchartLoopContext, reason: string): Promise<void> {
  // Stop paying for children before recording the failure, not after.
  await ctx.abort.cancelAndSettle();
  if (await alreadyTerminal(ctx)) return;
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
    ...(pendingApproval !== undefined ? { pendingApproval } : {}),
    // Read after teardown: every child that could still claim role mail has
    // settled, so what is left here is what the run lost.
    ...(ctx.clusterHost !== undefined ? { clusterMail: summarizeClusterMail(ctx.clusterHost) } : {})
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
 * The log states a crash leaves resumable. Each one is an answer the operator
 * still owes the run, so {@link recordCrashTerminal} deliberately records no
 * terminal for them — which makes the durable checkpoint, not a terminal event,
 * the thing the next process reads.
 */
const RESUMABLE_CRASH_STATUSES: ReadonlySet<RunStatus> = new Set(["PAUSED", "WAITING_FOR_USER", "BLOCKED"]);

/**
 * Levels the durable resume point with the state the dying process had already
 * applied, for the runs that get no terminal.
 *
 * Every node result is applied to the supervisor before the checkpoint that
 * records it is written, so a crash in that window leaves the checkpoint one
 * node behind the log. A run that also gets a terminal does not care — resume
 * reports the failure and runs nothing. A run that stays resumable does: resume
 * restores that stale checkpoint and re-executes, and re-paying for a node the
 * operator's own paused run had already finished is silent lost work.
 *
 * This narrows the window to nodes that were still in flight when the crash
 * landed. Those are re-executed on resume — at-least-once, as everywhere else —
 * and the interrupted attempt keeps its own child run and its own entry in the
 * parent log, so the retry is inspectable rather than silent. Best effort
 * throughout: a checkpoint that cannot be written leaves the previous one in
 * place, exactly as before.
 */
async function preserveResumableState(ctx: FlowchartLoopContext): Promise<void> {
  try {
    const read = await ctx.eventStore.readAll();
    if (!RESUMABLE_CRASH_STATUSES.has(replayRun(read.events).status)) return;
    await persistCheckpoint(ctx);
  } catch {
    // Best effort: see the contract above.
  }
}

/**
 * Tears the run down when an error escapes. A throw from mid node (a child that
 * fails to launch, a rejected append) never reaches {@link finish}, so without
 * this the children started for that node keep running with nobody awaiting
 * them, the log ends mid-flight with no terminal event, and a run that stays
 * resumable ends with a checkpoint behind its own log.
 */
async function withRunTeardown(
  ctx: FlowchartLoopContext,
  body: () => Promise<FlowchartRunOutcome>
): Promise<FlowchartRunOutcome> {
  try {
    return await body();
  } catch (error) {
    // Same order as persistFailed: stop paying for children, then record. The
    // terminal comes first so a run that just got one is no longer resumable
    // when the checkpoint flush reads the log back.
    await ctx.abort.cancelAndSettle();
    await recordCrashTerminal(ctx, error);
    await preserveResumableState(ctx);
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
  // Everything that can refuse the run before it has written anything stays
  // outside the lock: a refused start must leave the state root untouched, and
  // acquiring the lock would create `runtime/runs/` for a run that never
  // happened.
  const resolved = resolveLimits(input.limits);
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
  const project = await discoverProject(input.projectRoot, {
    now,
    ...(generateId !== undefined ? { generateId } : {})
  });
  // From here the run writes records, so it holds the run lock until teardown
  // has finished: a `delete --run` waits for it rather than removing its
  // subtree mid-flight. The trade that buys, and the writers it blocks, are
  // stated on the helper.
  return withRunLifecycleLock(
    deps.stateRoot,
    runId,
    () => startLockedFlowchartRun(deps, input, { runId, now, generateId, resolved, project }),
    deps.runLock
  );
}

interface StartedRunPreflight {
  readonly runId: RunId;
  readonly now: () => IsoTimestamp;
  readonly generateId: IdGenerator | undefined;
  readonly resolved: { flowchart: FlowchartRunLimits; maxRounds: number };
  readonly project: ProjectSnapshot;
}

async function startLockedFlowchartRun(
  deps: FlowchartRunDeps,
  input: FlowchartRunInput,
  preflight: StartedRunPreflight
): Promise<FlowchartRunOutcome> {
  const { runId, now, generateId, resolved, project } = preflight;
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
  let clusterHost: ClusterHost | undefined;
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
    clusterHost = attached.clusterHost;
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
    ...(clusterHost !== undefined ? { clusterHost } : {}),
    ...(index !== undefined ? { index } : {}),
    ...(input.contract !== undefined ? { contract: input.contract } : {})
  };
  await persistCheckpoint(ctx);
  return withRunTeardown(ctx, () => runFlowchartLoop(ctx));
}

/** Position of an event id in the log, or `-1` when it is not on it. */
function eventIndex(events: readonly Event[], id: EventId | undefined): number {
  return id === undefined ? -1 : events.findIndex((event) => event.id === id);
}

/**
 * The unblock a durable checkpoint has not caught up with, if any.
 *
 * `unblockFlowchartRun` appends its authorization before it writes the reopened
 * checkpoint, so a crash between the two leaves the log unblocked and the
 * checkpoint still describing the block. Every restore path closes that window
 * by re-deriving the same transform — and closes it *idempotently*, by
 * comparing the clearing unblock's position with `checkpoint.lastEventId`
 * rather than re-applying whenever the log carries one. A checkpoint that
 * already includes the reopen is left exactly as it is.
 */
function unappliedUnblock(
  events: readonly Event[],
  replayed: ReconstructedRun,
  checkpoint: RunCheckpoint
): Extract<Event, { type: "RUN_UNBLOCKED" }> | undefined {
  const at = eventIndex(events, replayed.clearingUnblockEventId);
  if (at < 0 || eventIndex(events, checkpoint.lastEventId) >= at) return undefined;
  const event = events[at];
  return event !== undefined && event.type === "RUN_UNBLOCKED" ? event : undefined;
}

/**
 * The supervisor a durable checkpoint describes, brought level with an unblock
 * the checkpoint predates. Shared by every restore path so a pause or an
 * inject taken in that crash window cannot checkpoint the reopen back out.
 */
async function restoreCheckpointedSupervisor(input: {
  readonly deps: FlowchartRunDeps;
  readonly runId: RunId;
  readonly projectRoot: string;
  readonly events: readonly Event[];
  readonly replayed: ReconstructedRun;
  readonly checkpoint: RunCheckpoint;
  readonly flowchart: FlowchartCheckpointState;
  readonly now: () => IsoTimestamp;
  readonly generateId: IdGenerator | undefined;
}): Promise<FlowchartSupervisor> {
  const { definition, snapshot, limits } = input.flowchart;
  const config = {
    flowchart: await flowchartForSupervisor(input.deps.stateRoot, input.projectRoot, definition),
    router: input.deps.router,
    limits,
    runId: input.runId,
    ...(input.generateId !== undefined ? { generateId: input.generateId } : {}),
    now: input.now
  };
  const pending = unappliedUnblock(input.events, input.replayed, input.checkpoint);
  const restored =
    pending === undefined
      ? snapshot
      : reopenBlockedFlowchartSnapshot(
          config,
          snapshot,
          pending.payload.retryNodeId !== undefined
            ? { retryNodeId: pending.payload.retryNodeId }
            : {}
        );
  return restoreFlowchartSupervisor(config, restored);
}

export async function resumeFlowchartRun(
  deps: FlowchartRunDeps,
  runId: RunId,
  continuation: FlowchartContinuation = {}
): Promise<FlowchartRunOutcome> {
  // Same acquisition as a fresh start, and it also serializes a resume against
  // the run it is resuming: two processes cannot drive one run's records at
  // once, and neither can drive them while a delete holds the lock.
  return withRunLifecycleLock(
    deps.stateRoot,
    runId,
    () => resumeLockedFlowchartRun(deps, runId, continuation),
    deps.runLock
  );
}

async function resumeLockedFlowchartRun(
  deps: FlowchartRunDeps,
  runId: RunId,
  continuation: FlowchartContinuation
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

  const { definition, limits } = checkpoint.flowchart;
  // An explicit continuation stays authoritative — an embedder that hands the
  // resume a contract meant that one — while an ordinary CLI resume, which has
  // only a run id, recovers the run's own durable value.
  const contract = continuation.contract ?? checkpoint.flowchart.contract;
  const supervisor = await restoreCheckpointedSupervisor({
    deps,
    runId,
    projectRoot: replayed.project.rootPath,
    events: read.events,
    replayed,
    checkpoint,
    flowchart: checkpoint.flowchart,
    now,
    generateId
  });

  const make = makeEventFactory(runId, now, generateId);
  const abort = new RunAbortScope();
  const registry = deps.registry ?? createAgentProfileRegistry(defaultAgentProfiles());
  // Reuses the read the resume already did: the log is the spec source, and
  // reading it twice would only widen the window for the two copies to differ.
  const rebuilt =
    deps.executor !== undefined
      ? childTasksFromLog(read.events, definition, registry, deps.router.config.models)
      : [];
  const childByTaskId = childTaskMap(rebuilt);
  const finishedChildren = new Map<TaskId, ChildRunOutcome>();
  let spawnHandles: ChildRunHandle[] = [];
  let childCoordinator: ChildCoordinator | undefined;
  let clusterHost: ClusterHost | undefined;
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
    clusterHost = attached.clusterHost;
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
    ...(clusterHost !== undefined ? { clusterHost } : {}),
    ...(index !== undefined ? { index } : {}),
    ...(contract !== undefined ? { contract } : {})
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
  const { definition, limits } = checkpoint.flowchart;
  const supervisor = await restoreCheckpointedSupervisor({
    deps,
    runId,
    projectRoot: replayed.project.rootPath,
    events: read.events,
    replayed,
    checkpoint,
    flowchart: checkpoint.flowchart,
    now,
    generateId
  });
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
    ...(deps.pause !== undefined ? { pause: deps.pause } : {}),
    // pause and inject both end in `finish` → `persistCheckpoint`. Without
    // this the next side command would rewrite the checkpoint without the
    // contract, and the run would lose it to an operator action that had
    // nothing to do with it.
    ...(checkpoint.flowchart.contract !== undefined ? { contract: checkpoint.flowchart.contract } : {})
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
  try {
    await persistLedger(ctx);
    if (advanced.blocked) {
      await persistBlocked(ctx);
    }
    return await finish(ctx);
  } catch (error) {
    // An injection applied here but never checkpointed is simply gone: the log
    // keeps `INJECTION_REQUESTED`, but resume rebuilds the supervisor from the
    // checkpoint and never replays it. Unlike the run's own teardown this
    // records no terminal — inject is a side channel that may be pointed at a
    // run another process is still driving, and failing that run from here
    // would be a lie.
    await preserveResumableState(ctx);
    throw error;
  }
}

export interface FlowchartUnblockRequest {
  /** The operator's audit rationale. Recorded verbatim; never derived. */
  readonly reason: string;
  /** The FAILED node to re-drive. Required when the block names one. */
  readonly retryNodeId?: string;
  /** Who authorized the transition; recorded as the event's actor. */
  readonly actor?: string;
}

/**
 * The node an unblock has to reopen, checked against the block it clears.
 *
 * A gate block records the turn it blocked on (`GATE_TRANSITION.turnId`, which
 * tracking assessments set to the child task id). When that turn's node is
 * FAILED, reopening anything else would spend the authorization while leaving
 * the run stuck on the same failure, so the operator must name it exactly.
 *
 * Blocks with no failed node behind them take no target: the stall shape has
 * none by construction, and demanding one for every gate block would leave
 * those runs permanently unblockable — the defect this contract exists to
 * remove.
 */
function gateBlockedFailedNode(
  events: readonly Event[],
  blockedEventId: EventId,
  definition: Flowchart,
  snapshot: FlowchartSupervisorSnapshot
): string | undefined {
  const at = eventIndex(events, blockedEventId);
  if (at < 0) return undefined;
  // `applyTrackingGate` writes the transition and the block in one apply, so
  // the newest transition before the block is the one that caused it.
  let turnId: string | undefined;
  for (let index = at - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event === undefined || event.type !== "GATE_TRANSITION") continue;
    if (event.payload.to === "BLOCKED") turnId = event.payload.turnId;
    break;
  }
  if (turnId === undefined) return undefined;
  const node = definition.nodes.find((entry) => entry.taskId === turnId);
  if (node === undefined) return undefined;
  return snapshot.nodes[node.id]?.state === "FAILED" ? node.id : undefined;
}

function resolveRetryTarget(
  events: readonly Event[],
  blockedEventId: EventId,
  definition: Flowchart,
  snapshot: FlowchartSupervisorSnapshot,
  requested: string | undefined
): string | undefined {
  const expected = gateBlockedFailedNode(events, blockedEventId, definition, snapshot);
  if (expected !== undefined && requested !== expected) {
    throw new DomainValidationError(
      requested === undefined
        ? `this block names failed node ${expected}: pass --retry-node ${expected} to reopen it`
        : `--retry-node ${requested} is not the failed node this block names (${expected})`
    );
  }
  return requested;
}

/**
 * Records the operator's authorization to end one block, and reopens the state
 * that block left behind. It executes nothing.
 *
 * This is a dedicated command rather than a fourth injection kind for three
 * reasons that all point the same way. Injection is a typed fact/override/skip
 * side channel whose job is to add information; an unblock changes the run's
 * lifecycle and how every writer reads its terminal. {@link injectFlowchartRun}
 * deliberately takes no lifecycle lock because it may target a live run, while
 * an unblock must serialize against resume and delete. And a separate command
 * can insist on exactly one active block, one matched event, and a refusal for
 * the second or stale attempt, without conflating that authorization with
 * user-supplied facts.
 *
 * Execution stays with resume, the surface that spends money. The operator flow
 * is inspect → unblock → resume, and each step is separately auditable because
 * of it.
 */
export async function unblockFlowchartRun(
  deps: FlowchartRunDeps,
  runId: RunId,
  request: FlowchartUnblockRequest
): Promise<FlowchartRunOutcome> {
  return withRunLifecycleLock(
    deps.stateRoot,
    runId,
    () => unblockLockedFlowchartRun(deps, runId, request),
    deps.runLock
  );
}

async function unblockLockedFlowchartRun(
  deps: FlowchartRunDeps,
  runId: RunId,
  request: FlowchartUnblockRequest
): Promise<FlowchartRunOutcome> {
  const now = deps.now ?? nowIso;
  const generateId = deps.generateId;
  const reason = request.reason.trim();
  if (reason === "") {
    throw new DomainValidationError("unblock requires a non-empty reason");
  }
  if (request.retryNodeId !== undefined && request.retryNodeId.trim() === "") {
    throw new DomainValidationError("unblock retry node must be a non-empty node id");
  }

  const eventStore = new EventStore(deps.stateRoot, runId);
  const checkpointStore = new CheckpointStore(deps.stateRoot, runId);
  const read = await eventStore.readAll();
  if (read.events.length === 0) {
    throw new DomainValidationError(`Run ${runId} not found`);
  }
  const replayed = replayRun(read.events);
  if (replayed.project === undefined) {
    throw new DomainValidationError(`Run ${runId} has no PROJECT_DISCOVERED event`);
  }
  // One active block, named by replay rather than re-derived here. A run that
  // is not blocked — including one an earlier unblock already cleared — has
  // nothing to authorize, and is refused before anything is written.
  const blockedEventId = replayed.activeBlockedEventId;
  if (replayed.status !== "BLOCKED" || blockedEventId === undefined) {
    throw new DomainValidationError(
      `cannot unblock a ${replayed.status} run: unblock clears one active RUN_BLOCKED`
    );
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
  const { definition, snapshot, limits, contract } = checkpoint.flowchart;
  const retryNodeId = resolveRetryTarget(
    read.events,
    blockedEventId,
    definition,
    snapshot,
    request.retryNodeId
  );

  // The transform runs before the append, so a refused reopen — an unknown
  // node, a node that never failed, a descendant that already executed —
  // leaves no authorization on a log that did not earn one.
  const reopened = reopenBlockedFlowchartSnapshot(
    {
      flowchart: await flowchartForSupervisor(deps.stateRoot, replayed.project.rootPath, definition),
      router: deps.router,
      limits,
      runId,
      ...(generateId !== undefined ? { generateId } : {}),
      now
    },
    snapshot,
    retryNodeId !== undefined ? { retryNodeId } : {}
  );

  const make = makeEventFactory(runId, now, generateId, request.actor ?? "operator");
  // Append first. A crash after this leaves the authorization on the log with a
  // checkpoint that still describes the block, which every restore path
  // recovers; the reverse — a reopened checkpoint with nothing on the log
  // authorizing it — is a state no reader could explain.
  await eventStore.append(
    make("RUN_UNBLOCKED", {
      blockedEventId,
      reason,
      ...(retryNodeId !== undefined ? { retryNodeId } : {})
    })
  );
  const after = await eventStore.readAll();
  const nextCheckpoint = validateCheckpoint(
    materializeCheckpoint(replayRun(after.events), now(), {
      definition,
      snapshot: reopened,
      limits,
      // The reopen rewrites the checkpoint from parts, so it has to carry the
      // run contract forward explicitly: authorizing a blocked run changes what
      // may execute, never what the run was asked to honour.
      ...(contract !== undefined ? { contract } : {})
    })
  );
  await checkpointStore.write(nextCheckpoint);
  return {
    runId,
    status: replayRun(after.events).status,
    events: after.events,
    checkpoint: nextCheckpoint,
    project: replayed.project,
    snapshot: reopened
  };
}
