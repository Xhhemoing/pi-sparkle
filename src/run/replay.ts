import { DomainValidationError } from "../domain/errors.js";
import {
  isAgentInstanceId,
  isEventId,
  isTaskId,
  type AgentInstanceId,
  type EventId,
  type TaskId
} from "../domain/ids.js";
import { validateProjectSnapshot, type ProjectSnapshot } from "../domain/project.js";
import { isRecord } from "../domain/record.js";
import { validateRun, type Run } from "../domain/run.js";
import { isRunStatus, type RunStatus } from "../domain/status.js";
import { isIsoTimestamp, type IsoTimestamp } from "../domain/timestamp.js";
import type { Event } from "./events.js";

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
}

export interface RunCheckpoint {
  schemaVersion: 1;
  run?: Run;
  project?: ProjectSnapshot;
  status: RunStatus;
  agentOutcomes: AgentOutcomeRecord[];
  lastEventId?: EventId;
  updatedAt: IsoTimestamp;
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
  let sawCancel = false;
  let sawWaiting = false;

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
        status = event.type === "RUN_COMPLETED" ? "COMPLETED" : "FAILED";
        break;
      }
      case "RUN_BLOCKED": {
        if (sawTerminal) anomalies.push("RUN_BLOCKED after a terminal event");
        sawTerminal = true;
        status = "BLOCKED";
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
        break;
    }
    lastEventId = event.id;
  }

  if (!sawTerminal) {
    if (sawCancel) status = "CANCELLED";
    else if (sawWaiting) status = "WAITING_FOR_USER";
    else if (sawStarted) status = "RUNNING";
  }

  return {
    ...(run !== undefined ? { run } : {}),
    ...(project !== undefined ? { project } : {}),
    status,
    agentOutcomes,
    ...(lastEventId !== undefined ? { lastEventId } : {}),
    anomalies
  };
}

export function materializeCheckpoint(state: ReconstructedRun, updatedAt: IsoTimestamp): RunCheckpoint {
  return {
    schemaVersion: 1,
    ...(state.run !== undefined ? { run: state.run } : {}),
    ...(state.project !== undefined ? { project: state.project } : {}),
    status: state.status,
    agentOutcomes: state.agentOutcomes,
    ...(state.lastEventId !== undefined ? { lastEventId: state.lastEventId } : {}),
    updatedAt
  };
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
  return value as unknown as RunCheckpoint;
}
