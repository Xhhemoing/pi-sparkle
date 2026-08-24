import assert from "node:assert/strict";
import { test } from "node:test";
import { createTaskId, parseTaskId, type TaskId } from "../../../src/domain/ids.js";
import type { TaskStatus } from "../../../src/domain/status.js";
import type { TaskNode } from "../../../src/domain/task.js";
import { compileChildrenToFlowchart, type CompilableChild } from "../../../src/graph/compile-children.js";
import { computeReadyTasks } from "../../../src/graph/readiness.js";
import { validateTaskGraph } from "../../../src/graph/validate.js";

function task(id: string, dependencies: readonly string[] = []): TaskNode {
  return {
    id: createTaskId(() => id),
    title: id,
    objective: `Do ${id}`,
    role: "worker",
    dependencies: dependencies.map((dependency) => createTaskId(() => dependency)),
    acceptanceCriteria: [],
    status: "PENDING",
    attempt: 0,
    maxAttempts: 3,
    timeoutMs: 60_000,
    artifactIds: [],
    evidenceIds: []
  };
}

function statusOf(statuses: Readonly<Record<string, TaskStatus>>): (id: TaskId) => TaskStatus {
  return (id) => statuses[id] ?? "PENDING";
}

function child(id: string, dependencies: readonly string[] = []): CompilableChild {
  return {
    taskId: parseTaskId(`tsk_${id}`),
    role: "worker",
    objective: `Do ${id}`,
    dependsOn: dependencies.map((dependency) => parseTaskId(`tsk_${dependency}`))
  };
}

test("cycle detection covers disconnected and root-fed multi-node cycles", () => {
  assert.throws(
    () =>
      validateTaskGraph([
        task("root"),
        task("leaf", ["root"]),
        task("a", ["c"]),
        task("b", ["a"]),
        task("c", ["b"])
      ]),
    /cycle.*tsk_a.*tsk_b.*tsk_c/i
  );

  assert.throws(
    () =>
      validateTaskGraph([
        task("root"),
        task("a", ["root", "d"]),
        task("b", ["a"]),
        task("c", ["b"]),
        task("d", ["c"])
      ]),
    /cycle/i
  );
});

test("compiled child graphs reject cycles and duplicate join dependencies", () => {
  assert.throws(
    () =>
      compileChildrenToFlowchart([
        child("a", ["c"]),
        child("b", ["a"]),
        child("c", ["b"])
      ]),
    /cycle/i
  );
  assert.throws(
    () => compileChildrenToFlowchart([child("root"), child("join", ["root", "root"])]),
    /duplicate dependency/i
  );
});

test("join scheduling is deterministic and never releases a partial join", () => {
  const graph = validateTaskGraph([
    task("join", ["left", "right"]),
    task("left", ["root"]),
    task("right", ["root"]),
    task("root"),
    task("after", ["join"])
  ]);

  assert.deepEqual(graph.topoOrder, [
    "tsk_root",
    "tsk_left",
    "tsk_right",
    "tsk_join",
    "tsk_after"
  ]);
  assert.deepEqual(computeReadyTasks(graph, statusOf({})), ["tsk_root"]);

  const rootDone = statusOf({ tsk_root: "COMPLETED" });
  assert.deepEqual(computeReadyTasks(graph, rootDone), ["tsk_left", "tsk_right"]);
  assert.deepEqual(computeReadyTasks(graph, rootDone, 1), ["tsk_left"]);

  assert.deepEqual(
    computeReadyTasks(graph, statusOf({ tsk_root: "COMPLETED", tsk_left: "COMPLETED" })),
    ["tsk_right"]
  );
  assert.deepEqual(
    computeReadyTasks(
      graph,
      statusOf({
        tsk_root: "COMPLETED",
        tsk_left: "COMPLETED",
        tsk_right: "SKIPPED"
      })
    ),
    ["tsk_join"]
  );
  assert.deepEqual(
    computeReadyTasks(
      graph,
      statusOf({
        tsk_root: "COMPLETED",
        tsk_left: "COMPLETED",
        tsk_right: "COMPLETED",
        tsk_join: "RUNNING"
      })
    ),
    []
  );
  assert.deepEqual(
    computeReadyTasks(
      graph,
      statusOf({
        tsk_root: "COMPLETED",
        tsk_left: "COMPLETED",
        tsk_right: "COMPLETED",
        tsk_join: "COMPLETED"
      })
    ),
    ["tsk_after"]
  );
});

test("failed or blocked branches cannot satisfy an all-dependency join", () => {
  const graph = validateTaskGraph([
    task("left"),
    task("right"),
    task("join", ["left", "right"])
  ]);

  for (const unsatisfied of ["FAILED", "BLOCKED", "RUNNING", "CANCELLED"] as const) {
    const statuses = statusOf({
      tsk_left: "COMPLETED",
      tsk_right: unsatisfied
    });
    assert.deepEqual(computeReadyTasks(graph, statuses), [], `${unsatisfied} released the join`);
  }
});
