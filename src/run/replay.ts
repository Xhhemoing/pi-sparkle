import { DomainValidationError } from "../domain/errors.js";
import {
  isAgentInstanceId,
  isEventId,
  isTaskId,
  type AgentInstanceId,
  type EventId,
  type TaskId
} from "../domain/ids.js";
import { validateRequirementContract, type RequirementContract } from "../domain/contract.js";
import { validateFlowchart, type Flowchart } from "../domain/flowchart.js";
import { validateProjectSnapshot, type ProjectSnapshot } from "../domain/project.js";
import { isRecord } from "../domain/record.js";
import { validateRun, type Run } from "../domain/run.js";
import { isRunStatus, type RunStatus } from "../domain/status.js";
import type { AcceptanceCriterion } from "../domain/task.js";
import { isIsoTimestamp, type IsoTimestamp } from "../domain/timestamp.js";
import type { Event } from "./events.js";
import {
  snapshotValidationRouter,
  validateFlowchartRunLimits,
  validateFlowchartSupervisorSnapshot
} from "../supervisor/flowchart-snapshot.js";
import {
  restoreFlowchartSupervisor,
  type FlowchartRunLimits,
  type FlowchartSupervisorSnapshot
} from "../supervisor/flowchart-supervisor.js";

export const AGENT_OUTCOMES = ["SUCCESS", "FAILURE", "CANCELLED"] as const;
export type AgentOutcome = (typeof AGENT_OUTCOMES)[number];

export interface AgentOutcomeRecord {
  agentInstanceId: AgentInstanceId;
  outcome: AgentOutcome;
  taskId?: TaskId;
}

export interface ReconstructedRun {
  run?: Run;
  project?: ProjectSnapshot;
  status: RunStatus;
  agentOutcomes: AgentOutcomeRecord[];
  lastEventId?: EventId;
  anomalies: string[];
  /**
   * The `RUN_BLOCKED` a clearing event would have to name to clear this log,
   * or `undefined` when the log is not currently blocked. Present so the
   * unblock producer targets the *active* block rather than re-deriving which
   * one that is.
   */
  activeBlockedEventId?: EventId;
  /**
   * The clearing event that currently holds the latch open, when one does —
   * either an ordinary `RUN_UNBLOCKED` or a `RUN_UNBLOCKED_WITH_DISCARD`.
   * Restore uses it to tell an already-applied unblock from one the checkpoint
   * has not seen yet, and reads the event itself to learn which transform the
   * authorization asked for.
   */
  clearingUnblockEventId?: EventId;
}

