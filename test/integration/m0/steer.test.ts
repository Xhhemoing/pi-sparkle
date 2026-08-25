import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { GatedExecutor, FakeExecutor } from "../../../src/testing/fake-executor.js";
import { startRun, type CoordinatorDeps } from "../../../src/run/coordinator.js";
import type { SteerInjectedPayload } from "../../../src/run/events.js";
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

test("steering a live run reaches the executor and is recorded with its actor and text", async () => {
  await withTempRoot(async (stateRoot, projectRoot) => {
    const executor = new GatedExecutor();
    const running = startRun(deps(stateRoot, executor), {
      projectRoot,
      objective: "Audit the project"
    });

    await executor.started;
    await running.steer("Prefer the migration path over the rewrite.");
    await running.steer("Stop after the schema change.", { actor: "supervisor" });
    running.cancel();
    const outcome = await running.done;

    assert.deepEqual(executor.steers, [
      "Prefer the migration path over the rewrite.",
      "Stop after the schema change."
    ]);

    const steered = outcome.events.filter((event) => event.type === "STEER_INJECTED");
    assert.equal(steered.length, 2);
    assert.equal(steered[0]?.actor, "user");
    assert.equal(steered[1]?.actor, "supervisor");
    assert.equal(
      (steered[0]?.payload as SteerInjectedPayload).text,
      "Prefer the migration path over the rewrite."
    );
    assert.equal((steered[1]?.payload as SteerInjectedPayload).text, "Stop after the schema change.");

    const agentStarted = outcome.events.find((event) => event.type === "AGENT_STARTED");
    assert.equal(
      (steered[0]?.payload as SteerInjectedPayload).agentInstanceId,
      (agentStarted?.payload as { agentInstanceId: string }).agentInstanceId
    );

    // A steer is not a run outcome: the run still cancels, replays, and
    // checkpoints exactly as it would have without one.
    assert.equal(outcome.status, "CANCELLED");
    assert.equal(replayRun(outcome.events).status, "CANCELLED");
    assert.deepEqual(validateCheckpoint(outcome.checkpoint), outcome.checkpoint);
  });
});

test("a steer lands in the log before the run reads its own event log back", async () => {
  await withTempRoot(async (stateRoot, projectRoot) => {
    const executor = new GatedExecutor();
    const running = startRun(deps(stateRoot, executor), { projectRoot, objective: "x" });

    await executor.started;
    // Deliberately not awaited: the run itself has to wait for the write.
    void running.steer("keep going but narrow the scope");
    running.cancel();
    const outcome = await running.done;

    const steered = outcome.events.filter((event) => event.type === "STEER_INJECTED");
    assert.equal(steered.length, 1);
    assert.equal((steered[0]?.payload as SteerInjectedPayload).text, "keep going but narrow the scope");
    assert.ok(
      outcome.events.indexOf(steered[0] as (typeof outcome.events)[number]) <
        outcome.events.findIndex((event) => event.type === "RUN_CANCEL_REQUESTED"),
      "the steer must be logged before the run's terminal event"
    );
  });
});

test("blank steer text is refused synchronously and never reaches the executor", async () => {
  await withTempRoot(async (stateRoot, projectRoot) => {
    const executor = new GatedExecutor();
    const running = startRun(deps(stateRoot, executor), { projectRoot, objective: "x" });

    await executor.started;
    assert.throws(() => running.steer(""), DomainValidationError);
    assert.throws(() => running.steer("   \n\t "), /non-empty/);
    assert.throws(() => running.steer("real text", { actor: " " }), /actor must be a non-empty string/);
    running.cancel();
    const outcome = await running.done;

    assert.deepEqual(executor.steers, []);
    assert.equal(outcome.events.some((event) => event.type === "STEER_INJECTED"), false);
  });
});

test("steering an executor that does not implement it is refused, not silently dropped", async () => {
  await withTempRoot(async (stateRoot, projectRoot) => {
    const executor = new FakeExecutor([
      { type: "TEXT_DELTA", text: "inspecting" },
      { type: "EXECUTION_FINISHED", outcome: "SUCCESS" }
    ]);
    assert.equal("steerText" in executor, false);

    const running = startRun(deps(stateRoot, executor), { projectRoot, objective: "x" });
    const outcome = await running.done;

    assert.throws(() => running.steer("too late anyway"), /does not support steering|no agent execution in flight/);
    assert.equal(outcome.events.some((event) => event.type === "STEER_INJECTED"), false);
  });
});

test("steering outside the execution window is refused", async () => {
  await withTempRoot(async (stateRoot, projectRoot) => {
    const executor = new GatedExecutor();
    const running = startRun(deps(stateRoot, executor), { projectRoot, objective: "x" });

    // Before the executor is reached: project discovery has not finished, so
    // there is no agent to steer yet.
    assert.throws(() => running.steer("far too early"), /no agent execution in flight/);

    await executor.started;
    await running.steer("in time");
    running.cancel();
    const outcome = await running.done;

    assert.throws(() => running.steer("far too late"), /no agent execution in flight/);
    assert.deepEqual(executor.steers, ["in time"]);
    assert.equal(outcome.events.filter((event) => event.type === "STEER_INJECTED").length, 1);
  });
});
