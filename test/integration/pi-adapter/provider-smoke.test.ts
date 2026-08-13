import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startRun } from "../../../src/run/coordinator.js";
import { PiAgentExecutor } from "../../../src/pi-adapter/pi-executor.js";

function skipReason(): string | false {
  if (process.env.PI_SMOKE !== "1") {
    return "set PI_SMOKE=1 with PI_PROVIDER/PI_MODEL/PI_API_KEY to enable the real-provider smoke test";
  }
  if (!process.env.PI_PROVIDER || !process.env.PI_MODEL || !process.env.PI_API_KEY) {
    return "PI_SMOKE=1 requires PI_PROVIDER, PI_MODEL, and PI_API_KEY to be set";
  }
  return false;
}

test(
  "PiAgentExecutor completes a run against a real provider",
  { skip: skipReason() },
  async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-pi-state-"));
    const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-pi-proj-"));
    try {
      const executor = new PiAgentExecutor({
        providerId: process.env.PI_PROVIDER as string,
        modelId: process.env.PI_MODEL as string,
        ...(process.env.PI_API_KEY !== undefined ? { apiKey: process.env.PI_API_KEY } : {})
      });
      const outcome = await startRun({ stateRoot, executor }, { projectRoot, objective: "Reply with exactly: OK" }).done;
      assert.equal(outcome.status, "COMPLETED");
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
      await rm(projectRoot, { recursive: true, force: true });
    }
  }
);
