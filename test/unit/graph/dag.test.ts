import assert from "node:assert/strict";
import { test } from "node:test";
import { createTaskId, type TaskId } from "../../../src/domain/ids.js";
import { validateTaskGraph } from "../../../src/graph/validate.js";
import { computeReadyTasks, allDependenciesSatisfied } from "../../../src/graph/readiness.js";
import type { TaskNode } from "../../../src/domain/task.js";

function task(id: string, dependencies: string[] = [], overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: createTaskId(() => id),
    title: id,
    objective: `Do ${id}`,
    role: "worker",
    dependencies: dependencies.map((dep) => createTaskId(() => dep)),
    acceptanceCriteria: [],
    status: "PENDING",
    attempt: 0,
    maxAttempts: 3,
    timeoutMs: 60_000,
    artifactIds: [],
    evidenceIds: [],
    ...overrides
  };
}

function statusOf(ids: Record<string, TaskNode["status"]>): (id: TaskId) => TaskNode["status"] {
  return (id) => ids[id.slice(4)] ?? "PENDING";
}

test("a valid DAG validates and produces a deterministic topological order", () => {
  const graph = validateTaskGraph([task("c", ["a", "b"]), task("a"), task("b", ["a"]), task("d", ["c"])]);
  assert.deepEqual(graph.topoOrder, ["tsk_a", "tsk_b", "tsk_c", "tsk_d"]);
  assert.equal(graph.byId.size, 4);
});

test("duplicate task ids are rejected", () => {
  assert.throws(
    () => validateTaskGraph([task("a"), task("a")]),
    /duplicate|Duplicate/i
  );
});

test("self-dependencies are rejected", () => {
  assert.throws(() => validateTaskGraph([task("a", ["a"])]), /self/i);
});

test("missing dependencies are rejected", () => {
  assert.throws(() => validateTaskGraph([task("a", ["ghost"])]), /ghost|missing|dependency/i);
});

test("cycles are rejected", () => {
  assert.throws(() => validateTaskGraph([task("a", ["b"]), task("b", ["a"])]), /cycle/i);
  assert.throws(() => validateTaskGraph([task("a", ["a"])]), /cycle|self/i);
});

test("readiness requires all dependencies COMPLETED or SKIPPED", () => {
  const graph = validateTaskGraph([task("c", ["a", "b"]), task("a"), task("b")]);
  const pending: Record<string, TaskNode["status"]> = { a: "PENDING", b: "PENDING", c: "PENDING" };
  assert.deepEqual(computeReadyTasks(graph, statusOf(pending)), ["tsk_a", "tsk_b"]);

  const aDone: Record<string, TaskNode["status"]> = { a: "COMPLETED", b: "PENDING", c: "PENDING" };
  assert.deepEqual(computeReadyTasks(graph, statusOf(aDone)), ["tsk_b"]);

  const bothDone: Record<string, TaskNode["status"]> = { a: "COMPLETED", b: "COMPLETED", c: "PENDING" };
  assert.deepEqual(computeReadyTasks(graph, statusOf(bothDone)), ["tsk_c"]);

  const bSkipped: Record<string, TaskNode["status"]> = { a: "COMPLETED", b: "SKIPPED", c: "PENDING" };
  assert.deepEqual(computeReadyTasks(graph, statusOf(bSkipped)), ["tsk_c"]);
});

test("a RUNNING or BLOCKED dependency keeps the join unsatisfied", () => {
  const graph = validateTaskGraph([task("c", ["a"]), task("a")]);
  assert.equal(
    allDependenciesSatisfied(graph.byId.get(createTaskId(() => "c"))!, statusOf({ a: "RUNNING" })),
    false
  );
  assert.equal(
    allDependenciesSatisfied(graph.byId.get(createTaskId(() => "c"))!, statusOf({ a: "BLOCKED" })),
    false
  );
  assert.equal(
    allDependenciesSatisfied(graph.byId.get(createTaskId(() => "c"))!, statusOf({ a: "FAILED" })),
    false
  );
});

test("computeReadyTasks is deterministic across identical inputs", () => {
  const graph = validateTaskGraph([task("z"), task("y", ["z"]), task("x", ["z"])]);
  const statuses: Record<string, TaskNode["status"]> = { z: "COMPLETED", y: "PENDING", x: "PENDING" };
  const first = computeReadyTasks(graph, statusOf(statuses));
  const second = computeReadyTasks(graph, statusOf(statuses));
  assert.deepEqual(first, second);
  assert.deepEqual(first, ["tsk_y", "tsk_x"], "topological order is preserved");
});
