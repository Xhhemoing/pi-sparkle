import { DomainValidationError } from "../domain/errors.js";
import {
  isAgentInstanceId,
  isEventId,
  isRunId,
  isTaskId,
  type AgentInstanceId,
  type EventId,
  type RunId,
  type TaskId
} from "../domain/ids.js";
import { validateProjectSnapshot } from "../domain/project.js";
import { isRecord } from "../domain/record.js";
import { validateRun } from "../domain/run.js";
import { isIsoTimestamp, type IsoTimestamp } from "../domain/timestamp.js";

export const EVENT_TYPES = [
  "PROJECT_DISCOVERED",
  "RUN_CREATED",
  "RUN_STARTED",
  "AGENT_STARTED",
  "AGENT_EVENT",
  "AGENT_FINISHED",
  "RUN_COMPLETED",
  "RUN_FAILED",
  "RUN_CANCEL_REQUESTED"
] as const;

export type M0EventType = (typeof EVENT_TYPES)[number];

export const AGENT_EVENT_KINDS = ["TEXT_DELTA", "TOOL_STARTED", "TOOL_FINISHED", "TURN_FINISHED"] as const;
export type AgentEventKind = (typeof AGENT_EVENT_KINDS)[number];

export const AGENT_OUTCOMES = ["SUCCESS", "FAILURE", "CANCELLED"] as const;
export type AgentOutcome = (typeof AGENT_OUTCOMES)[number];

export type EmptyPayload = Record<string, never>;

export interface ProjectDiscoveredPayload {
  project: import("../domain/project.js").ProjectSnapshot;
}

export interface RunCreatedPayload {
  run: import("../domain/run.js").Run;
}

export interface AgentStartedPayload {
  agentInstanceId: AgentInstanceId;
  taskId: TaskId;
}

export interface AgentEventPayload {
  agentInstanceId: AgentInstanceId;
  kind: AgentEventKind;
  summary: string;
}

export interface AgentFinishedPayload {
  agentInstanceId: AgentInstanceId;
  outcome: AgentOutcome;
}

export interface RunFailedPayload {
  reason: string;
}

export interface EventBase {
  id: EventId;
  schemaVersion: 1;
  occurredAt: IsoTimestamp;
  runId: RunId;
  taskId?: TaskId;
  type: M0EventType;
  actor: string;
}

export type Event =
  | (EventBase & { type: "PROJECT_DISCOVERED"; payload: ProjectDiscoveredPayload })
  | (EventBase & { type: "RUN_CREATED"; payload: RunCreatedPayload })
  | (EventBase & { type: "RUN_STARTED"; payload: EmptyPayload })
  | (EventBase & { type: "AGENT_STARTED"; payload: AgentStartedPayload })
  | (EventBase & { type: "AGENT_EVENT"; payload: AgentEventPayload })
  | (EventBase & { type: "AGENT_FINISHED"; payload: AgentFinishedPayload })
  | (EventBase & { type: "RUN_COMPLETED"; payload: EmptyPayload })
  | (EventBase & { type: "RUN_FAILED"; payload: RunFailedPayload })
  | (EventBase & { type: "RUN_CANCEL_REQUESTED"; payload: EmptyPayload });

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isEmptyPayload(payload: Record<string, unknown>): boolean {
  return Object.keys(payload).length === 0;
}

function payloadError(type: M0EventType, payload: unknown): string | undefined {
  if (!isRecord(payload)) return "payload must be an object";
  switch (type) {
    case "PROJECT_DISCOVERED": {
      if (payload.project === undefined) return "payload.project is required";
      try {
        validateProjectSnapshot(payload.project);
      } catch (error) {
        return `payload.project: ${messageOf(error)}`;
      }
      return undefined;
    }
    case "RUN_CREATED": {
      if (payload.run === undefined) return "payload.run is required";
      try {
        validateRun(payload.run);
      } catch (error) {
        return `payload.run: ${messageOf(error)}`;
      }
      return undefined;
    }
    case "RUN_STARTED":
    case "RUN_COMPLETED":
    case "RUN_CANCEL_REQUESTED":
      return isEmptyPayload(payload) ? undefined : "payload must be an empty object";
    case "AGENT_STARTED": {
      if (!isAgentInstanceId(payload.agentInstanceId)) return "payload.agentInstanceId must be a valid AgentInstanceId";
      if (!isTaskId(payload.taskId)) return "payload.taskId must be a valid TaskId";
      return undefined;
    }
    case "AGENT_EVENT": {
      if (!isAgentInstanceId(payload.agentInstanceId)) return "payload.agentInstanceId must be a valid AgentInstanceId";
      if (!(AGENT_EVENT_KINDS as readonly string[]).includes(String(payload.kind))) {
        return "payload.kind must be a known AgentEventKind";
      }
      if (typeof payload.summary !== "string" || payload.summary.trim() === "") {
        return "payload.summary must be a non-empty string";
      }
      return undefined;
    }
    case "AGENT_FINISHED": {
      if (!isAgentInstanceId(payload.agentInstanceId)) return "payload.agentInstanceId must be a valid AgentInstanceId";
      if (!(AGENT_OUTCOMES as readonly string[]).includes(String(payload.outcome))) {
        return "payload.outcome must be a known AgentOutcome";
      }
      return undefined;
    }
    case "RUN_FAILED": {
      if (typeof payload.reason !== "string" || payload.reason.trim() === "") {
        return "payload.reason must be a non-empty string";
      }
      return undefined;
    }
  }
}

export function validateEvent(value: unknown): Event {
  if (!isRecord(value)) {
    throw new DomainValidationError("Invalid Event: expected an object");
  }
  if (!isEventId(value.id)) throw new DomainValidationError("Invalid Event: id must be a valid EventId");
  if (value.schemaVersion !== 1) throw new DomainValidationError("Invalid Event: schemaVersion must be 1");
  if (!isIsoTimestamp(value.occurredAt)) throw new DomainValidationError("Invalid Event: occurredAt must be a valid IsoTimestamp");
  if (!isRunId(value.runId)) throw new DomainValidationError("Invalid Event: runId must be a valid RunId");
  if (value.taskId !== undefined && !isTaskId(value.taskId)) {
    throw new DomainValidationError("Invalid Event: taskId must be a valid TaskId");
  }
  if (!(EVENT_TYPES as readonly string[]).includes(String(value.type))) {
    throw new DomainValidationError("Invalid Event: type must be a known event type");
  }
  if (typeof value.actor !== "string" || value.actor.trim() === "") {
    throw new DomainValidationError("Invalid Event: actor must be a non-empty string");
  }
  const reason = payloadError(value.type as M0EventType, value.payload);
  if (reason !== undefined) {
    throw new DomainValidationError(`Invalid Event: ${reason}`);
  }
  return value as unknown as Event;
}
