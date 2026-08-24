import {
  createEventId,
  createRunId,
  createTaskId,
  type EventId,
  type IdGenerator,
  type RunId,
  type TaskId
} from "../domain/ids.js";
import { defaultRunLimits, type RunLimits } from "../domain/limits.js";
import type { ProjectSnapshot } from "../domain/project.js";
import type { Run } from "../domain/run.js";
import { assertTransitionTask, expandTaskTransition } from "../domain/state.js";
import type { RunStatus, TaskStatus } from "../domain/status.js";
import type { TaskNode } from "../domain/task.js";
import { nowIso, type IsoTimestamp } from "../domain/timestamp.js";
import type { AgentProfileRegistry } from "../agents/registry.js";
import type { AgentExecutor } from "../execution/contract.js";
import type { JudgeAdapter, JudgeDecision } from "../graph/judge.js";
import { DeterministicJudge } from "../graph/judge.js";
import { validateTaskGraph, type TaskGraph } from "../graph/validate.js";
import { discoverProject } from "../project/discovery.js";
import { advanceLedgerRound, classifyRoundProgress, createLedger, type LedgerRoundEvent, type RunLedger } from "../supervisor/ledger.js";
import { CheckpointStore } from "./checkpoint-store.js";
import { ChildCoordinator, type ChildRunOutcome } from "./child-coordinator.js";
import { EventStore } from "./event-store.js";
import type { Event } from "./events.js";
import { assertCoverageAllowsStart } from "../requirement/coverage.js";
import { applyTrackingGate, nextTrackingSeq } from "./gate-apply.js";
import { bindEpisodeToRun, settleBoundEpisode } from "./episode-bind.js";
import { hashAssessment, type TrackingAssessment } from "../tracking/types.js";
import {
  checkpointCarriesFlowchart,
  materializeCheckpoint,
  replayRun,
  validateCheckpoint,
  type RunCheckpoint
} from "./replay.js";
import { allDependenciesSatisfied } from "../graph/readiness.js";
import { applyRetry, applyTaskOutcome, LeaseRegistry, planRound, type TaskOutcome } from "./scheduler.js";
import { decideTopology } from "../routing/topology.js";
import type { TopologyDecision } from "../routing/topology.js";

/**
 * Topology planning API reserved for the supervised run loop.
 *
 * NOTE: the current run loop does NOT call this yet — the supervised rounds
 * need task-family semantics and remaining-budget bookkeeping before a
 * topology decision can be recorded per round (Checkpoint F / M6 owns that
 * integration; see the unchecked M5-T5 recording item in tasks/adaptive-plan.md).
 * Pure and deterministic — safe to call once integration lands.
 */
export interface TopologyInput {
  readonly taskFamily: string;
  readonly deterministicOnly: boolean;
  readonly highRisk: boolean;
  readonly ambiguousIntent: boolean;
  readonly deterministicFailure: boolean;
  readonly openEnded: boolean;
  readonly remainingBudgetUsd: number;
  readonly remainingTimeMs: number;
  readonly valuePerUtilityPointUsd?: number;
}

export function planTaskTopology(input: TopologyInput): TopologyDecision {
  return decideTopology({
    taskFamily: input.taskFamily,
    deterministicOnly: input.deterministicOnly,
    highRisk: input.highRisk,
    ambiguousIntent: input.ambiguousIntent,
    deterministicFailure: input.deterministicFailure,
    openEnded: input.openEnded,
    budget: {
      remainingBudgetUsd: input.remainingBudgetUsd,
      remainingTimeMs: input.remainingTimeMs,
    },
    valuePerUtilityPointUsd: input.valuePerUtilityPointUsd ?? 1,
  });
}

export interface SupervisorDeps {
  stateRoot: string;
  executor: AgentExecutor;
  registry: AgentProfileRegistry;
  judge?: JudgeAdapter;
  now?: () => IsoTimestamp;
  generateId?: IdGenerator;
}

export interface SupervisedRunInput {
  projectRoot: string;
  objective: string;
  tasks: TaskNode[];
  limits?: RunLimits;
  contract?: import("../domain/contract.js").RequirementContract;
  resolvedQuestionIds?: readonly string[];
}

