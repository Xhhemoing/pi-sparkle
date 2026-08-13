import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAgentInstanceId,
  createMessageId,
  createProjectId,
  createRunId,
  createTaskId
} from "../../../src/domain/ids.js";
import { defaultRunLimits } from "../../../src/domain/limits.js";
import type { Run } from "../../../src/domain/run.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { SUPERVISOR, validateAgentMessage } from "../../../src/protocol/v1.js";
import { makeEvent } from "../../helpers/event-factory.js";
import { replayRun } from "../../../src/run/replay.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

const runId = createRunId(UUID);
const childRunId = createRunId(() => "11111111-2222-3333-4444-555555555555");
const projectId = createProjectId(UUID);
const taskId = createTaskId(UUID);
const agentId = createAgentInstanceId(UUID);
const occurredAt = parseIsoTimestamp("2026-08-12T09:00:00.000Z");

const run: Run = {
  id: runId,
  projectId,
  rootTaskId: taskId,
  status: "RUNNING",
  limits: defaultRunLimits(),
  createdAt: occurredAt,
  updatedAt: occurredAt
};

const childRun: Run = {
  id: childRunId,
  projectId,
  parentRunId: runId,
  rootTaskId: taskId,
  status: "RUNNING",
  limits: defaultRunLimits(),
  createdAt: occurredAt,
  updatedAt: occurredAt
};

const question = validateAgentMessage({
  protocolVersion: 1,
  id: createMessageId(UUID),
  occurredAt,
  runId: childRunId,
  taskId,
  from: agentId,
  to: SUPERVISOR,
  type: "QUESTION",
  question: "Proceed?",
  options: ["Yes", "No"]
});

test("replay reflects RUN_WAITING_FOR_USER and USER_ANSWER status flow", () => {
  const events = [
    makeEvent("RUN_CREATED", { run }),
    makeEvent("RUN_STARTED", {}),
    makeEvent("CHILD_RUN_CREATED", { childRun }, { taskId }),
    makeEvent("CHILD_MESSAGE", { message: question }, { taskId }),
    makeEvent("RUN_WAITING_FOR_USER", { messageId: question.id }, { taskId })
  ];
  const waiting = replayRun(events);
  assert.equal(waiting.status, "WAITING_FOR_USER");

  const answered = replayRun([
    ...events,
    makeEvent("USER_ANSWER", { messageId: question.id, answer: "Yes" }, { taskId })
  ]);
  assert.equal(answered.status, "RUNNING");
});

test("replay accepts M1 child lifecycle events without anomalies", () => {
  const events = [
    makeEvent("RUN_CREATED", { run }),
    makeEvent("RUN_STARTED", {}),
    makeEvent("CHILD_RUN_CREATED", { childRun }, { taskId }),
    makeEvent("CHILD_MESSAGE", { message: question }, { taskId }),
    makeEvent("TASK_TIMEOUT", { childRunId, attempt: 1 }, { taskId }),
    makeEvent("TASK_RETRY", { childRunId, attempt: 1, reason: "timed out" }, { taskId }),
    makeEvent("RUN_COMPLETED", {})
  ];
  const replayed = replayRun(events);
  assert.equal(replayed.status, "COMPLETED");
  assert.deepEqual(replayed.anomalies, []);
  assert.equal(replayed.lastEventId, events[events.length - 1]!.id);
});

test("RUN_WAITING_FOR_USER after a terminal event is an anomaly", () => {
  const events = [
    makeEvent("RUN_CREATED", { run }),
    makeEvent("RUN_STARTED", {}),
    makeEvent("RUN_COMPLETED", {}),
    makeEvent("RUN_WAITING_FOR_USER", { messageId: question.id }, { taskId })
  ];
  const replayed = replayRun(events);
  assert.ok(replayed.anomalies.some((a) => /WAITING_FOR_USER.*terminal/.test(a)));
});