export interface FlowchartCheckpointState {
  definition: Flowchart;
  snapshot: FlowchartSupervisorSnapshot;
  limits: FlowchartRunLimits;
  /**
   * The requirement contract the run started under, so a resume that has only
   * a run id can assess its children against the same constraints the start
   * did. Optional at `schemaVersion: 1` by necessity — every checkpoint written
   * before this field existed, and every run started without a contract, is
   * still valid — but it is never *synthesized*: the bound episode keeps only
   * acceptance criteria, and presenting an empty constraint list as the run's
   * would turn missing evidence into `NOT_APPLICABLE`.
   *
   * The reservation this docstring used to hold for per-task acceptance
   * criteria is spent: they ride the same seam as {@link taskCriteria} below.
   */
  contract?: RequirementContract;
  /**
   * The acceptance criteria each task was actually dispatched with, so a
   * resume can tell "this task has no criteria" from "nobody recorded this
   * task's criteria".
   *
   * That distinction is the whole reason the field exists. `childTasksFromLog`
   * rebuilds a resumed child from the parent log and gives a node whose
   * `TASK_REQUEST` was never logged `acceptanceCriteria: []`; the node then
   * runs and appends a real `TASK_REQUEST` carrying that empty list, which the
   * last-request-wins rule makes authoritative for every later resume. Under
   * option (a) that laundering would permanently downgrade one node's gating
   * on the strength of a crash, with no way to notice afterwards. A durable
   * record of what was dispatched is the only form of the marker that survives
   * a second crash.
   *
   * That chain still plays out verbatim, but only for a node *neither* source
   * records. Once the record names a task, the rebuild in
   * `run/flowchart-run.ts` puts the recorded criteria back on the substituted
   * spec before the resumed node runs, so no downgrade completes; and an empty
   * logged list no record entry vouches for is detectable as exactly that —
   * unknown, not the caller's known-none — rather than indistinguishable after
   * the fact.
   *
   * Optional at `schemaVersion: 1`, and absence stays valid forever: every
   * checkpoint written before this field existed is still a good checkpoint,
   * and absence means "unknown", never "none". Like `contract` it is never
   * *synthesized* — not from the bound episode, not from the flowchart
   * definition (`FlowNode` carries no criteria), and not from the run
   * contract, whose criteria are the run's rather than any one task's.
   *
   * An entry with an empty `acceptanceCriteria` is meaningful and allowed: it
   * is the durable statement that this task was dispatched with none. The
   * array itself must be non-empty when present, and ordered by ascending
   * `taskId`, which settles uniqueness in the same comparison.
   *
   * `run/flowchart-run.ts` fills this: the caller's child specs when a run
   * accepts them, and any logged `TASK_REQUEST` that carries criteria,
   * first-write-wins and ordered by ascending `taskId`. A logged request with
   * no criteria is deliberately ignored — on the log it is indistinguishable
   * from a substituted one — so absence still means unknown, and only the
   * caller's own spec can say known-none. Declared and validated here so the
   * shape is fixed and a malformed value fails closed.
   */
  taskCriteria?: TaskAcceptanceCriteria[];
  /**
   * The USD ceiling each task was dispatched under, for the tasks whose caller
   * declared one.
   *
   * A declared per-child `maxCostUsd` is a dispatch fact of the same kind as
   * {@link taskCriteria}, and it reaches the log by the same route: only a
   * child that actually starts writes a `TASK_REQUEST`, so a run paused,
   * blocked or crashed before some child dispatches has nothing on its log
   * about what that child was allowed to spend. `childTasksFromLog` then
   * substitutes a budget for it — and a substituted budget is not a place a
   * spend authorization can come from, because both ways of getting one wrong
   * are durable: a sibling's ceiling copied onto this task stamps a cap the
   * caller never set into the child's `RUN_CREATED.limits`, and the caller's
   * own ceiling dropped leaves a child the operator believes is capped running
   * with none.
   *
   * The ceiling only, never the whole limits object. The other three fields
   * are the coordinator's own enforcement knobs, for which a substituted
   * budget is a reasonable answer; this one is money a caller authorized for
   * one named task.
   *
   * Optional at `schemaVersion: 1`, and absence stays valid forever: every
   * checkpoint written before this field existed is still a good checkpoint,
   * and absence means "unknown", never "uncapped". Like `taskCriteria` it is
   * never *synthesized* — not from a sibling, not from the run's own limits,
   * not from a default. The array must be non-empty when present and ordered
   * by ascending `taskId`, which settles uniqueness in the same comparison,
   * and each `maxCostUsd` must satisfy the same positive-finite rule
   * `protocol/v1.ts` applies to a declared ceiling, so a record can never
   * authorize a spend the protocol boundary would have refused.
   *
   * `run/flowchart-run.ts` fills this: the caller's child specs when a run
   * accepts them, and any logged `TASK_REQUEST` that carries a ceiling,
   * first-write-wins and ordered by ascending `taskId`. A logged request with
   * no ceiling is deliberately ignored — on the log, a caller who declared
   * none and a node the rebuild substituted for are indistinguishable — so
   * absence still means unknown.
   */
  taskCostCeilings?: TaskCostCeiling[];
}

/** One task's dispatched acceptance criteria, as {@link FlowchartCheckpointState} records them. */
export interface TaskAcceptanceCriteria {
  taskId: TaskId;
  acceptanceCriteria: AcceptanceCriterion[];
}

/** One task's dispatched spend ceiling, as {@link FlowchartCheckpointState} records it. */
export interface TaskCostCeiling {
  taskId: TaskId;
  maxCostUsd: number;
}

export interface RunCheckpoint {
  schemaVersion: 1;
  run?: Run;
  project?: ProjectSnapshot;
  status: RunStatus;
  agentOutcomes: AgentOutcomeRecord[];
  lastEventId?: EventId;
  updatedAt: IsoTimestamp;
  /** Present only for flowchart runs. M0/M2 checkpoints omit this field. */
  flowchart?: FlowchartCheckpointState;
}

function isAgentOutcome(value: unknown): value is AgentOutcome {
  return typeof value === "string" && (AGENT_OUTCOMES as readonly string[]).includes(value);
}