export interface SupervisedRunOutcome {
  runId: RunId;
  status: RunStatus;
  events: Event[];
  checkpoint: RunCheckpoint;
  project: ProjectSnapshot;
}

export interface SupervisedRunHandle {
  runId: RunId;
  done: Promise<SupervisedRunOutcome>;
  cancel(): void;
}

const LEASE_MS = 300_000;

function toTaskOutcome(outcome: ChildRunOutcome["outcome"]): TaskOutcome {
  switch (outcome) {
    case "SUCCESS":
    case "PARTIAL":
      return "SUCCESS";
    case "FAILURE":
      return "FAILURE";
    case "TIMEOUT":
      return "TIMEOUT";
    case "CANCELLED":
      return "CANCELLED";
  }
}

/** Mutable supervisor state reconstructed from events for resume. */
export interface SupervisorState {
  graph: TaskGraph;
  statuses: Map<TaskId, TaskStatus>;
  attempts: Map<TaskId, number>;
  leases: LeaseRegistry;
  ledger: RunLedger;
}

export interface SupervisorContext {
  deps: SupervisorDeps;
  runId: RunId;
  project: ProjectSnapshot;
  run: Run;
  limits: RunLimits;
  now: () => IsoTimestamp;
  generateId: IdGenerator | undefined;
  judge: JudgeAdapter;
  eventStore: EventStore;
  checkpointStore: CheckpointStore;
  controller: AbortController;
  append: (event: Event) => Promise<void>;
  make: (type: Event["type"], payload: unknown, taskId?: TaskId) => Event;
}

/** Reconstructs supervisor state (graph, statuses, attempts, ledger, leases) from events. */
export function reconstructSupervisorState(
  events: readonly Event[],
  nowMs: () => number = () => Date.now()
): SupervisorState | undefined {
  let graph: TaskGraph | undefined;
  const statuses = new Map<TaskId, TaskStatus>();
  const attempts = new Map<TaskId, number>();
  let ledger: RunLedger | undefined;
  const leaseEnds = new Map<TaskId, { runId: RunId; expiresAt: number }>();

  for (const event of events) {
    switch (event.type) {
      case "TASK_GRAPH_ACCEPTED":
        graph = validateTaskGraph(event.payload.tasks);
        for (const node of graph.tasks) {
          if (!statuses.has(node.id)) statuses.set(node.id, "PENDING");
        }
        break;
      case "TASK_STATUS_CHANGED": {
        const { taskId, status, attempt } = event.payload;
        statuses.set(taskId, status);
        attempts.set(taskId, attempt);
        break;
      }
      case "TASK_LEASED": {
        const { taskId, childRunId, expiresAt } = event.payload;
        leaseEnds.set(taskId, { runId: childRunId, expiresAt: Date.parse(expiresAt) });
        break;
      }
      case "LEDGER_UPDATED": {
        const payload = event.payload;
        if (ledger === undefined) {
          ledger = createLedger("", 3);
        }
        ledger = {
          ...ledger,
          revision: payload.revision,
          round: payload.round,
          consecutiveStalls: payload.consecutiveStalls,
          isBlocked: payload.isBlocked
        };
        break;
      }
      default:
        break;
    }
  }

  if (graph === undefined) return undefined;
  if (ledger === undefined) ledger = createLedger("", 3);

  // Rebuild leases for RUNNING tasks. Resume treats them as orphaned — there
  // is no live worker — so runSupervisorRounds recovers them immediately.
  const leases = new LeaseRegistry(nowMs);
  for (const [taskId, lease] of Array.from(leaseEnds)) {
    if (statuses.get(taskId) === "RUNNING") {
      leases.restore({
        taskId,
        runId: lease.runId,
        leasedAt: new Date(lease.expiresAt - LEASE_MS).toISOString() as IsoTimestamp,
        expiresAt: new Date(lease.expiresAt).toISOString() as IsoTimestamp
      });
    }
  }

  return { graph, statuses, attempts, leases, ledger };
}

