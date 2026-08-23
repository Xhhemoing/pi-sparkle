import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { startRun } from "../../../src/run/coordinator.js";
import { createConfiguredPiExecutor } from "../../../src/pi-adapter/runtime.js";

function skipReason(): string | false {
  if (process.env.PI_SMOKE !== "1") {
    return (
      "set PI_SMOKE=1 with PI_PROVIDER/PI_MODEL (+PI_API_KEY, or a providers.json " +
      "in the state root) to enable the real-provider smoke test"
    );
  }
  if (!process.env.PI_PROVIDER || !process.env.PI_MODEL) {
    return "PI_SMOKE=1 requires PI_PROVIDER and PI_MODEL to be set";
  }
  return false;
}

test(
  "PiAgentExecutor completes a run against a real provider",
  { skip: skipReason() },
  async () => {
    const stateRoot = process.env.PI_STATE_ROOT ?? join(homedir(), ".pi-sparkle");
    const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-pi-proj-"));
    try {
      // Configured factory: builtin AND custom providers.json models both
      // resolve here; keys come from stored credentials or provider envVar.
      const executor = await createConfiguredPiExecutor({
        stateRoot,
        providerId: process.env.PI_PROVIDER as string,
        modelId: process.env.PI_MODEL as string,
        thinkingLevel: "low",
        ...(process.env.PI_API_KEY !== undefined ? { apiKey: process.env.PI_API_KEY } : {})
      });
      const outcome = await startRun({ stateRoot, executor }, { projectRoot, objective: "Reply with exactly: OK" }).done;
      assert.equal(outcome.status, "COMPLETED");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  }
);
