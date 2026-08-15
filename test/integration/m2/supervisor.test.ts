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
import { startSupervisedRun } from "../../../src/run/supervisor.js";
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

class ScriptedSupervisedExecutor implements AgentExecutor {
  constructor(private readonly failTask?: TaskId) {}

  async *execute(request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    if (signal.aborted) {
      yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
      return;
    }
    const shouldFail = this.failTask !== undefined && request.taskId === this.failTask;
    yield { type: "MESSAGE", message: resultMessage(request, shouldFail ? "FAILURE" : "SUCCESS") };
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
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-sup-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-sup-proj-"));
  try {
    await run(stateRoot, projectRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

test("a supervised DAG run completes with ledger revisions and judge decisions", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const running = startSupervisedRun(
      {
        stateRoot,
        executor: new ScriptedSupervisedExecutor(),
        registry: createAgentProfileRegistry(defaultAgentProfiles()),
        judge: new DeterministicJudge(),
        now: () => parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
        generateId: sequenceGenerator()
      },
      {
        projectRoot,
        objective: "Ship the parser",
        tasks: [task("c", ["a", "b"]), task("a"), task("b")],
        limits: { maxTasks: 3, maxConcurrentTasks: 2, maxAttemptsPerTask: 3, maxRounds: 10, maxConsecutiveStalls: 3, maxWallTimeMs: 600_000 }
      }
    );
    const outcome = await running.done;
    assert.equal(outcome.status, "COMPLETED");
    const types = outcome.events.map((e) => e.type);
    assert.ok(types.includes("TASK_GRAPH_ACCEPTED"));
    assert.ok(types.includes("TASK_LEASED"));
    assert.ok(types.includes("TASK_STATUS_CHANGED"));
    assert.ok(types.includes("LEDGER_UPDATED"));
    assert.ok(types.includes("JUDGE_DECISION"));
    assert.ok(!types.includes("RUN_BLOCKED"));
    const ledgerEvents = outcome.events.filter((e) => e.type === "LEDGER_UPDATED");
    assert.ok(ledgerEvents.length >= 2, "ledger advances across rounds");
    const revisions = ledgerEvents.map((e) => (e.payload as { revision: number }).revision);
    assert.deepEqual(revisions, [...revisions].sort((a, b) => a - b), "revisions are monotonic");
  });
});

test("an invalid task graph fails before any worker starts", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const running = startSupervisedRun(
      {
        stateRoot,
        executor: new ScriptedSupervisedExecutor(),
        registry: createAgentProfileRegistry(defaultAgentProfiles()),
        judge: new DeterministicJudge(),
        now: () => parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
        generateId: sequenceGenerator()
      },
      {
        projectRoot,
        objective: "x",
        tasks: [task("a", ["b"]), task("b", ["a"])],
        limits: { maxTasks: 2, maxConcurrentTasks: 1, maxAttemptsPerTask: 3, maxRounds: 10, maxConsecutiveStalls: 3, maxWallTimeMs: 600_000 }
      }
    );
    await assert.rejects(() => running.done, /cycle/i);
  });
});

test("repeated no-progress rounds block the run with required evidence", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const running = startSupervisedRun(
      {
        stateRoot,
        executor: new ScriptedSupervisedExecutor(createTaskId(() => "a")),
        registry: createAgentProfileRegistry(defaultAgentProfiles()),
        judge: new DeterministicJudge(),
        now: () => parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
        generateId: sequenceGenerator()
      },
      {
        projectRoot,
        objective: "x",
        // The failing task retries but never completes; no other progress exists.
        tasks: [task("a")],
        limits: { maxTasks: 1, maxConcurrentTasks: 1, maxAttemptsPerTask: 3, maxRounds: 10, maxConsecutiveStalls: 3, maxWallTimeMs: 600_000 }
      }
    );
    const outcome = await running.done;
    assert.equal(outcome.status, "BLOCKED");
    const types = outcome.events.map((e) => e.type);
    assert.ok(types.includes("STALL_DETECTED"));
    assert.ok(types.includes("RUN_BLOCKED"));
    const blocked = outcome.events.find((e) => e.type === "RUN_BLOCKED");
    assert.ok((blocked?.payload as { requiredEvidence: string[] }).requiredEvidence.length > 0);
  });
});

test("scheduled tasks record PENDING → READY → RUNNING, never PENDING → RUNNING", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const running = startSupervisedRun(
      {
        stateRoot,
        executor: new ScriptedSupervisedExecutor(),
        registry: createAgentProfileRegistry(defaultAgentProfiles()),
        judge: new DeterministicJudge(),
        now: () => parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
        generateId: sequenceGenerator()
      },
      {
        projectRoot,
        objective: "Ship the parser",
        tasks: [task("a")],
        limits: { maxTasks: 1, maxConcurrentTasks: 1, maxAttemptsPerTask: 3, maxRounds: 10, maxConsecutiveStalls: 3, maxWallTimeMs: 600_000 }
      }
    );
    const outcome = await running.done;
    assert.equal(outcome.status, "COMPLETED");
    const statuses = outcome.events
      .filter((e) => e.type === "TASK_STATUS_CHANGED")
      .map((e) => (e.payload as { status: string }).status);
    assert.ok(statuses.includes("READY"), "READY must be recorded before RUNNING");
    const readyAt = statuses.indexOf("READY");
    const runningAt = statuses.indexOf("RUNNING");
    assert.ok(readyAt >= 0 && runningAt > readyAt);
  });
});

test("an exhausted failed graph is FAILED, not COMPLETED", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const running = startSupervisedRun(
      {
        stateRoot,
        executor: new ScriptedSupervisedExecutor(createTaskId(() => "a")),
        registry: createAgentProfileRegistry(defaultAgentProfiles()),
        judge: new DeterministicJudge(),
        now: () => parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
        generateId: sequenceGenerator()
      },
      {
        projectRoot,
        objective: "x",
        tasks: [task("a")],
        limits: {
          maxTasks: 1,
          maxConcurrentTasks: 1,
          maxAttemptsPerTask: 1,
          maxRounds: 10,
          maxConsecutiveStalls: 10,
          maxWallTimeMs: 600_000
        }
      }
    );
    const outcome = await running.done;
    assert.equal(outcome.status, "FAILED");
    const types = outcome.events.map((e) => e.type);
    assert.ok(types.includes("RUN_FAILED"));
    assert.ok(!types.includes("RUN_COMPLETED"));
  });
});

test("leased childRunId matches the child run that actually executes", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const running = startSupervisedRun(
      {
        stateRoot,
        executor: new ScriptedSupervisedExecutor(),
        registry: createAgentProfileRegistry(defaultAgentProfiles()),
        judge: new DeterministicJudge(),
        now: () => parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
        generateId: sequenceGenerator()
      },
      {
        projectRoot,
        objective: "x",
        tasks: [task("a")],
        limits: { maxTasks: 1, maxConcurrentTasks: 1, maxAttemptsPerTask: 3, maxRounds: 10, maxConsecutiveStalls: 3, maxWallTimeMs: 600_000 }
      }
    );
    const outcome = await running.done;
    const leased = outcome.events.find((e) => e.type === "TASK_LEASED");
    const created = outcome.events.find((e) => e.type === "CHILD_RUN_CREATED");
    assert.ok(leased && created);
    const leasedId = (leased.payload as { childRunId: string }).childRunId;
    const createdId = (created.payload as { childRun: { id: string } }).childRun.id;
    assert.equal(leasedId, createdId);
  });
});