const CRASH_REASON_LIMIT = 500;

/** The escaping error, as a bounded non-empty `RUN_FAILED` reason. */
function crashReason(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error)).trim();
  const detail = message === "" ? "unknown error" : message;
  const bounded = detail.length <= CRASH_REASON_LIMIT ? detail : `${detail.slice(0, CRASH_REASON_LIMIT)}…`;
  return `run crashed: ${bounded}`;
}

/**
 * Records the terminal event for a supervised run that died by an escaping
 * error, so replay sees a failure instead of a log that just stops mid-round.
 * The same two limits the flowchart and child planes apply:
 *
 * - Only a log still reading as in flight gets one. A run already recorded as
 *   cancelled, blocked or finished has an honest status of its own, and a crash
 *   on the way out must neither duplicate that terminal nor bury it.
 * - Every failure here is swallowed. The error on its way out is the one worth
 *   reporting.
 */
async function recordCrashTerminal(ctx: SupervisorContext, error: unknown): Promise<void> {
  try {
    const read = await ctx.eventStore.readAll();
    const status = replayRun(read.events).status;
    if (status !== "PLANNING" && status !== "RUNNING") return;
    await ctx.append(ctx.make("RUN_FAILED", { reason: crashReason(error) }));
  } catch {
    // Best effort: an append that cannot land must not mask the original error.
  }
}

/**
 * Runs the supervised rounds and guarantees the log ends honestly. An error
 * that escapes the loop — a judge that throws, a rejected append, a child that
 * fails to launch — used to leave the run replaying RUNNING forever; it now
 * records a terminal first and is rethrown regardless, so the caller still
 * learns the run crashed.
 */
export async function runSupervisorRounds(
  ctx: SupervisorContext,
  state: SupervisorState,
  objective: string
): Promise<{ status: RunStatus; reason?: string }> {
  try {
    return await executeSupervisorRounds(ctx, state, objective);
  } catch (error) {
    await recordCrashTerminal(ctx, error);
    throw error;
  }
}

