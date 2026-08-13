import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import { createMessageId, createProjectId, createRunId, createTaskId, type RunId, type TaskId } from "../../../src/domain/ids.js";
import type { ProjectSnapshot } from "../../../src/domain/project.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import type { AgentExecutionRequest, AgentExecutor, ExecutionEvent } from "../../../src/execution/contract.js";
import { SUPERVISOR } from "../../../src/protocol/v1.js";
import { ChildCoordinator } from "../../../src/run/child-coordinator.js";
import { EventStore } from "../../../src/run/event-store.js";
import {
  applyRetry,
  applyTaskOutcome,
  LeaseRegistry,
  planRound,
  type TaskOutcome
} from "../../../src/run/scheduler.js";
import { validateTaskGraph, type TaskGraph } from "../../../src/graph/validate.js";
import type { TaskNode } from "../../../src/domain/task.js";
import type { TaskStatus } from "../../../src/domain/status.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

function sequenceGenerator(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`;
}

class SuccessChildExecutor implements AgentExecutor {
  async *execute(request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    if (signal.aborted) {
      yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
      return;
    }
    yield {
      type: "MESSAGE",
      message: {
        protocolVersion: 1,
        id: createMessageId(UUID),
        occurredAt: parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
        runId: request.runId,
        taskId: request.taskId,
        from: request.agentInstanceId,
        to: SUPERVISOR,
        type: "TASK_RESULT",
        outcome: "SUCCESS",
        summary: `completed ${request.taskId}`,
        artifactIds: [],
        evidenceIds: [],
        verification: { kind: "PASSED", evidenceIds: [] }
      }
    };
    yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
  }
}

class FailingChildExecutor implements AgentExecutor {
  /** Fails the target task only on its first execution (per task id). */
  private readonly failures = new Map<string, number>();
  constructor(private readonly failTask: TaskId) {}

  private markFailure(taskId: string): boolean {
    const count = this.failures.get(taskId) ?? 0;
    this.failures.set(taskId, count + 1);
    return count === 0;
  }

  async *execute(request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    if (signal.aborted) {
      yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
      return;
    }
    const outcome =
      request.taskId === this.failTask && this.markFailure(request.taskId)
        ? ("FAILURE" as const)
        : ("SUCCESS" as const);
    yield {
      type: "MESSAGE",
      message: {
        protocolVersion: 1,
        id: createMessageId(UUID),
        occurredAt: parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
        runId: request.runId,
        taskId: request.taskId,
        from: request.agentInstanceId,
        to: SUPERVISOR,
        type: "TASK_RESULT",
        outcome,
        summary: `${outcome === "SUCCESS" ? "completed" : "failed"} ${request.taskId}`,
        artifactIds: [],
        evidenceIds: [],
        verification: { kind: outcome === "SUCCESS" ? "PASSED" : "FAILED", evidenceIds: [] },
        ...(outcome === "FAILURE" ? { failure: { category: "TOOL_ERROR", detail: "boom" } } : {})
      }
    };
    yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
  }
}

const projectId = createProjectId(UUID);
const project: ProjectSnapshot = {
  id: projectId,
  rootPath: "/tmp/demo",
  discoveredAt: parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
  instructionFiles: [],
  manifests: [],
  commands: [],
  facts: []
};

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
    maxAttempts: 2,
    timeoutMs: 60_000,
    artifactIds: [],
    evidenceIds: []
  };
}

async function withTempState(run: (stateRoot: string) => Promise<void>) {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-m2-"));
  try {
    await run(stateRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
}

/**
 * Mini-supervisor loop: plan a round, lease each task to a child run, apply
 * the terminal outcome, and repeat until every task is terminal. Completed
 * tasks are never re-planned or re-executed.
 */
async function runGraph(
  stateRoot: string,
  graph: TaskGraph,
  executor: AgentExecutor,
  maxConcurrentTasks: number
): Promise<{ statuses: Map<TaskId, TaskStatus>; executed: TaskId[]; parentRunId: RunId }> {
  const seq = sequenceGenerator();
  const coordinator = new ChildCoordinator({
    stateRoot,
    executor,
    parentRunId: createRunId(seq),
    project,
    registry: createAgentProfileRegistry(defaultAgentProfiles()),
    maxConcurrentTasks,
    now: () => parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
    generateId: seq
  });
  const statuses = new Map<TaskId, TaskStatus>();
  for (const node of graph.tasks) statuses.set(node.id, "PENDING");
  const leases = new LeaseRegistry(() => 0);
  const executed: TaskId[] = [];
  const parentSignal = new AbortController().signal;

  for (let round = 0; round < 10; round += 1) {
    const ready = planRound(graph, statuses, maxConcurrentTasks, 5_000, leases);
    if (ready.length === 0) break;
    const results = await Promise.all(
      ready.map(async (taskId) => {
        const node = graph.byId.get(taskId)!;
        leases.lease(taskId, createRunId(seq), 5_000);
        statuses.set(taskId, "RUNNING");
        executed.push(taskId);
        const outcome = await coordinator.startChildTask(
          {
            taskId,
            role: node.role,
            objective: node.objective,
            profile: createAgentProfileRegistry(defaultAgentProfiles()).resolve(node.role),
            inputArtifactIds: [],
            acceptanceCriteria: node.acceptanceCriteria,
            limits: { maxAttempts: 2, timeoutMs: 60_000, maxWallTimeMs: 300_000 }
          },
          parentSignal
        ).done;
        leases.release(taskId);
        const mapped: TaskOutcome =
          outcome.outcome === "TIMEOUT" ? "TIMEOUT" : outcome.outcome === "CANCELLED" ? "CANCELLED" : outcome.outcome === "SUCCESS" ? "SUCCESS" : "FAILURE";
        const transition = applyTaskOutcome({ ...node, attempt: statuses.get(taskId) === "READY" ? 1 : 0 }, mapped);
        statuses.set(taskId, transition.status);
        return { taskId, transition };
      })
    );
    // Retry BLOCKED tasks whose attempts remain.
    for (const { taskId, transition } of results) {
      if (transition.status === "BLOCKED") {
        const node = graph.byId.get(taskId)!;
        statuses.set(taskId, applyRetry({ ...node, status: "BLOCKED", attempt: transition.attempt }).status);
      }
    }
  }
  return { statuses, executed, parentRunId: coordinator.parentRunId };
}

test("a diamond DAG schedules joins correctly and never reruns completed tasks", async () => {
  await withTempState(async (stateRoot) => {
    const graph = validateTaskGraph([
      task("d", ["b", "c"]),
      task("c", ["a"]),
      task("b", ["a"]),
      task("a")
    ]);
    const { statuses, executed } = await runGraph(stateRoot, graph, new SuccessChildExecutor(), 2);

    assert.equal(statuses.get(createTaskId(() => "a")), "COMPLETED");
    assert.equal(statuses.get(createTaskId(() => "b")), "COMPLETED");
    assert.equal(statuses.get(createTaskId(() => "c")), "COMPLETED");
    assert.equal(statuses.get(createTaskId(() => "d")), "COMPLETED");
    assert.equal(executed.length, 4);
    assert.deepEqual(
      executed.map((id) => id.slice(4)),
      ["a", "c", "b", "d"],
      "deterministic: input order breaks ties among ready tasks"
    );
    assert.equal(executed[0], createTaskId(() => "a"), "a has no dependencies and runs first");
    assert.equal(executed[3], createTaskId(() => "d"), "d waits for both joins and runs last");
    assert.ok(executed.indexOf(createTaskId(() => "b")) < executed.indexOf(createTaskId(() => "d")));
    assert.ok(executed.indexOf(createTaskId(() => "c")) < executed.indexOf(createTaskId(() => "d")));
  });
});

test("a failing task blocks, retries once, and a join still completes", async () => {
  await withTempState(async (stateRoot) => {
    const failTask = createTaskId(() => "b");
    const graph = validateTaskGraph([task("c", ["b"]), task("b", ["a"]), task("a")]);
    const { statuses, executed } = await runGraph(stateRoot, graph, new FailingChildExecutor(failTask), 2);

    assert.equal(statuses.get(createTaskId(() => "a")), "COMPLETED");
    // b fails on attempt 1 (maxAttempts 2) but retries to READY and succeeds.
    assert.equal(statuses.get(createTaskId(() => "b")), "COMPLETED");
    assert.equal(statuses.get(createTaskId(() => "c")), "COMPLETED");
    assert.equal(executed.length, 4, "a, b (x2 attempts), c");
    assert.equal(executed.filter((id) => id === failTask).length, 2, "failed task executed twice");
    const cIndex = executed.indexOf(createTaskId(() => "c"));
    assert.ok(cIndex > executed.indexOf(createTaskId(() => "b")), "c waits for the b join");
  });
});

test("a child run directory is created for every leased task", async () => {
  await withTempState(async (stateRoot) => {
    const graph = validateTaskGraph([task("a")]);
    const { statuses, parentRunId } = await runGraph(stateRoot, graph, new SuccessChildExecutor(), 1);
    assert.equal(statuses.get(createTaskId(() => "a")), "COMPLETED");
    const runDirs = await (await import("node:fs/promises")).readdir(join(stateRoot, "runs"));
    // One parent run directory plus one child run directory.
    assert.equal(runDirs.length, 2);
    const childDir = runDirs.find((dir) => dir !== parentRunId);
    assert.ok(childDir);
    const store = new EventStore(stateRoot, childDir as never);
    const read = await store.readAll();
    assert.ok(read.events.some((e) => e.type === "RUN_COMPLETED"));
  });
});
