import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createRunId,
  createTaskId,
  createProjectId
} from "../../../src/domain/ids.js";
import { defaultRunLimits } from "../../../src/domain/limits.js";
import { validateEvent } from "../../../src/run/events.js";
import { makeEvent } from "../../helpers/event-factory.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

const run = {
  id: createRunId(UUID),
  projectId: createProjectId(UUID),
  rootTaskId: createTaskId(UUID),
  status: "PLANNING",
  limits: defaultRunLimits(),
  createdAt: "2026-08-12T09:00:00.000Z",
  updatedAt: "2026-08-12T09:00:00.000Z"
};

test("every M0 event type validates with a conforming payload", () => {
  const cases = [
    makeEvent("PROJECT_DISCOVERED", { project: { id: createProjectId(UUID), rootPath: "/tmp/demo", discoveredAt: "2026-08-12T09:00:00.000Z", instructionFiles: [], manifests: [], commands: [], facts: [] } }),
    makeEvent("RUN_CREATED", { run }),
    makeEvent("RUN_STARTED", {}),
    makeEvent("AGENT_STARTED", { agentInstanceId: "agt_01234567-89ab-cdef-0123-456789abcdef", taskId: createTaskId(UUID) }),
    makeEvent("AGENT_EVENT", { agentInstanceId: "agt_01234567-89ab-cdef-0123-456789abcdef", kind: "TOOL_FINISHED", summary: "Ran pnpm test" }),
    makeEvent("AGENT_FINISHED", { agentInstanceId: "agt_01234567-89ab-cdef-0123-456789abcdef", outcome: "SUCCESS" }),
    makeEvent("RUN_COMPLETED", {}),
    makeEvent("RUN_FAILED", { reason: "executor crashed" }),
    makeEvent("RUN_CANCEL_REQUESTED", {})
  ];
  for (const event of cases) {
    assert.deepEqual(validateEvent(event), event, `type ${event.type}`);
  }
});

test("events with invalid base fields are rejected", () => {
  const base = makeEvent("RUN_STARTED", {});
  assert.throws(() => validateEvent({ ...base, id: "nope" }), /id/);
  assert.throws(() => validateEvent({ ...base, schemaVersion: 2 }), /schemaVersion/);
  assert.throws(() => validateEvent({ ...base, occurredAt: "later" }), /occurredAt/);
  assert.throws(() => validateEvent({ ...base, runId: "RUN_x" }), /runId/);
  assert.throws(() => validateEvent({ ...base, type: "UNKNOWN" }), /type/);
  assert.throws(() => validateEvent({ ...base, actor: "" }), /actor/);
  assert.throws(() => validateEvent({ ...base, taskId: "not-an-id" }), /taskId/);
  assert.throws(() => validateEvent(null), /Event/);
});

test("events with malformed payloads are rejected", () => {
  assert.throws(() => validateEvent(makeEvent("RUN_CREATED", { run: { ...run, id: "bad" } })), /payload/);
  assert.throws(() => validateEvent(makeEvent("PROJECT_DISCOVERED", { project: "nope" })), /payload/);
  assert.throws(() => validateEvent(makeEvent("RUN_STARTED", null)), /payload/);
  assert.throws(
    () =>
      validateEvent(
        makeEvent("AGENT_STARTED", { agentInstanceId: "agt_01234567-89ab-cdef-0123-456789abcdef", taskId: "bad" })
      ),
    /payload/
  );
  assert.throws(
    () =>
      validateEvent(
        makeEvent("AGENT_EVENT", { agentInstanceId: "agt_01234567-89ab-cdef-0123-456789abcdef", kind: "LOGGED", summary: "x" })
      ),
    /payload/
  );
  assert.throws(
    () =>
      validateEvent(
        makeEvent("AGENT_EVENT", { agentInstanceId: "agt_01234567-89ab-cdef-0123-456789abcdef", kind: "TEXT_DELTA", summary: "  " })
      ),
    /payload/
  );
  assert.throws(
    () =>
      validateEvent(
        makeEvent("AGENT_FINISHED", { agentInstanceId: "agt_01234567-89ab-cdef-0123-456789abcdef", outcome: "DONE" })
      ),
    /payload/
  );
  assert.throws(() => validateEvent(makeEvent("RUN_FAILED", { reason: "" })), /payload/);
  assert.throws(() => validateEvent(makeEvent("RUN_COMPLETED", { extra: 1 })), /payload/);
});

test("pause and injection events validate fail-closed payloads", () => {
  assert.deepEqual(validateEvent(makeEvent("PAUSE_REQUESTED", {})), makeEvent("PAUSE_REQUESTED", {}));
  assert.deepEqual(
    validateEvent(makeEvent("PAUSE_REQUESTED", { reason: "hold" })),
    makeEvent("PAUSE_REQUESTED", { reason: "hold" })
  );
  assert.deepEqual(validateEvent(makeEvent("PAUSE_CLEARED", {})), makeEvent("PAUSE_CLEARED", {}));
  const fact = makeEvent("INJECTION_REQUESTED", {
    kind: "fact",
    actor: "user",
    confidence: 0.9,
    key: "k",
    value: true
  });
  assert.deepEqual(validateEvent(fact), fact);
  const skip = makeEvent("INJECTION_REQUESTED", { kind: "skip", actor: "user", confidence: 1, nodeId: "later" });
  assert.deepEqual(validateEvent(skip), skip);

  assert.throws(() => validateEvent(makeEvent("PAUSE_REQUESTED", { reason: "  " })), /reason/);
  assert.throws(() => validateEvent(makeEvent("PAUSE_CLEARED", { extra: 1 })), /payload/);
  assert.throws(
    () =>
      validateEvent(
        makeEvent("INJECTION_REQUESTED", { kind: "skip", actor: "user", confidence: 1, nodeId: "later", key: "nope" })
      ),
    /key|not valid|mismatch/
  );
  assert.throws(
    () =>
      validateEvent(
        makeEvent("INJECTION_REQUESTED", { kind: "eval", actor: "user", confidence: 1 })
      ),
    /kind/
  );
});