function isAgentOutcomeRecord(value: unknown): value is AgentOutcomeRecord {
  if (!isRecord(value)) return false;
  if (!isAgentInstanceId(value.agentInstanceId)) return false;
  if (!isAgentOutcome(value.outcome)) return false;
  if (value.taskId !== undefined && !isTaskId(value.taskId)) return false;
  return true;
}

export function replayRun(events: readonly Event[]): ReconstructedRun {
  let run: Run | undefined;
  let project: ProjectSnapshot | undefined;
  let status: RunStatus = "PLANNING";
  const agentOutcomes: AgentOutcomeRecord[] = [];
  let lastEventId: EventId | undefined;
  const anomalies: string[] = [];
  let sawCreated = false;
  let sawStarted = false;
  let sawTerminal = false;
  // Which terminal is active, and — for BLOCKED — which event opened it. An
  // unblock must name that exact event, so the pair travels together.
  let activeTerminalType: "RUN_COMPLETED" | "RUN_FAILED" | "RUN_BLOCKED" | undefined;
  let activeBlockedEventId: EventId | undefined;
  let clearingUnblockEventId: EventId | undefined;
  let sawCancel = false;
  let sawWaiting = false;
  let unmatchedPause = false;

  for (const event of events) {
    switch (event.type) {
      case "RUN_CREATED": {
        if (sawCreated) anomalies.push("multiple RUN_CREATED events");
        sawCreated = true;
        run = event.payload.run;
        break;
      }
      case "PROJECT_DISCOVERED":
        project = event.payload.project;
        break;
      case "RUN_STARTED": {
        if (!sawCreated) anomalies.push("RUN_STARTED before RUN_CREATED");
        sawStarted = true;
        break;
      }
      case "AGENT_STARTED":
      case "AGENT_EVENT":
        break;
      case "AGENT_FINISHED": {
        agentOutcomes.push({
          agentInstanceId: event.payload.agentInstanceId,
          outcome: event.payload.outcome,
          ...(event.taskId !== undefined ? { taskId: event.taskId } : {})
        });
        break;
      }
      case "RUN_COMPLETED":
      case "RUN_FAILED": {
        if (sawTerminal) anomalies.push("multiple terminal events");
        sawTerminal = true;
        activeTerminalType = event.type;
        activeBlockedEventId = undefined;
        clearingUnblockEventId = undefined;
        status = event.type === "RUN_COMPLETED" ? "COMPLETED" : "FAILED";
        break;
      }
      case "RUN_BLOCKED": {
        if (sawTerminal) anomalies.push("RUN_BLOCKED after a terminal event");
        sawTerminal = true;
        activeTerminalType = "RUN_BLOCKED";
        activeBlockedEventId = event.id;
        clearingUnblockEventId = undefined;
        status = "BLOCKED";
        break;
      }
      case "RUN_UNBLOCKED":
      case "RUN_UNBLOCKED_WITH_DISCARD": {
        // Only an unblock that names the block currently in force clears the
        // latch. Everything else is a fact the log keeps and an anomaly it
        // reports: the terminal stays exactly where it was, so every writer
        // that consults `replayedTerminalStatus` keeps refusing.
        //
        // Both clearing events answer to exactly these rules. The stronger one
        // authorizes a wider *transform*, not a wider replay: if matching were
        // laxer for it, an operator could clear a block the ordinary event
        // could not by asking for more, which is the opposite of what the
        // stronger authorization means. The anomaly names the event that
        // caused it so a log reader can tell the two apart.
        if (activeTerminalType === undefined) {
          anomalies.push(`${event.type} without an active RUN_BLOCKED`);
          break;
        }
        if (activeTerminalType !== "RUN_BLOCKED") {
          anomalies.push(`${event.type} after a terminal event`);
          break;
        }
        if (event.payload.blockedEventId !== activeBlockedEventId) {
          anomalies.push(`${event.type} does not match the active RUN_BLOCKED`);
          break;
        }
        sawTerminal = false;
        activeTerminalType = undefined;
        activeBlockedEventId = undefined;
        clearingUnblockEventId = event.id;
        // Back to the pre-terminal ladder below: started, waiting, paused and
        // cancelled are all decided there, so the unblocked status is whatever
        // the rest of the log says rather than a second opinion held here.
        status = "PLANNING";
        break;
      }
      case "RUN_CANCEL_REQUESTED": {
        if (sawTerminal) anomalies.push("RUN_CANCEL_REQUESTED after a terminal event");
        sawCancel = true;
        break;
      }
      case "RUN_WAITING_FOR_USER": {
        if (sawTerminal) anomalies.push("RUN_WAITING_FOR_USER after a terminal event");
        sawWaiting = true;
        break;
      }
      case "USER_ANSWER": {
        sawWaiting = false;
        break;
      }
      case "PAUSE_REQUESTED": {
        if (sawTerminal) anomalies.push("PAUSE_REQUESTED after a terminal event");
        unmatchedPause = true;
        break;
      }
      case "PAUSE_CLEARED": {
        if (sawTerminal) anomalies.push("PAUSE_CLEARED after a terminal event");
        unmatchedPause = false;
        break;
      }
      case "INJECTION_REQUESTED":
      case "STEER_INJECTED":
      case "CHILD_RUN_CREATED":
      case "CHILD_MESSAGE":
      case "TASK_TIMEOUT":
      case "TASK_RETRY":
      case "TASK_GRAPH_ACCEPTED":
      case "TASK_LEASED":
      case "TASK_LEASE_EXPIRED":
      case "TASK_STATUS_CHANGED":
      case "LEDGER_UPDATED":
      case "STALL_DETECTED":
      case "JUDGE_DECISION":
      case "MODEL_ROUTED":
      case "EPISODE_OPENED":
      case "RUN_ATTACHED":
      case "EPISODE_WAITING":
      case "EPISODE_CLOSED":
      case "TRACKING_ASSESSMENT":
      case "GATE_TRANSITION":
        break;
    }
    lastEventId = event.id;
  }

  if (!sawTerminal) {
    if (sawCancel) status = "CANCELLED";
    else if (unmatchedPause) status = "PAUSED";
    else if (sawWaiting) status = "WAITING_FOR_USER";
    else if (sawStarted) status = "RUNNING";
  }

  return {
    ...(run !== undefined ? { run } : {}),
    ...(project !== undefined ? { project } : {}),
    status,
    agentOutcomes,
    ...(lastEventId !== undefined ? { lastEventId } : {}),
    anomalies,
    ...(activeBlockedEventId !== undefined ? { activeBlockedEventId } : {}),
    ...(clearingUnblockEventId !== undefined ? { clearingUnblockEventId } : {})
  };
}

