import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultRunLimits } from "../../../src/domain/limits.js";
import type { AgentExecutor } from "../../../src/execution/contract.js";
import { GatedExecutor, FakeExecutor } from "../../../src/testing/fake-executor.js";
import { startRun, type CoordinatorDeps } from "../../../src/run/coordinator.js";
import { replayRun, validateCheckpoint } from "../../../src/run/replay.js";

async function withTempRoot(run: (stateRoot: string, projectRoot: string) => Promise<void>) {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-proj-"));
  try {
    await run(stateRoot, projectRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

const deps = (stateRoot: string, executor: CoordinatorDeps["executor"]): CoordinatorDeps => ({
  stateRoot,
  executor
});

test("a successful run records the full event sequence and a valid checkpoint", async () => {
  await withTempRoot(async (stateRoot, projectRoot) => {
    const executor = new FakeExecutor([
      { type: "TEXT_DELTA", text: "inspecting" },
      { type: "TOOL_STARTED", toolCallId: "t1", toolName: "read_file" },
      { type: "TOOL_FINISHED", toolCallId: "t1", isError: false, summary: "read 10 lines" },
      { type: "EXECUTION_FINISHED", outcome: "SUCCESS" }
    ]);
    const running = await startRun(deps(stateRoot, executor), { projectRoot, objective: "Audit the project" });
    const outcome = await running.done;

    assert.equal(outcome.status, "COMPLETED");
    assert.equal(outcome.runId, running.runId);
    assert.deepEqual(
      outcome.events.map((event) => event.type),
      [
        "PROJECT_DISCOVERED",
        "RUN_CREATED",
        "EPISODE_OPENED",
        "RUN_ATTACHED",
        "RUN_STARTED",
        "AGENT_STARTED",
        "AGENT_EVENT",
        "AGENT_EVENT",
        "AGENT_EVENT",
        "AGENT_FINISHED",
        "RUN_COMPLETED",
        "EPISODE_CLOSED"
      ]
    );
    const agentFinished = outcome.events.find((event) => event.type === "AGENT_FINISHED");
    assert.deepEqual(agentFinished?.payload, {
      agentInstanceId: (agentFinished?.payload as { agentInstanceId: string }).agentInstanceId,
      outcome: "SUCCESS"
    });
    assert.equal(outcome.checkpoint.status, "COMPLETED");
    assert.equal(outcome.checkpoint.run?.id, outcome.runId);
    assert.equal(outcome.checkpoint.lastEventId, outcome.events[outcome.events.length - 1]?.id);
    assert.deepEqual(validateCheckpoint(outcome.checkpoint), outcome.checkpoint);

    const replayed = replayRun(outcome.events);
    assert.equal(replayed.status, "COMPLETED");
    assert.deepEqual(replayed.agentOutcomes, outcome.checkpoint.agentOutcomes);
  });
});

test("the coordinator forwards a configured max cost to the executor request", async () => {
  await withTempRoot(async (stateRoot, projectRoot) => {
    const executor = new FakeExecutor([{ type: "EXECUTION_FINISHED", outcome: "SUCCESS" }]);
    const running = startRun(deps(stateRoot, executor), {
      projectRoot,
      objective: "Audit the project",
      limits: { ...defaultRunLimits(), maxCostUsd: 0.75 }
    });

    await running.done;

    assert.equal(executor.requests.length, 1);
    assert.equal(executor.requests[0]?.maxCostUsd, 0.75);
  });
});

test("the coordinator leaves max cost unset when run limits omit it", async () => {
  await withTempRoot(async (stateRoot, projectRoot) => {
    const executor = new FakeExecutor([{ type: "EXECUTION_FINISHED", outcome: "SUCCESS" }]);
    const running = startRun(deps(stateRoot, executor), {
      projectRoot,
      objective: "Audit the project",
      limits: defaultRunLimits()
    });

    await running.done;

    assert.equal(executor.requests.length, 1);
    assert.equal(executor.requests[0]?.maxCostUsd, undefined);
  });
});

test("an explicit agent failure produces a FAILED run with the failure reason", async () => {
  await withTempRoot(async (stateRoot, projectRoot) => {
    const executor = new FakeExecutor([{ type: "EXECUTION_FINISHED", outcome: "FAILURE" }]);
    const outcome = await (await startRun(deps(stateRoot, executor), { projectRoot, objective: "x" })).done;
    assert.equal(outcome.status, "FAILED");
    assert.equal(outcome.events.at(-1)?.type, "EPISODE_CLOSED");
    const failed = outcome.events.find((event) => event.type === "RUN_FAILED");
    assert.equal((failed?.payload as { reason: string }).reason, "agent reported failure");
  });
});

test("an executor that ends without a terminal event fails the run", async () => {
  await withTempRoot(async (stateRoot, projectRoot) => {
    const executor = new FakeExecutor([{ type: "TEXT_DELTA", text: "never finishes" }]);
    const outcome = await (await startRun(deps(stateRoot, executor), { projectRoot, objective: "x" })).done;
    assert.equal(outcome.status, "FAILED");
    const failed = outcome.events.find((event) => event.type === "RUN_FAILED");
    assert.match((failed?.payload as { reason: string }).reason, /terminal event/);
  });
});

test("an executor that throws fails the run with the error message", async () => {
  await withTempRoot(async (stateRoot, projectRoot) => {
    const executor: AgentExecutor = {
      async *execute() {
        yield { type: "TEXT_DELTA", text: "hi" };
        throw new Error("boom");
      }
    };
    const outcome = await (await startRun(deps(stateRoot, executor), { projectRoot, objective: "x" })).done;
    assert.equal(outcome.status, "FAILED");
    const failed = outcome.events.find((event) => event.type === "RUN_FAILED");
    assert.equal((failed?.payload as { reason: string }).reason, "boom");
  });
});

test("cancellation propagates to the executor and settles the run as CANCELLED", async () => {
  await withTempRoot(async (stateRoot, projectRoot) => {
    const executor = new GatedExecutor();
    const running = await startRun(deps(stateRoot, executor), { projectRoot, objective: "x" });
    await executor.started;
    running.cancel();
    const outcome = await running.done;
    assert.equal(executor.sawAbort, true);
    assert.equal(outcome.status, "CANCELLED");
    assert.equal(outcome.events.at(-1)?.type, "EPISODE_CLOSED");
    assert.ok(outcome.events.some((event) => event.type === "RUN_CANCEL_REQUESTED"));
  });
});

test("agent event summaries are bounded", async () => {
  await withTempRoot(async (stateRoot, projectRoot) => {
    const longText = "a".repeat(2000);
    const executor = new FakeExecutor([
      { type: "TEXT_DELTA", text: longText },
      { type: "EXECUTION_FINISHED", outcome: "SUCCESS" }
    ]);
    const outcome = await (await startRun(deps(stateRoot, executor), { projectRoot, objective: "x" })).done;
    const delta = outcome.events.find(
      (event) => event.type === "AGENT_EVENT" && (event.payload as { kind: string }).kind === "TEXT_DELTA"
    );
    assert.ok(((delta?.payload as { summary: string }).summary.length ?? 0) <= 501);
  });
});

test("a missing project root rejects without persisting a run directory", async () => {
  await withTempRoot(async (stateRoot, projectRoot) => {
    const executor = new FakeExecutor([{ type: "EXECUTION_FINISHED", outcome: "SUCCESS" }]);
    const running = await startRun(deps(stateRoot, executor), {
      projectRoot: join(projectRoot, "missing"),
      objective: "x"
    });
    await assert.rejects(() => running.done, /root/);
    let entries: string[];
    try {
      entries = await readdir(stateRoot);
    } catch {
      entries = [];
    }
    assert.deepEqual(entries, []);
  });
});