async function executeSupervisorRounds(
  ctx: SupervisorContext,
  state: SupervisorState,
  _objective: string
): Promise<{ status: RunStatus; reason?: string }> {
  const { limits, now, generateId, judge, append, make, deps, controller } = ctx;
  const { graph, statuses, attempts, leases, ledger } = state;
  let finalStatus: RunStatus = "RUNNING";
  let finalReason: string | undefined;

  const recordStatus = async (taskId: TaskId, status: TaskStatus, attempt: number): Promise<void> => {
    const from = statuses.get(taskId) ?? "PENDING";
    const steps = expandTaskTransition(from, status);
    let current = from;
    for (const step of steps) {
      assertTransitionTask(current, step);
      statuses.set(taskId, step);
      attempts.set(taskId, attempt);
      await append(make("TASK_STATUS_CHANGED", { taskId, status: step, attempt }, taskId));
      current = step;
    }
  };

  // BLOCKED -> READY goes through the scheduler's declared rule rather than a
  // literal, so editing that rule changes what the supervisor does. The status
  // handed to it is the one just recorded, not the graph node's stale copy,
  // which is what makes its guard real: a retry can only follow a recorded
  // BLOCKED.
  const recordRetry = async (node: TaskNode, attempt: number): Promise<void> => {
    const retry = applyRetry({ ...node, status: statuses.get(node.id) ?? "PENDING", attempt });
    await recordStatus(node.id, retry.status, retry.attempt);
  };

  let cancelRecorded = false;
  const recordCancel = async (): Promise<void> => {
    if (cancelRecorded) return;
    cancelRecorded = true;
    finalStatus = "CANCELLED";
    await append(make("RUN_CANCEL_REQUESTED", {}));
  };

  // Recover orphaned leases: a reconstructed RUNNING lease has no live worker.
  // Nothing expires a lease (see LeaseRegistry), so every restored lease is
  // recovered here unconditionally rather than on a wall-clock deadline. The
  // appended event type is still TASK_LEASE_EXPIRED — its name predates this
  // contract; orphaning, not expiry, is what triggers it.
  for (const lease of leases.list()) {
    const node = graph.byId.get(lease.taskId);
    if (node === undefined) continue;
    const attempt = (attempts.get(lease.taskId) ?? 0) + 1;
    const transition = applyTaskOutcome({ ...node, attempt: attempt - 1 }, "TIMEOUT");
    await append(make("TASK_LEASE_EXPIRED", { taskId: lease.taskId, childRunId: lease.runId }, lease.taskId));
    await recordStatus(lease.taskId, transition.status, transition.attempt);
    if (transition.status === "BLOCKED") {
      await recordRetry(node, transition.attempt);
    }
    leases.release(lease.taskId);
  }

  const startRound = ledger.round + 1;
  for (let round = startRound; round <= limits.maxRounds; round += 1) {
    if (controller.signal.aborted) {
      await recordCancel();
      break;
    }

    const ready = planRound(graph, statuses, limits.maxConcurrentTasks, leases);
    if (ready.length === 0) {
      const lookup = (id: TaskId): TaskStatus => statuses.get(id) ?? "PENDING";
      const failed = graph.tasks.filter((node) => lookup(node.id) === "FAILED");
      const canProgress = graph.tasks.some((node) => {
        const status = lookup(node.id);
        if (status === "READY" || status === "RUNNING" || status === "BLOCKED") return true;
        if (status !== "PENDING") return false;
        return allDependenciesSatisfied(node, lookup);
      });
      if (!canProgress) {
        if (failed.length > 0) {
          finalStatus = "FAILED";
          finalReason = "required tasks failed";
          await append(make("RUN_FAILED", { reason: finalReason }));
          break;
        }
        finalStatus = "COMPLETED";
        await append(make("RUN_COMPLETED", {}));
        break;
      }
      // A stalled round: no admissible progress evidence.
      const roundEvent: LedgerRoundEvent = {
        completedTasks: [],
        newEvidenceIds: [],
        newFacts: [],
        resolvedBlockers: [],
        userDecision: false
      };
      const progress = classifyRoundProgress(roundEvent, ledger);
      const advanced = advanceLedgerRound(ledger, progress, limits.maxConsecutiveStalls, {
        event: roundEvent,
        timestamp: now()
      });
      Object.assign(ledger, advanced);
      await append(
        make(
          "LEDGER_UPDATED",
          {
            revision: ledger.revision,
            round: ledger.round,
            consecutiveStalls: ledger.consecutiveStalls,
            isBlocked: ledger.isBlocked
          },
          ready[0]
        )
      );
      if (ledger.isBlocked) {
        finalStatus = "BLOCKED";
        const requiredEvidence = ledger.requiredEvidence.map((entry) => entry.description);
        await append(make("STALL_DETECTED", { round, consecutiveStalls: ledger.consecutiveStalls, requiredEvidence }));
        await append(make("RUN_BLOCKED", { reason: "no progress for too many rounds", requiredEvidence }));
        break;
      }
      continue;
    }

    // Execute the round's ready tasks concurrently on a single ChildCoordinator.
    const roundEvent: LedgerRoundEvent = {
      completedTasks: [],
      newEvidenceIds: [],
      newFacts: [],
      resolvedBlockers: [],
      userDecision: false
    };

    const childCoordinator = new ChildCoordinator({
      stateRoot: deps.stateRoot,
      executor: deps.executor,
      parentRunId: ctx.runId,
      project: ctx.project,
      registry: deps.registry,
      maxConcurrentTasks: limits.maxConcurrentTasks,
      now,
      ...(generateId !== undefined ? { generateId } : {})
    });

    const taskPromises = ready.map(async (taskId) => {
      const node = graph.byId.get(taskId);
      if (node === undefined) return;
      const childRunId = createRunId(generateId);
      leases.lease(taskId, childRunId, LEASE_MS);
      await append(
        make(
          "TASK_LEASED",
          { taskId, childRunId, expiresAt: new Date(Date.parse(now()) + LEASE_MS).toISOString() as IsoTimestamp },
          taskId
        )
      );
      await recordStatus(taskId, "RUNNING", attempts.get(taskId) ?? 0);

      const outcome = await childCoordinator.startChildTask(
        {
          taskId,
          role: node.role,
          objective: node.objective,
          profile: deps.registry.resolve(node.role),
          inputArtifactIds: [],
          acceptanceCriteria: node.acceptanceCriteria,
          limits: { maxAttempts: node.maxAttempts, timeoutMs: node.timeoutMs, maxWallTimeMs: limits.maxWallTimeMs }
        },
        controller.signal,
        { childRunId }
      ).done;

      leases.release(taskId);

      if (controller.signal.aborted) {
        await recordCancel();
        return;
      }

      const terminal = outcome.terminalResult;
      const verification = terminal?.verification ?? { kind: "UNOBSERVED" as const, evidenceIds: [] };
      const evidenceIds = terminal?.evidenceIds ?? [];
      const decision: JudgeDecision = judge.decide({
        taskId,
        task: node,
        verification,
        evidenceIds
      });
      await append(
        make(
          "JUDGE_DECISION",
          {
            taskId,
            verdict: decision.verdict,
            evidenceIds: decision.evidenceIds,
            ...(decision.reason !== undefined ? { reason: decision.reason } : {})
          },
          taskId
        )
      );

      const attempt = (attempts.get(taskId) ?? 0) + 1;
      switch (decision.verdict) {
        case "APPROVED":
          await recordStatus(taskId, "COMPLETED", attempt);
          roundEvent.completedTasks.push(taskId);
          roundEvent.newEvidenceIds.push(...evidenceIds);
          break;
        case "REJECTED": {
          const transition = applyTaskOutcome({ ...node, attempt: attempt - 1 }, toTaskOutcome(outcome.outcome));
          await recordStatus(taskId, transition.status, transition.attempt);
          if (transition.status === "BLOCKED") {
            await recordRetry(node, transition.attempt);
          }
          break;
        }
        case "NEEDS_USER_DECISION":
          await recordStatus(taskId, "BLOCKED", attempt);
          roundEvent.userDecision = true;
          break;
      }
    });

    // Settle the whole round before letting a rejection out. A task that throws
    // must not leave its round-mates appending events after the crash terminal,
    // and the run must not return while a child it launched is still spending.
    // The abort controller is deliberately not tripped here: the per-task abort
    // check records RUN_CANCEL_REQUESTED, which would bury the crash as a
    // cancellation nobody requested.
    const settled = await Promise.allSettled(taskPromises);
    const failure = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failure !== undefined) throw failure.reason;
    if (cancelRecorded) break;

    const progress = classifyRoundProgress(roundEvent, ledger);
    const advanced = advanceLedgerRound(ledger, progress, limits.maxConsecutiveStalls, {
      event: roundEvent,
      timestamp: now()
    });
    Object.assign(ledger, advanced);
    await append(
      make(
        "LEDGER_UPDATED",
        {
          revision: ledger.revision,
          round: ledger.round,
          consecutiveStalls: ledger.consecutiveStalls,
          isBlocked: ledger.isBlocked
        },
        ready[0]
      )
    );
    if (ledger.isBlocked) {
      finalStatus = "BLOCKED";
      const requiredEvidence = ledger.requiredEvidence.map((entry) => entry.description);
      await append(make("STALL_DETECTED", { round, consecutiveStalls: ledger.consecutiveStalls, requiredEvidence }));
      await append(make("RUN_BLOCKED", { reason: "no progress for too many rounds", requiredEvidence }));
      break;
    }
  }

  if (finalStatus === "RUNNING") {
    // Rounds exhausted without a terminal decision.
    finalStatus = "FAILED";
    finalReason = `maxRounds (${limits.maxRounds}) exhausted without completion`;
    await append(make("RUN_FAILED", { reason: finalReason }));
  }

  return { status: finalStatus, ...(finalReason !== undefined ? { reason: finalReason } : {}) };
}

