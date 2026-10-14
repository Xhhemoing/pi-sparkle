import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import { createMessageId, createTaskId, type TaskId } from "../../../src/domain/ids.js";
import { defaultRunLimits } from "../../../src/domain/limits.js";
import type { TaskNode } from "../../../src/domain/task.js";
import { nowIso } from "../../../src/domain/timestamp.js";
import type { AgentExecutionRequest, AgentExecutor, ExecutionEvent } from "../../../src/execution/contract.js";
import type { JudgeAdapter } from "../../../src/graph/judge.js";
import { SUPERVISOR } from "../../../src/protocol/v1.js";
import { startSupervisedRun } from "../../../src/run/supervisor.js";

function task(id: string, dependencies: string[] = []): TaskNode {
  return {
    id: createTaskId(() => id), title: id, objective: `Complete ${id}`, role: "worker",
    dependencies: dependencies.map((dependency) => createTaskId(() => dependency)),
    acceptanceCriteria: [{ id: "works", description: "Independent check passes" }],
    status: "PENDING", attempt: 0, maxAttempts: 2, timeoutMs: 5_000,
    artifactIds: [], evidenceIds: []
  };
}

class SuccessfulChild implements AgentExecutor {
  readonly calls: TaskId[] = [];

  async *execute(request: AgentExecutionRequest): AsyncIterable<ExecutionEvent> {
    this.calls.push(request.taskId);
    yield {
      type: "MESSAGE",
      message: {
        protocolVersion: 1, id: createMessageId(), occurredAt: nowIso(),
        runId: request.runId, taskId: request.taskId, from: request.agentInstanceId,
        to: SUPERVISOR, type: "TASK_RESULT", outcome: "SUCCESS", summary: "child reports success",
        artifactIds: [], evidenceIds: ["evd_result" as never],
        verification: { kind: "PASSED", evidenceIds: ["evd_result" as never] }
      }
    };
    yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
  }
}

async function runScenario(tasks: TaskNode[], maxRounds: number, judge?: JudgeAdapter) {
  const root = await mkdtemp(join(tmpdir(), "sparkle-verdict-boundary-"));
  const executor = new SuccessfulChild();
  try {
    const outcome = await startSupervisedRun({
      stateRoot: join(root, "state"), executor,
      registry: createAgentProfileRegistry(defaultAgentProfiles()),
      ...(judge !== undefined ? { judge } : {})
    }, {
      projectRoot: root, objective: "Verify supervisor authority", tasks,
      limits: { ...defaultRunLimits(), maxRounds, maxConsecutiveStalls: 10 }
    }).done;
    return { outcome, calls: executor.calls };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("judge rejection overrides child SUCCESS and exhausts the task attempt budget", async () => {
  const { outcome, calls } = await runScenario([task("a"), task("b", ["a"])], 5, {
    decide: (input) => ({ taskId: input.taskId, verdict: "REJECTED", evidenceIds: [], reason: "independent check failed" })
  });
  assert.equal(outcome.status, "FAILED");
  assert.deepEqual(calls, ["tsk_a", "tsk_a"], "dependent b must not start after a rejected self-report");
  assert.equal(outcome.events.some((event) => event.type === "TASK_STATUS_CHANGED" && event.payload.status === "COMPLETED"), false);
});

test("a rejected successful child can complete only after a later judge approval", async () => {
  let decisions = 0;
  const { outcome, calls } = await runScenario([task("a"), task("b", ["a"])], 3, {
    decide: (input) => ({ taskId: input.taskId, verdict: decisions++ === 0 ? "REJECTED" : "APPROVED", evidenceIds: input.evidenceIds })
  });
  assert.deepEqual(calls, ["tsk_a", "tsk_a", "tsk_b"]);
  assert.equal(outcome.status, "COMPLETED");
});

for (const [name, tasks, rounds] of [
  ["single task", [task("a")], 1],
  ["parallel tasks", [task("a"), task("b")], 1],
  ["sequential tasks", [task("a"), task("b", ["a"])], 2]
] as const) {
  test(`${name} complete on the final allowed round`, async () => {
    const { outcome } = await runScenario([...tasks], rounds);
    assert.equal(outcome.status, "COMPLETED");
    assert.equal(outcome.events.filter((event) => event.type === "RUN_COMPLETED").length, 1);
    assert.equal(outcome.events.some((event) => event.type === "RUN_FAILED"), false);
    assert.equal(outcome.checkpoint.status, "COMPLETED");
  });
}

test("round exhaustion still fails a graph that has unfinished dependent work", async () => {
  const { outcome, calls } = await runScenario([task("a"), task("b", ["a"])], 1);
  assert.equal(outcome.status, "FAILED");
  assert.deepEqual(calls, ["tsk_a"]);
  assert.equal(outcome.events.some((event) => event.type === "RUN_COMPLETED"), false);
});
