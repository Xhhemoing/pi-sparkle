import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startRun } from "../../../src/run/coordinator.js";
import { PiAgentExecutor } from "../../../src/pi-adapter/pi-executor.js";

test("PiAgentExecutor drives a real Pi Agent through the faux provider", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-pi-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-pi-proj-"));
  try {
    const executor = new PiAgentExecutor({ providerId: "faux", modelId: "faux-1" });
    const running = startRun({ stateRoot, executor }, { projectRoot, objective: "Say hello" });
    const outcome = await running.done;

    assert.equal(outcome.status, "COMPLETED");
    const textDeltas = outcome.events.filter(
      (event) =>
        event.type === "AGENT_EVENT" && (event.payload as { kind: string }).kind === "TEXT_DELTA"
    );
    assert.ok(textDeltas.length >= 1, "expected at least one text delta from the faux provider");
    const finished = outcome.events.find((event) => event.type === "AGENT_FINISHED");
    assert.deepEqual((finished?.payload as { outcome: string }).outcome, "SUCCESS");
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});
