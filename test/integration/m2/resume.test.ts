import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import { createMessageId, createTaskId, type TaskId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import type { AgentExecutionRequest, AgentExecutor, ExecutionEvent } from "../../../src/execution/contract.js";
import { SUPERVISOR, type TaskResult } from "../../../src/protocol/v1.js";
import { DeterministicJudge } from "../../../src/graph/judge.js";
import { resumeSupervisedRun, startSupervisedRun } from "../../../src/run/supervisor.js";
import { EventStore } from "../../../src/run/event-store.js";
import type { TaskNode } from "../../../src/domain/task.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

function sequenceGenerator(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`;
}

function resultMessage(request: AgentExecutionRequest, outcome: "SUCCESS" | "FAILURE"): TaskResult {
  return {
    protocolVersion: 1,
    id: createMessageId(UUID),
    occurredAt: parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
    runId: request.runId,
    taskId: request.taskId,
    from: request.agentInstanceId,
    to: SUPERVISOR,
    type: "TASK_RESULT",
    outcome,
    summary: outcome === "SUCCESS" ? "done" : "failed",
    artifactIds: [],
    evidenceIds: outcome === "SUCCESS" ? [`evd_${request.taskId}` as never] : [],
    verification: { kind: outcome === "SUCCESS" ? "PASSED" : "FAILED", evidenceIds: [] },
    ...(outcome === "FAILURE" ? { failure: { category: "TOOL_ERROR", detail: "boom" } } : {})
  };
}

/** Executor that hangs (never yields a terminal) for the given task ids. */
class HangingExecutor implements AgentExecutor {
  constructor(private readonly hangTasks: readonly TaskId[]) {}

  async *execute(request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    if (this.hangTasks.includes(request.taskId)) {
      yield { type: "TEXT_DELTA", text: "hanging" };
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      if (signal.aborted) {
        yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
      }
      return;
    }
    yield { type: "MESSAGE", message: resultMessage(request, "SUCCESS") };
    yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
  }
}

function task(id: string, dependencies: string[] = []): TaskNode {
  return {
    id: createTaskId(() => id),
    title: id,
    objective: `Do ${id}`,
    role: "worker",
    dependencies: dependencies.map((dep) => createTaskId(() => dep)),
    acceptanceCriteria: [{ id: "ac-1", description: "works" }],
    status: "PENDING",
    attempt: 0,
    maxAttempts: 3,
    timeoutMs: 60_000,
    artifactIds: [],
    evidenceIds: []
  };
}

async function withTempState(run: (stateRoot: string, projectRoot: string) => Promise<void>) {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-resume-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-resume-proj-"));
  try {
    await run(stateRoot, projectRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

function deps(stateRoot: string, executor: AgentExecutor) {
  return {
    stateRoot,
    executor,
    registry: createAgentProfileRegistry(defaultAgentProfiles()),
    judge: new DeterministicJudge(),
    now: () => parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
    generateId: sequenceGenerator()
  };
}

function limits(maxTasks = 3) {
  const concurrency = Math.min(2, maxTasks);
  return { maxTasks, maxConcurrentTasks: concurrency, maxAttemptsPerTask: 3, maxRounds: 10, maxConsecutiveStalls: 3, maxWallTimeMs: 600_000 };
}

test("resume after an interruption completes without rerunning finished work", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const taskB = createTaskId(() => "b");
    const tasks = [task("c", ["a", "b"]), task("a"), task("b")];

    // First "process": b hangs, so the run cannot finish. We abandon the
    // handle (simulating a crash) once a has completed in the event log.
    const first = startSupervisedRun(deps(stateRoot, new HangingExecutor([taskB])), {
      projectRoot,
      objective: "Ship it",
      tasks,
      limits: limits()
    });
    const runId = first.runId;

    // Wait until the event log shows task a completed and b leased (RUNNING).
    const store = new EventStore(stateRoot, runId);
    let sawCheckpoint = false;
    for (let i = 0; i < 500; i += 1) {
      const read = await store.readAll();
      const types = read.events.filter((e) => e.type === "TASK_STATUS_CHANGED").map((e) => e.payload);
      const aDone = types.some((p) => (p as { taskId: string }).taskId === "tsk_a" && (p as { status: string }).status === "COMPLETED");
      const bRunning = types.some((p) => (p as { taskId: string }).taskId === "tsk_b" && (p as { status: string }).status === "RUNNING");
      if (aDone && bRunning) {
        sawCheckpoint = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(sawCheckpoint, true, "the interrupted run must persist a completed task and a running lease");
    // Simulate process death: abandon the first handle (its executor hangs).
    // After resume completes, cancel the abandoned handle so its pending
    // attempt timer does not keep the test process alive.
    const resumed = resumeSupervisedRun(deps(stateRoot, new HangingExecutor([])), runId);
    const outcome = await resumed.done;
    assert.equal(outcome.status, "COMPLETED");
    first.cancel();
    await first.done.catch(() => undefined);

    const completedEvents = outcome.events.filter(
      (e) => e.type === "TASK_STATUS_CHANGED" && (e.payload as { status: string }).status === "COMPLETED"
    );
    assert.equal(completedEvents.length, 3, "each task completes exactly once");
    const completedTaskIds = completedEvents.map((e) => (e.payload as { taskId: string }).taskId);
    assert.equal(new Set(completedTaskIds).size, 3, "no task completed twice");
  });
});

test("resume of an already-terminal run returns the same state", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const first = startSupervisedRun(deps(stateRoot, new HangingExecutor([])), {
      projectRoot,
      objective: "Ship it",
      tasks: [task("a")],
      limits: limits(1)
    });
    const runId = first.runId;
    const original = await first.done;
    assert.equal(original.status, "COMPLETED");

    const resumed = resumeSupervisedRun(deps(stateRoot, new HangingExecutor([])), runId);
    const outcome = await resumed.done;
    assert.equal(outcome.status, "COMPLETED");
    assert.equal(outcome.events.length, original.events.length, "no new events are appended");
    assert.equal(outcome.checkpoint.lastEventId, original.checkpoint.lastEventId);
  });
});

test("resume rejects an unknown run id", async () => {
  await withTempState(async (stateRoot, _projectRoot) => {
    const resumed = resumeSupervisedRun(
      deps(stateRoot, new HangingExecutor([])),
      createTaskId(() => "ghost") as never
    );
    await assert.rejects(() => resumed.done, /not found/);
  });
});
