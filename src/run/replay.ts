import { DomainValidationError } from "../domain/errors.js";
import {
  isAgentInstanceId,
  isEventId,
  isTaskId,
  type AgentInstanceId,
  type EventId,
  type TaskId
} from "../domain/ids.js";
import { validateFlowchart, type Flowchart } from "../domain/flowchart.js";
import { validateProjectSnapshot, type ProjectSnapshot } from "../domain/project.js";
import { isRecord } from "../domain/record.js";
import { validateRun, type Run } from "../domain/run.js";
import { isRunStatus, type RunStatus } from "../domain/status.js";
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
   * The `RUN_BLOCKED` a `RUN_UNBLOCKED` would have to name to clear this log,
   * or `undefined` when the log is not currently blocked. Present so the
   * unblock producer targets the *active* block rather than re-deriving which
   * one that is.
   */
  activeBlockedEventId?: EventId;
  /**
   * The `RUN_UNBLOCKED` that currently holds the latch open, when one does.
   * Restore uses it to tell an already-applied unblock from one the checkpoint
   * has not seen yet.
   */
  clearingUnblockEventId?: EventId;
}

export interface FlowchartCheckpointState {
  definition: Flowchart;
  snapshot: FlowchartSupervisorSnapshot;
  limits: FlowchartRunLimits;
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
      case "RUN_UNBLOCKED": {
        // Only an unblock that names the block currently in force clears the
        // latch. Everything else is a fact the log keeps and an anomaly it
        // reports: the terminal stays exactly where it was, so every writer
        // that consults `replayedTerminalStatus` keeps refusing.
        if (activeTerminalType === undefined) {
          anomalies.push("RUN_UNBLOCKED without an active RUN_BLOCKED");
          break;
        }
        if (activeTerminalType !== "RUN_BLOCKED") {
          anomalies.push("RUN_UNBLOCKED after a terminal event");
          break;
        }
        if (event.payload.blockedEventId !== activeBlockedEventId) {
          anomalies.push("RUN_UNBLOCKED does not match the active RUN_BLOCKED");
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
 * `RUN_UNBLOCKED` is not in this set and is not a status: it ends the active
 * BLOCKED interval, after which the log has no terminal at all and the next
 * COMPLETED, FAILED or BLOCKED is the new one. That is the whole integration
 * seam — every writer that asks {@link replayedTerminalStatus} whether the log
 * already ended opens again with no per-writer exception.
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
  return { definition, snapshot, limits };
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
