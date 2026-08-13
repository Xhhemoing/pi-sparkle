import assert from "node:assert/strict";
import { test } from "node:test";
import { createRunId, createTaskId, type TaskId } from "../../../src/domain/ids.js";
import type { TaskNode } from "../../../src/domain/task.js";
import type { TaskStatus } from "../../../src/domain/status.js";
import { validateTaskGraph } from "../../../src/graph/validate.js";
import {
  applyRetry,
  applySkipped,
  applyTaskOutcome,
  LeaseRegistry,
  planRound,
  type TaskOutcome
} from "../../../src/run/scheduler.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

function task(id: string, dependencies: string[] = []): TaskNode {
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
    evidenceIds: []
  };
}

function statusMap(graph: ReturnType<typeof validateTaskGraph>): Map<TaskId, TaskStatus> {
  const map = new Map<TaskId, TaskStatus>();
  for (const node of graph.tasks) map.set(node.id, node.status);
  return map;
}

function setStatuses(
  map: Map<TaskId, TaskStatus>,
  updates: Record<string, TaskStatus>
): void {
  for (const [id, status] of Object.entries(updates)) {
    map.set(createTaskId(() => id), status);
  }
}

test("planRound returns ready tasks in deterministic topological order", () => {
  const graph = validateTaskGraph([task("c", ["a", "b"]), task("a"), task("b")]);
  const statuses = statusMap(graph);
  const round = planRound(graph, statuses, 2, 1_000);
  assert.deepEqual(round, ["tsk_a", "tsk_b"], "only ready tasks, capped by concurrency");

  setStatuses(statuses, { a: "COMPLETED", b: "COMPLETED" });
  assert.deepEqual(planRound(graph, statuses, 2, 1_000), ["tsk_c"]);
});

test("planRound respects the concurrency cap and skips leased tasks", () => {
  const graph = validateTaskGraph([task("a"), task("b"), task("c")]);
  const statuses = statusMap(graph);
  assert.deepEqual(planRound(graph, statuses, 2, 1_000), ["tsk_a", "tsk_b"], "cap at 2");

  // A leased task is not planned again.
  const leases = new LeaseRegistry(() => 0);
  leases.lease(createTaskId(() => "a"), createRunId(UUID), 5_000);
  setStatuses(statuses, { a: "RUNNING" });
  assert.deepEqual(planRound(graph, statuses, 2, 1_000, leases), ["tsk_b", "tsk_c"]);
});

test("LeaseRegistry enforces one lease per task and expiry", () => {
  let now = 0;
  const leases = new LeaseRegistry(() => now);
  const taskId = createTaskId(() => "a");
  const lease = leases.lease(taskId, createRunId(UUID), 5_000);
  assert.equal(lease.taskId, taskId);
  assert.equal(leases.isExpired(lease), false);
  assert.throws(() => leases.lease(taskId, createRunId(UUID), 5_000), /leased/i);

  now = 5_001;
  assert.equal(leases.isExpired(lease), true);
  assert.equal(leases.expired().length, 1);
  leases.release(taskId);
  assert.throws(() => leases.release(taskId), /not leased|lease/i);
});

test("applyTaskOutcome follows the declared state machine", () => {
  const graph = validateTaskGraph([task("a")]);
  const node = graph.byId.get(createTaskId(() => "a"))!;

  const success = applyTaskOutcome(node, "SUCCESS");
  assert.equal(success.status, "COMPLETED");

  const failed = applyTaskOutcome(node, "FAILURE");
  assert.equal(failed.status, "BLOCKED", "a failed attempt blocks the task");
  assert.equal(failed.attempt, 1);

  // Retry is a declared supervisor transition: BLOCKED -> READY.
  const retried = applyRetry({ ...node, status: "BLOCKED", attempt: 1 });
  assert.equal(retried.status, "READY");
  assert.throws(() => applyRetry({ ...node, status: "RUNNING" }), /Cannot retry/);

  const exhausted = applyTaskOutcome({ ...node, attempt: 2, maxAttempts: 3 }, "FAILURE");
  assert.equal(exhausted.status, "FAILED");

  const cancelled = applyTaskOutcome(node, "CANCELLED");
  assert.equal(cancelled.status, "CANCELLED");

  const skipped = applySkipped(node);
  assert.equal(skipped.status, "SKIPPED");
});

test("a timed-out task blocks, retries to READY, and downstream waits for the join", () => {
  const graph = validateTaskGraph([task("b", ["a"]), task("a")]);
  const statuses = statusMap(graph);

  const round1 = planRound(graph, statuses, 2, 1_000);
  assert.deepEqual(round1, ["tsk_a"]);

  // Task a times out: it blocks with attempt 1; the join stays unsatisfied.
  const nodeA = graph.byId.get(createTaskId(() => "a"))!;
  const timedOut = applyTaskOutcome(nodeA, "TIMEOUT");
  assert.equal(timedOut.status, "BLOCKED");
  setStatuses(statuses, { a: "BLOCKED" });
  assert.deepEqual(planRound(graph, statuses, 2, 1_000), [], "join is unsatisfied while a is BLOCKED");

  // Supervisor retries: BLOCKED -> READY, then a is schedulable again.
  const retried = applyRetry({ ...nodeA, status: "BLOCKED", attempt: 1 });
  assert.equal(retried.status, "READY");
  setStatuses(statuses, { a: "READY" });
  assert.deepEqual(planRound(graph, statuses, 2, 1_000), ["tsk_a"]);
});

test("outcomes outside the accepted set are rejected", () => {
  const graph = validateTaskGraph([task("a")]);
  const node = graph.byId.get(createTaskId(() => "a"))!;
  assert.throws(() => applyTaskOutcome(node, "BOGUS" as TaskOutcome), /outcome/);
});
