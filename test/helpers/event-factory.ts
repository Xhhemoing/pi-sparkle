import {
  createEventId,
  createProjectId,
  createRunId,
  createTaskId,
  type EventId,
  type RunId
} from "../../src/domain/ids.js";
import { defaultRunLimits } from "../../src/domain/limits.js";
import type { Run } from "../../src/domain/run.js";
import { parseIsoTimestamp } from "../../src/domain/timestamp.js";
import type { Event, M0EventType } from "../../src/run/events.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

export const TEST_TIMESTAMP = "2026-08-12T09:00:00.000Z";

export function makeRun(): Run {
  return {
    id: createRunId(UUID),
    projectId: createProjectId(UUID),
    rootTaskId: createTaskId(UUID),
    status: "PLANNING",
    limits: defaultRunLimits(),
    createdAt: parseIsoTimestamp(TEST_TIMESTAMP),
    updatedAt: parseIsoTimestamp(TEST_TIMESTAMP)
  };
}

export function makeEvent(
  type: M0EventType,
  payload?: unknown,
  overrides: {
    id?: EventId;
    runId?: RunId;
    occurredAt?: string;
    actor?: string;
    taskId?: string;
  } = {}
): Event {
  return {
    id: overrides.id ?? createEventId(UUID),
    schemaVersion: 1,
    occurredAt: overrides.occurredAt ?? TEST_TIMESTAMP,
    runId: overrides.runId ?? createRunId(UUID),
    ...(overrides.taskId !== undefined ? { taskId: overrides.taskId } : {}),
    type,
    actor: overrides.actor ?? "test",
    payload
  } as Event;
}