/**
 * The statuses a replayed log treats as terminal: exactly the ones
 * {@link replayRun} sets `sawTerminal` for, so a second terminal event after any
 * of them is an anomaly. `RUN_BLOCKED` is one of them — the tracking gate's
 * `queue_analysis` means "terminal BLOCKED until an explicit unblock", not "keep
 * going" — which is why it belongs here next to COMPLETED and FAILED.
 *
 * Neither clearing event — `RUN_UNBLOCKED` nor `RUN_UNBLOCKED_WITH_DISCARD` —
 * is in this set, and neither is a status: they end the active BLOCKED
 * interval, after which the log has no terminal at all and the next COMPLETED,
 * FAILED or BLOCKED is the new one. That is the whole integration seam — every
 * writer that asks {@link replayedTerminalStatus} whether the log already ended
 * opens again with no per-writer exception.
 */
export const TERMINAL_REPLAY_STATUSES: ReadonlySet<RunStatus> = new Set([
  "COMPLETED",
  "FAILED",
  "BLOCKED"
]);

/**
 * The terminal a log already replays, or `undefined` when it has none.
 *
 * One definition serves two callers: the anomaly rule above, and a writer
 * deciding whether appending its own terminal would make the log say two things
 * at once. They must not drift, so neither re-derives "terminal" locally.
 */
export function replayedTerminalStatus(events: readonly Event[]): RunStatus | undefined {
  const status = replayRun(events).status;
  return TERMINAL_REPLAY_STATUSES.has(status) ? status : undefined;
}

export function hasUnmatchedPause(events: readonly Event[]): boolean {
  let unmatched = false;
  for (const event of events) {
    if (event.type === "PAUSE_REQUESTED") unmatched = true;
    else if (event.type === "PAUSE_CLEARED") unmatched = false;
  }
  return unmatched;
}

/** True when a checkpoint already carries a flowchart snapshot that must not be stripped. */
export function checkpointCarriesFlowchart(value: unknown): boolean {
  return isRecord(value) && value.flowchart !== undefined;
}

/** True when the event log is a flowchart run that must not fall back to linear resume. */
export function eventsLookLikeFlowchartRun(events: readonly Event[]): boolean {
  return events.some((event) => event.type === "MODEL_ROUTED" || event.actor === "flowchart-supervisor");
}

