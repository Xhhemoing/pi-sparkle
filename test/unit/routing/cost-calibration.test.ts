import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { RoutingRefusalError } from "../../../src/domain/errors.js";
import { parseTaskId, parseRunId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import {
  catalogFromPrimary,
  cheapCatalogModel
} from "../../../src/routing/primary-catalog.js";
import {
  calibrateCatalogConfig,
  calibrateCatalogRates,
  loadInvocationsFromStateRoot,
  withCalibratedRates
} from "../../../src/routing/cost-calibration.js";
import { createModelRouter } from "../../../src/supervisor/model-router.js";
import type { ModelInvocation } from "../../../src/telemetry/model-invocation.js";

function invocation(overrides: Partial<ModelInvocation> = {}): ModelInvocation {
  return {
    id: "inv_1" as ModelInvocation["id"],
    taskId: parseTaskId("tsk_cost"),
    runId: parseRunId("run_cost"),
    agentInstanceId: "agt_1" as ModelInvocation["agentInstanceId"],
    config: { provider: "fake", model: "cheap", modelVersion: "cheap-v1", parameterHash: "abc" },
    responseHash: "def",
    tokensIn: 1000,
    tokensOut: 500,
    latencyMs: 200,
    occurredAt: parseIsoTimestamp("2026-08-19T00:00:00.000Z"),
    ...overrides
  };
}

test("missing token usage is skipped, never treated as zero", () => {
  const model = cheapCatalogModel();
  const rates = calibrateCatalogRates(model, [
    invocation({ tokensIn: undefined, tokensOut: undefined })
  ]);
  assert.equal(rates.samples, 0);
  assert.equal(rates.latencyMsPer1K, model.latencyMsPer1K);
});

test("latency is exponentially smoothed from invocations of the same version", () => {
  const model = cheapCatalogModel();
  const rates = calibrateCatalogRates(model, [invocation()]);
  assert.equal(rates.samples, 1);
  assert.ok(rates.latencyMsPer1K !== model.latencyMsPer1K);
});

test("unpinned or mismatched versions do not calibrate a pinned catalog row", () => {
  const model = cheapCatalogModel();
  const unpinned = calibrateCatalogRates(model, [
    invocation({ config: { provider: "fake", model: "cheap", modelVersion: undefined, parameterHash: "abc" } })
  ]);
  assert.equal(unpinned.samples, 0);
  const otherVersion = calibrateCatalogRates(model, [
    invocation({ config: { provider: "fake", model: "cheap", modelVersion: "cheap-v9", parameterHash: "abc" } })
  ]);
  assert.equal(otherVersion.samples, 0);
});

test("withCalibratedRates writes smoothed cost and duration back onto the catalog row", () => {
  const model = cheapCatalogModel();
  const heavy = invocation({ tokensIn: 1_000_000, tokensOut: 1_000_000, latencyMs: 8_000 });
  const rates = calibrateCatalogRates(model, [heavy]);
  const next = withCalibratedRates(model, rates);
  assert.ok(next.estimatedCostUsd > model.estimatedCostUsd);
  assert.ok(next.estimatedDurationMs > model.estimatedDurationMs);
  const none = withCalibratedRates(model, calibrateCatalogRates(model, []));
  assert.equal(none.estimatedCostUsd, model.estimatedCostUsd);
  assert.equal(none.estimatedDurationMs, model.estimatedDurationMs);
});

test("budget filter uses calibrated estimates on the next route", () => {
  const catalog = catalogFromPrimary({ primaryModelId: "premium", fastModelId: "cheap" });
  const before = createModelRouter(catalog);
  const task = {
    taskId: parseTaskId("tsk_budget"),
    role: "actor" as const,
    complexity: "LOW" as const,
    modelPolicy: { allowedModels: ["cheap", "premium"] },
    limits: { remainingTimeMs: 60_000, remainingCostUsd: 0.15 }
  };
  assert.equal(before.route(task).model, "cheap");

  const calibrated = calibrateCatalogConfig(catalog, [
    invocation({ tokensIn: 1_000_000, tokensOut: 1_000_000, latencyMs: 2_000 })
  ]);
  const after = createModelRouter(calibrated);
  assert.throws(
    () => after.route(task),
    (error: unknown) => {
      assert.ok(error instanceof RoutingRefusalError);
      assert.ok(error.refusals.some((row) => row.constraint === "budget"));
      return true;
    }
  );
});

test("loadInvocationsFromStateRoot skips a missing file and malformed or incomplete rows", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-inv-log-"));
  try {
    assert.deepEqual(await loadInvocationsFromStateRoot(stateRoot), []);
    await writeFile(
      join(stateRoot, "invocations.jsonl"),
      `${JSON.stringify(invocation())}\n{not json\n${JSON.stringify(invocation({ tokensIn: undefined, tokensOut: undefined }))}\n`,
      "utf8"
    );
    const loaded = await loadInvocationsFromStateRoot(stateRoot);
    assert.equal(loaded.length, 2);
    assert.equal(loaded[0]?.tokensIn, 1000);
    assert.equal(loaded[1]?.tokensIn, undefined);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});
