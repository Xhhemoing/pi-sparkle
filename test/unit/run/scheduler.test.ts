import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createRunId, createTaskId, type TaskId } from "../../../src/domain/ids.js";
import type { TaskNode } from "../../../src/domain/task.js";
import type { TaskStatus } from "../../../src/domain/status.js";
import type { IsoTimestamp } from "../../../src/domain/timestamp.js";
import { validateTaskGraph } from "../../../src/graph/validate.js";
import * as scheduler from "../../../src/run/scheduler.js";
import {
  applyRetry,
  applyTaskOutcome,
  LeaseRegistry,
  planRound,
  TASK_OUTCOMES,
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
  const round = planRound(graph, statuses, 2);
  assert.deepEqual(round, ["tsk_a", "tsk_b"], "only ready tasks, capped by concurrency");

  setStatuses(statuses, { a: "COMPLETED", b: "COMPLETED" });
  assert.deepEqual(planRound(graph, statuses, 2), ["tsk_c"]);
});

test("planRound respects the concurrency cap and skips leased tasks", () => {
  const graph = validateTaskGraph([task("a"), task("b"), task("c")]);
  const statuses = statusMap(graph);
  assert.deepEqual(planRound(graph, statuses, 2), ["tsk_a", "tsk_b"], "cap at 2");

  // A leased task is not planned again.
  const leases = new LeaseRegistry(() => 0);
  leases.lease(createTaskId(() => "a"), createRunId(UUID), 5_000);
  setStatuses(statuses, { a: "RUNNING" });
  assert.deepEqual(planRound(graph, statuses, 2, leases), ["tsk_b", "tsk_c"]);
});

test("LeaseRegistry enforces exactly one active lease per task", () => {
  let now = 0;
  const leases = new LeaseRegistry(() => now);
  const taskId = createTaskId(() => "a");
  const lease = leases.lease(taskId, createRunId(UUID), 5_000);
  assert.equal(lease.taskId, taskId);
  // The timestamps are derived from the injected clock and are what the
  // TASK_LEASED event carries.
  assert.equal(lease.leasedAt, new Date(0).toISOString());
  assert.equal(lease.expiresAt, new Date(5_000).toISOString());
  assert.deepEqual(leases.list(), [lease]);
  assert.throws(() => leases.lease(taskId, createRunId(UUID), 5_000), /leased/i);

  now = 5_001;
  leases.release(taskId);
  assert.equal(leases.active(taskId), undefined);
  assert.deepEqual(leases.list(), []);
  assert.throws(() => leases.release(taskId), /not leased|lease/i);
});

/**
 * Honesty pin for R2-9. `expired()` / `isExpired()` had no production caller,
 * so the registry advertised an expiry enforcement that never ran. They are
 * gone; a lease is released by its owner or recovered on resume, never swept.
 * Re-adding a sweep API without a live caller must go red here.
 */
test("leases do not expire: no sweep API, and planRound still skips a lease past expiresAt", () => {
  for (const name of ["expired", "isExpired"]) {
    assert.equal(
      name in (LeaseRegistry.prototype as unknown as Record<string, unknown>),
      false,
      `LeaseRegistry.${name}() is dead code; an expiry API needs a live caller first`
    );
  }

  let now = 0;
  const leases = new LeaseRegistry(() => now);
  const graph = validateTaskGraph([task("a"), task("b")]);
  const statuses = statusMap(graph);
  const taskId = createTaskId(() => "a");
  const lease = leases.lease(taskId, createRunId(UUID), 5_000);
  setStatuses(statuses, { a: "RUNNING" });
  assert.deepEqual(planRound(graph, statuses, 2, leases), ["tsk_b"]);

  // Well past expiresAt: the lease is still active and still blocks planning.
  now = Date.parse(lease.expiresAt) + 60_000;
  assert.deepEqual(leases.active(taskId), lease, "nothing reclaims a stale lease");
  assert.deepEqual(
    planRound(graph, statuses, 2, leases),
    ["tsk_b"],
    "planning ignores expiresAt; only release() or resume recovery frees the task"
  );

  leases.release(taskId);
  setStatuses(statuses, { a: "READY" });
  assert.deepEqual(planRound(graph, statuses, 2, leases), ["tsk_a", "tsk_b"]);
});

/**
 * Honesty pin for R3-8: `planRound` never read the lease duration it accepted,
 * so the parameter implied an expiry input that planning does not have. It is
 * gone from the signature; re-adding one means planning must actually consult
 * it, which contradicts the R2-9 contract above.
 */
test("planRound takes no lease-duration parameter", () => {
  assert.equal(planRound.length, 4, "graph, statusOf, maxConcurrentTasks, leases — no lease-duration slot");

  // Positional proof: the 4th argument is the registry, not a duration.
  const leases = new LeaseRegistry(() => 0);
  const graph = validateTaskGraph([task("a"), task("b")]);
  const statuses = statusMap(graph);
  leases.lease(createTaskId(() => "a"), createRunId(UUID), 5_000);
  setStatuses(statuses, { a: "RUNNING" });
  assert.deepEqual(planRound(graph, statuses, 2, leases), ["tsk_b"]);
});