export function materializeCheckpoint(
  state: ReconstructedRun,
  updatedAt: IsoTimestamp,
  flowchart?: FlowchartCheckpointState
): RunCheckpoint {
  return {
    schemaVersion: 1,
    ...(state.run !== undefined ? { run: state.run } : {}),
    ...(state.project !== undefined ? { project: state.project } : {}),
    status: state.status,
    agentOutcomes: state.agentOutcomes,
    ...(state.lastEventId !== undefined ? { lastEventId: state.lastEventId } : {}),
    updatedAt,
    ...(flowchart !== undefined ? { flowchart } : {})
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Validates a flowchart checkpoint payload by schema and by restore.
 * Malformed snapshots fail closed; JSON.parse-only is not sufficient.
 */
export function validateFlowchartCheckpointState(value: unknown): FlowchartCheckpointState {
  if (!isRecord(value)) {
    throw new DomainValidationError("Invalid RunCheckpoint: flowchart must be an object");
  }
  let definition: Flowchart;
  try {
    definition = validateFlowchart(value.definition);
  } catch (error) {
    throw new DomainValidationError(`Invalid RunCheckpoint: flowchart.definition: ${messageOf(error)}`);
  }
  let snapshot: FlowchartSupervisorSnapshot;
  try {
    snapshot = validateFlowchartSupervisorSnapshot(value.snapshot);
  } catch (error) {
    throw new DomainValidationError(`Invalid RunCheckpoint: flowchart.snapshot: ${messageOf(error)}`);
  }
  let limits: FlowchartRunLimits;
  try {
    limits = validateFlowchartRunLimits(value.limits);
  } catch (error) {
    throw new DomainValidationError(`Invalid RunCheckpoint: flowchart.limits: ${messageOf(error)}`);
  }
  try {
    restoreFlowchartSupervisor(
      {
        flowchart: definition,
        router: snapshotValidationRouter(),
        limits
      },
      snapshot
    );
  } catch (error) {
    throw new DomainValidationError(
      `Invalid RunCheckpoint: flowchart snapshot is not restorable: ${messageOf(error)}`
    );
  }
  const taskCriteria = validateTaskCriteria(value.taskCriteria);
  const taskCostCeilings = validateTaskCostCeilings(value.taskCostCeilings);
  // Spread rather than enumerate: each optional record is present or absent on
  // its own, and an absent one must stay an absent *key* — `"taskCriteria" in
  // state` is how a reader tells unknown from recorded.
  const recorded = {
    ...(taskCriteria !== undefined ? { taskCriteria } : {}),
    ...(taskCostCeilings !== undefined ? { taskCostCeilings } : {})
  };
  if (value.contract === undefined) {
    return { definition, snapshot, limits, ...recorded };
  }
  let contract: RequirementContract;
  try {
    contract = validateRequirementContract(value.contract);
  } catch (error) {
    throw new DomainValidationError(`Invalid RunCheckpoint: flowchart.contract: ${messageOf(error)}`);
  }
  return { definition, snapshot, limits, contract, ...recorded };
}

/**
 * Validates the optional per-task criteria record, fail-closed.
 *
 * Absence is valid and means "unknown". An empty array is not: a checkpoint
 * that carries the field says something about at least one task, and two
 * spellings of "nothing" is how a durable channel rots. Entries are ordered by
 * ascending `taskId`, which makes duplicates a violation of the same rule.
 */
function validateTaskCriteria(value: unknown): TaskAcceptanceCriteria[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw new DomainValidationError(
      "Invalid RunCheckpoint: flowchart.taskCriteria must be a non-empty array when present"
    );
  }
  const entries: TaskAcceptanceCriteria[] = [];
  let previousTaskId: string | undefined;
  for (const [index, entry] of value.entries()) {
    const label = `Invalid RunCheckpoint: flowchart.taskCriteria[${index}]`;
    if (!isRecord(entry)) throw new DomainValidationError(`${label} must be an object`);
    if (!isTaskId(entry.taskId)) throw new DomainValidationError(`${label}.taskId must be a valid TaskId`);
    if (previousTaskId !== undefined && entry.taskId <= previousTaskId) {
      throw new DomainValidationError(`${label}.taskId must sort strictly after ${previousTaskId}`);
    }
    previousTaskId = entry.taskId;
    if (!Array.isArray(entry.acceptanceCriteria)) {
      throw new DomainValidationError(`${label}.acceptanceCriteria must be an array`);
    }
    const criteria: AcceptanceCriterion[] = [];
    const seen = new Set<string>();
    for (const [position, criterion] of entry.acceptanceCriteria.entries()) {
      if (
        !isRecord(criterion) ||
        typeof criterion.id !== "string" ||
        criterion.id.trim() === "" ||
        typeof criterion.description !== "string" ||
        criterion.description.trim() === ""
      ) {
        throw new DomainValidationError(
          `${label}.acceptanceCriteria[${position}] must be {id, description} with non-empty strings`
        );
      }
      if (seen.has(criterion.id)) {
        throw new DomainValidationError(
          `${label}.acceptanceCriteria[${position}] repeats criterion id ${criterion.id}`
        );
      }
      seen.add(criterion.id);
      criteria.push({ id: criterion.id, description: criterion.description });
    }
    entries.push({ taskId: entry.taskId, acceptanceCriteria: criteria });
  }
  return entries;
}

/**
 * Validates the optional per-task ceiling record, fail-closed.
 *
 * Same three rules as {@link validateTaskCriteria}, for the same reasons:
 * absence is the one spelling of "unknown", so an empty array is refused;
 * entries ascend by `taskId`, which settles duplicates in the same
 * comparison. The fourth is this field's own — a recorded ceiling must be a
 * positive finite number, exactly what `protocol/v1.ts` demands of a declared
 * `maxCostUsd`, because this record is restored onto a spec that goes on to
 * authorize real spend. A checkpoint that could carry `0` or `-1` past the
 * parse-time refusal would be a way in for the value the boundary rejects.
 */
function validateTaskCostCeilings(value: unknown): TaskCostCeiling[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw new DomainValidationError(
      "Invalid RunCheckpoint: flowchart.taskCostCeilings must be a non-empty array when present"
    );
  }
  const entries: TaskCostCeiling[] = [];
  let previousTaskId: string | undefined;
  for (const [index, entry] of value.entries()) {
    const label = `Invalid RunCheckpoint: flowchart.taskCostCeilings[${index}]`;
    if (!isRecord(entry)) throw new DomainValidationError(`${label} must be an object`);
    if (!isTaskId(entry.taskId)) throw new DomainValidationError(`${label}.taskId must be a valid TaskId`);
    if (previousTaskId !== undefined && entry.taskId <= previousTaskId) {
      throw new DomainValidationError(`${label}.taskId must sort strictly after ${previousTaskId}`);
    }
    previousTaskId = entry.taskId;
    const maxCostUsd = entry.maxCostUsd;
    if (typeof maxCostUsd !== "number" || !Number.isFinite(maxCostUsd) || maxCostUsd <= 0) {
      throw new DomainValidationError(`${label}.maxCostUsd must be a positive finite number`);
    }
    entries.push({ taskId: entry.taskId, maxCostUsd });
  }
  return entries;
}