/** Applies a tracking gate after a settle only when an assessment is supplied. */
export async function settleSupervisedOutcome(opts: {
  events: readonly Event[];
  append: (event: Event) => Promise<void>;
  nowIso: string;
  generateEventId: () => EventId;
  trackingAssessment?: TrackingAssessment;
  policyVersion?: string;
  expectedSeq?: number;
}): Promise<void> {
  const assessment = opts.trackingAssessment;
  if (assessment === undefined) return;
  const applied = applyTrackingGate({
    events: opts.events,
    assessment,
    assessmentHash: hashAssessment(assessment),
    expectedSeq: opts.expectedSeq ?? nextTrackingSeq(opts.events),
    policyVersion: opts.policyVersion ?? "track-v1",
    nowIso: opts.nowIso,
    generateEventId: opts.generateEventId
  });
  for (const event of applied.events.slice(opts.events.length)) {
    await opts.append(event);
  }
}

/** M2: starts a supervisor run over a validated task graph. */
export function startSupervisedRun(deps: SupervisorDeps, input: SupervisedRunInput): SupervisedRunHandle {
  if (input.contract !== undefined) {
    assertCoverageAllowsStart(
      input.contract,
      input.tasks.map((task) => ({
        id: task.id,
        acceptanceCriteria: task.acceptanceCriteria
      })),
      input.resolvedQuestionIds !== undefined
        ? { resolvedQuestionIds: input.resolvedQuestionIds }
        : undefined
    );
  }
  const controller = new AbortController();
  const now = deps.now ?? nowIso;
  const generateId = deps.generateId;
  const judge = deps.judge ?? new DeterministicJudge();
  const runId = createRunId(generateId);

  const done = (async (): Promise<SupervisedRunOutcome> => {
    const project = await discoverProject(input.projectRoot, {
      now,
      ...(generateId !== undefined ? { generateId } : {})
    });
    const eventStore = new EventStore(deps.stateRoot, runId);
    const checkpointStore = new CheckpointStore(deps.stateRoot, runId);
    const rootTaskId = createTaskId(generateId);

    const graph = validateTaskGraph(input.tasks);
    const run: Run = {
      id: runId,
      projectId: project.id,
      rootTaskId,
      status: "PLANNING",
      limits: input.limits ?? defaultRunLimits(),
      createdAt: now(),
      updatedAt: now()
    };

    const make = (type: Event["type"], payload: unknown, taskId?: TaskId): Event =>
      ({
        id: createEventId(generateId),
        schemaVersion: 1,
        occurredAt: now(),
        runId,
        ...(taskId !== undefined ? { taskId } : {}),
        type,
        actor: "supervisor",
        payload
      }) as Event;

    const append = (event: Event) => eventStore.append(event);

    await append(make("PROJECT_DISCOVERED", { project }));
    await append(make("RUN_CREATED", { run }));
    await bindEpisodeToRun({
      stateRoot: deps.stateRoot,
      runId,
      projectId: project.id,
      objective: input.objective,
      ...(input.contract !== undefined ? { contract: input.contract, skipContract: false } : {}),
      append,
      make: (type, payload) => make(type, payload),
      ...(generateId !== undefined ? { generateId } : {})
    });
    await append(make("RUN_STARTED", {}));
    await append(make("TASK_GRAPH_ACCEPTED", { tasks: graph.tasks }));

    const state: SupervisorState = {
      graph,
      statuses: new Map(graph.tasks.map((t) => [t.id, t.status])),
      attempts: new Map(graph.tasks.map((t) => [t.id, t.attempt])),
      leases: new LeaseRegistry(() => Date.parse(now())),
      ledger: createLedger(input.objective, input.limits?.maxConsecutiveStalls ?? 3)
    };

    const ctx: SupervisorContext = {
      deps,
      runId,
      project,
      run,
      limits: run.limits,
      now,
      generateId,
      judge,
      eventStore,
      checkpointStore,
      controller,
      append,
      make
    };

    const result = await runSupervisorRounds(ctx, state, run.rootTaskId);
    const status = result.status;

    const beforeSettle = await eventStore.readAll();
    await settleBoundEpisode({
      stateRoot: deps.stateRoot,
      events: beforeSettle.events,
      status,
      append,
      make: (type, payload) => make(type, payload)
    });
    await settleSupervisedOutcome({
      events: beforeSettle.events,
      append,
      nowIso: now(),
      generateEventId: () => createEventId(generateId)
    });
    const finalRead = await eventStore.readAll();
    const finalReplayed = replayRun(finalRead.events);
    const checkpoint = validateCheckpoint(materializeCheckpoint(finalReplayed, now()));
    await checkpointStore.write(checkpoint);
    return { runId, status, events: finalRead.events, checkpoint, project: project };
  })();

  return {
    runId,
    done,
    cancel: () => controller.abort()
  };
}

