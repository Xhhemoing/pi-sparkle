import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startRun } from "../../../src/run/coordinator.js";
import { PiAgentExecutor } from "../../../src/pi-adapter/pi-executor.js";
import type { ModelInvocation } from "../../../src/telemetry/model-invocation.js";
import { isInvocation } from "../../../src/telemetry/model-invocation.js";
import { hash32 } from "../../../src/domain/hash.js";

test("PiAgentExecutor records config + response hash through the onInvocation sink", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-inv-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-inv-proj-"));
  const recorded: ModelInvocation[] = [];
  try {
    const executor = new PiAgentExecutor({
      providerId: "faux",
      modelId: "faux-1",
      modelVersion: "faux-pinned-1",
      systemPrompt: "be brief",
      onInvocation: (invocation) => recorded.push(invocation),
    });
    const running = startRun({ stateRoot, executor }, { projectRoot, objective: "Say hello" });
    const outcome = await running.done;
    assert.equal(outcome.status, "COMPLETED");

    assert.equal(recorded.length, 1, "exactly one invocation record per execute call");
    const record = recorded[0];
    assert.ok(record !== undefined);
    assert.equal(isInvocation(record), true, "recorded invocation must pass validation");
    assert.equal(record.config.provider, "faux");
    assert.equal(record.config.model, "faux-1");
    assert.equal(record.config.modelVersion, "faux-pinned-1");
    assert.equal(
      record.config.parameterHash,
      hash32("faux|faux-1|off||be brief"),
      "parameter hash must reproduce from the frozen executor configuration"
    );
    assert.match(record.responseHash, /^[0-9a-f]{1,8}$/);
    // Usage extraction (2026-08-22): the faux provider reports real counts,
    // and they must now flow into the invocation record.
    assert.equal(typeof record.tokensIn, "number", "tokensIn must be captured when reported");
    assert.ok((record.tokensIn ?? 0) > 0);
    assert.equal(typeof record.tokensOut, "number");
    assert.ok(record.latencyMs >= 0);
    assert.ok(record.occurredAt.length > 0);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});