export function validateCheckpoint(value: unknown): RunCheckpoint {
  if (!isRecord(value)) {
    throw new DomainValidationError("Invalid RunCheckpoint: expected an object");
  }
  if (value.schemaVersion !== 1) throw new DomainValidationError("Invalid RunCheckpoint: schemaVersion must be 1");
  if (value.run !== undefined) {
    try {
      validateRun(value.run);
    } catch (error) {
      throw new DomainValidationError(
        `Invalid RunCheckpoint: run: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  if (value.project !== undefined) {
    try {
      validateProjectSnapshot(value.project);
    } catch (error) {
      throw new DomainValidationError(
        `Invalid RunCheckpoint: project: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  if (!isRunStatus(value.status)) throw new DomainValidationError("Invalid RunCheckpoint: status must be a known RunStatus");
  if (!Array.isArray(value.agentOutcomes) || !value.agentOutcomes.every(isAgentOutcomeRecord)) {
    throw new DomainValidationError("Invalid RunCheckpoint: agentOutcomes must be an array of outcome records");
  }
  if (value.lastEventId !== undefined && !isEventId(value.lastEventId)) {
    throw new DomainValidationError("Invalid RunCheckpoint: lastEventId must be a valid EventId");
  }
  if (!isIsoTimestamp(value.updatedAt)) {
    throw new DomainValidationError("Invalid RunCheckpoint: updatedAt must be a valid IsoTimestamp");
  }
  if (value.flowchart !== undefined) {
    validateFlowchartCheckpointState(value.flowchart);
  }
  return value as unknown as RunCheckpoint;
}
