import { DomainValidationError } from "../domain/errors.js";
import {
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
import type { RunStatus } from "../domain/status.js";
import { nowIso, type IsoTimestamp } from "../domain/timestamp.js";
import {
  DEFAULT_HUMAN_CONFIDENCE,
  defaultDecisionPolicy,
  validateApprovalReplyAgainstPlan,
  type ApprovalReply,
  type Flowchart
} from "../domain/flowchart.js";
import { discoverProject } from "../project/discovery.js";
import type { ModelRouter, RoutingDecision } from "../supervisor/model-router.js";
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
import type { Event, ModelRoutedPayload } from "./events.js";
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
}

export interface FlowchartRunInput {
  projectRoot: string;
  flowchart: Flowchart;
  objective?: string;
  limits?: Partial<FlowchartRunLimits> & { maxRounds?: number };
  /** Fake child results keyed by node id; applied when that node is RUNNING. */
  childResults?: Readonly<Record<string, ChildNodeResult>>;
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
    estimatedDurationMs: decision.estimatedDurationMs
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
  const read = await ctx.eventStore.readAll();
  if (hasEvent(read.events, "RUN_FAILED")) return;
  await ctx.append(ctx.make("RUN_FAILED", { reason }));
}

async function finish(ctx: FlowchartLoopContext): Promise<FlowchartRunOutcome> {
  const checkpoint = await persistCheckpoint(ctx);
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

    const applied = applyRunningResults(ctx.supervisor, ctx.definition, ctx.results);
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
    flowchart: input.flowchart,
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
  await append(make("RUN_STARTED", {}));

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
    ...(generateId !== undefined ? { generateId } : {}),
    ...(deps.pause !== undefined ? { pause: deps.pause } : {})
  };
  await persistCheckpoint(ctx);
  return runFlowchartLoop(ctx);
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
      flowchart: definition,
      router: deps.router,
      limits,
      runId,
      ...(generateId !== undefined ? { generateId } : {}),
      now
    },
    snapshot
  );

  const make = makeEventFactory(runId, now, generateId);
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
    ...(generateId !== undefined ? { generateId } : {}),
    ...(deps.pause !== undefined ? { pause: deps.pause } : {})
  };

  if (continuation.unpause === true) {
    const pause = deps.pause ?? createFilePauseController(deps.stateRoot, now);
    await pause.clearPause(runId);
    const latest = await eventStore.readAll();
    if (hasUnmatchedPause(latest.events)) {
      await ctx.append(ctx.make("PAUSE_CLEARED", {}));
    }
  }

  const latestReplay = replayRun((await eventStore.readAll()).events);
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

  const applied = applyRunningResults(ctx.supervisor, definition, ctx.results);
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
      flowchart: definition,
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