/** Resume a supervised run from persisted events. */
export function resumeSupervisedRun(deps: SupervisorDeps, runId: RunId): SupervisedRunHandle {
  const controller = new AbortController();
  const now = deps.now ?? nowIso;
  const generateId = deps.generateId;
  const judge = deps.judge ?? new DeterministicJudge();

  const done = (async (): Promise<SupervisedRunOutcome> => {
    const eventStore = new EventStore(deps.stateRoot, runId);
    const checkpointStore = new CheckpointStore(deps.stateRoot, runId);

    const read = await eventStore.readAll();
    if (read.events.length === 0) {
      throw new Error(`Run ${runId} not found`);
    }

    const existingCheckpoint = await checkpointStore.read();
    if (checkpointCarriesFlowchart(existingCheckpoint)) {
      throw new Error(
        `Run ${runId} has a flowchart snapshot; refuse M2 DAG resume that would strip it. Use flowchart resume.`
      );
    }

    const replayed = replayRun(read.events);
    if (!replayed.run) {
      throw new Error(`Run ${runId} has no RUN_CREATED event`);
    }

    const state = reconstructSupervisorState(read.events, () => Date.parse(now()));
    if (!state) {
      throw new Error(`Run ${runId} has no TASK_GRAPH_ACCEPTED event`);
    }

    // If already terminal, return immediately without appending events.
    if (replayed.status === "COMPLETED" || replayed.status === "FAILED" || replayed.status === "CANCELLED" || replayed.status === "BLOCKED") {
      const checkpoint = validateCheckpoint(materializeCheckpoint(replayed, now()));
      await checkpointStore.write(checkpoint);
      return {
        runId,
        status: replayed.status,
        events: read.events,
        checkpoint,
        project: replayed.project!
      };
    }

    const run = replayed.run;
    const limits = run.limits;

    const make = (type: Event["type"], payload: unknown, taskId?: TaskId): Event =>
      ({
        id: createEventId(generateId),
        schemaVersion: 1,
        occurredAt: now(),
        runId,
        ...(taskId !== undefined ? { taskId } : {}),
        type,
        actor: "supervisor",
        payload
      }) as Event;

    const append = (event: Event) => eventStore.append(event);

    const ctx: SupervisorContext = {
      deps,
      runId,
      project: replayed.project!,
      run,
      limits,
      now,
      generateId,
      judge,
      eventStore,
      checkpointStore,
      controller,
      append,
      make
    };

    const result = await runSupervisorRounds(ctx, state, run.rootTaskId);
    const status = result.status;

    const beforeSettle = await eventStore.readAll();
    await settleBoundEpisode({
      stateRoot: deps.stateRoot,
      events: beforeSettle.events,
      status,
      append,
      make: (type, payload) => make(type, payload)
    });
    await settleSupervisedOutcome({
      events: beforeSettle.events,
      append,
      nowIso: now(),
      generateEventId: () => createEventId(generateId)
    });
    const finalRead = await eventStore.readAll();
    const finalReplayed = replayRun(finalRead.events);
    const checkpoint = validateCheckpoint(materializeCheckpoint(finalReplayed, now()));
    await checkpointStore.write(checkpoint);
    return { runId, status, events: finalRead.events, checkpoint, project: replayed.project! };
  })();

  return {
    runId,
    done,
    cancel: () => controller.abort()
  };
}