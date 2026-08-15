import assert from "node:assert/strict";
import { test } from "node:test";
import { createTaskId } from "../../../src/domain/ids.js";
import type { TaskNode } from "../../../src/domain/task.js";
import { validateTaskCollection, validateTaskNode } from "../../../src/domain/task.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

const validTask: TaskNode = {
  id: createTaskId(UUID),
  title: "Implement parser",
  objective: "Parse the input format",
  role: "worker",
  dependencies: [],
  acceptanceCriteria: [{ id: "ac-1", description: "Parses valid input" }],
  status: "PENDING",
  attempt: 0,
  maxAttempts: 3,
  timeoutMs: 60_000,
  artifactIds: [],
  evidenceIds: []
};

test("a valid task node validates", () => {
  assert.deepEqual(validateTaskNode(validTask), validTask);
});

test("invalid task nodes are rejected", () => {
  assert.throws(() => validateTaskNode(null), /TaskNode/);
  assert.throws(() => validateTaskNode({ ...validTask, title: "" }), /title/);
  assert.throws(() => validateTaskNode({ ...validTask, objective: "   " }), /objective/);
  assert.throws(() => validateTaskNode({ ...validTask, role: "unknown-role" }), /role/);
  assert.throws(() => validateTaskNode({ ...validTask, status: "DONE" }), /status/);
  assert.throws(() => validateTaskNode({ ...validTask, attempt: -1 }), /attempt/);
  assert.throws(() => validateTaskNode({ ...validTask, maxAttempts: 0 }), /maxAttempts/);
  assert.throws(() => validateTaskNode({ ...validTask, timeoutMs: 0 }), /timeoutMs/);
  assert.throws(
    () => validateTaskNode({ ...validTask, acceptanceCriteria: [{ id: "", description: "x" }] }),
    /acceptanceCriteria/
  );
  assert.throws(() => validateTaskNode({ ...validTask, dependencies: ["not-an-id"] }), /dependencies/);
  assert.throws(() => validateTaskNode({ ...validTask, dependencies: [validTask.id] }), /self/);
});

test("task collections reject duplicate ids", () => {
  const first = validateTaskNode(validTask);
  const second = {
    ...validTask,
    id: createTaskId(() => "11111111-2222-3333-4444-555555555555")
  };
  assert.deepEqual(validateTaskCollection([first, second]), [first, second]);
  assert.throws(() => validateTaskCollection([first, second, { ...second }]), /duplicate/i);
});

test("a task with an assigned child run validates", () => {
  const withRun = { ...validTask, assignedRunId: "run_01234567-89ab-cdef-0123-456789abcdef" };
  assert.deepEqual(validateTaskNode(withRun), withRun);
});

test("task confidence is optional and bounded to 0..1", () => {
  assert.equal(validateTaskNode(validTask).confidence, undefined, "M2 tasks without confidence stay valid");
  for (const confidence of [0, 0.5, 1]) {
    const withConfidence = { ...validTask, confidence };
    assert.deepEqual(validateTaskNode(withConfidence), withConfidence);
  }
  for (const bad of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY, "high", null]) {
    assert.throws(() => validateTaskNode({ ...validTask, confidence: bad }), /confidence/i);
  }
});