/** Comments removed so a commented-out call cannot satisfy a source pin. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

const SUPERVISOR_SOURCE = stripComments(
  readFileSync(fileURLToPath(new URL("../../../src/run/supervisor.ts", import.meta.url)), "utf8")
);

test("restore rebuilds a resume lease and keeps mutual exclusion", () => {
  const leases = new LeaseRegistry(() => 1_000);
  const taskId = createTaskId(() => "a");
  const lease = {
    taskId,
    runId: createRunId(UUID),
    leasedAt: new Date(0).toISOString() as IsoTimestamp,
    expiresAt: new Date(300_000).toISOString() as IsoTimestamp
  };
  leases.restore(lease);
  assert.deepEqual(leases.active(taskId), lease, "restore keeps the persisted timestamps");
  assert.throws(() => leases.restore(lease), /leased/i);
  assert.throws(() => leases.lease(taskId, createRunId(UUID), 5_000), /leased/i);

  // restore() is not dead code: reconstructSupervisorState rebuilds RUNNING
  // leases from TASK_LEASED events and runSupervisorRounds recovers all of
  // them immediately, which is why no expiry check is involved.
  assert.match(SUPERVISOR_SOURCE, /leases\.restore\(/, "src/run/supervisor.ts must still restore leases");
  assert.match(SUPERVISOR_SOURCE, /for \(const lease of leases\.list\(\)\)/, "resume must recover every restored lease");
  assert.doesNotMatch(SUPERVISOR_SOURCE, /\.(isExpired|expired)\(/, "no caller may resurrect the removed expiry sweep");
});

/**
 * Honesty pin for R3-8. `applySkipped()` was a declared transition rule that
 * nothing in the DAG plane ever called, so the scheduler advertised a skip
 * decision the supervisor cannot make. It is gone. The flowchart plane's skip
 * injection is unaffected — it moves a `FlowNodeState`, not a `TaskStatus`.
 */
test("the DAG plane declares no skip transition, because nothing produces one", () => {
  const skipExports = Object.keys(scheduler).filter((name) => /skip/i.test(name));
  assert.deepEqual(skipExports, [], "a skip transition helper needs a live caller first");

  const graph = validateTaskGraph([task("a")]);
  const node = graph.byId.get(createTaskId(() => "a"))!;
  for (const outcome of TASK_OUTCOMES) {
    assert.notEqual(
      applyTaskOutcome({ ...node, attempt: 0, maxAttempts: 1 }, outcome).status,
      "SKIPPED",
      `no accepted outcome yields SKIPPED (${outcome})`
    );
  }

  assert.doesNotMatch(
    SUPERVISOR_SOURCE,
    /["']SKIPPED["']/,
    "the supervisor records no SKIPPED task; wiring one means restoring a declared transition rule here"
  );
});

/**
 * Honesty pin for R4-3. `applyRetry` was a declared rule with no production
 * caller: the supervisor recorded BLOCKED -> READY with a status literal at
 * both of its retry sites, so editing the rule changed nothing and the guard
 * below never ran. Both sites now go through it.
 */
test("the supervisor retries through applyRetry, not a status literal", () => {
  assert.match(SUPERVISOR_SOURCE, /applyRetry\(/, "the supervisor must call the declared retry rule");
  assert.doesNotMatch(
    SUPERVISOR_SOURCE,
    /recordStatus\([^)]*"READY"/,
    "a retry recorded as a literal bypasses applyRetry's BLOCKED guard"
  );
  assert.doesNotMatch(
    SUPERVISOR_SOURCE,
    /applyRetry\([^)]*status: "BLOCKED"/,
    "the rule must see the status the log recorded; a literal makes its guard vacuous"
  );

  // The guard the literal skipped: only a recorded BLOCKED may retry.
  const graph = validateTaskGraph([task("a")]);
  const node = graph.byId.get(createTaskId(() => "a"))!;
  for (const status of ["PENDING", "READY", "RUNNING", "COMPLETED", "SKIPPED", "FAILED", "CANCELLED"] as const) {
    assert.throws(
      () => applyRetry({ ...node, status, attempt: 1 }),
      /Cannot retry/,
      `${status} is not a retryable status`
    );
  }
  assert.equal(applyRetry({ ...node, status: "BLOCKED", attempt: 2 }).attempt, 2, "a retry keeps the attempt count");
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
});

test("a timed-out task blocks, retries to READY, and downstream waits for the join", () => {
  const graph = validateTaskGraph([task("b", ["a"]), task("a")]);
  const statuses = statusMap(graph);

  const round1 = planRound(graph, statuses, 2);
  assert.deepEqual(round1, ["tsk_a"]);

  // Task a times out: it blocks with attempt 1; the join stays unsatisfied.
  const nodeA = graph.byId.get(createTaskId(() => "a"))!;
  const timedOut = applyTaskOutcome(nodeA, "TIMEOUT");
  assert.equal(timedOut.status, "BLOCKED");
  setStatuses(statuses, { a: "BLOCKED" });
  assert.deepEqual(planRound(graph, statuses, 2), [], "join is unsatisfied while a is BLOCKED");

  // Supervisor retries: BLOCKED -> READY, then a is schedulable again.
  const retried = applyRetry({ ...nodeA, status: "BLOCKED", attempt: 1 });
  assert.equal(retried.status, "READY");
  setStatuses(statuses, { a: "READY" });
  assert.deepEqual(planRound(graph, statuses, 2), ["tsk_a"]);
});

test("outcomes outside the accepted set are rejected", () => {
  const graph = validateTaskGraph([task("a")]);
  const node = graph.byId.get(createTaskId(() => "a"))!;
  assert.throws(() => applyTaskOutcome(node, "BOGUS" as TaskOutcome), /outcome/);
});
