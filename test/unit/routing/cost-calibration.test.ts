import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile  } from "node:fs/promises";
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
  calibrateCatalogFromState,
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
    callOutcome: "ok",
    ...overrides
  };
}

test("missing token usage is skipped, never treated as zero", () => {
  const model = cheapCatalogModel();
  const rates = calibrateCatalogRates(model, [
    invocation({ tokensIn: undefined, tokensOut: undefined })
  ]);
  assert.equal(rates.samples, 0);
  assert.equal(rates.skippedMissingUsage, 1);
  assert.equal(rates.latencyMsPer1K, model.latencyMsPer1K);
});

test("a failed call cannot move per-token cost even when it reports usage", () => {
  const model = cheapCatalogModel();
  // The provider's error payload carries a zeroed usage block; a partial
  // stream reports only what arrived. Both would drag the averages down.
  for (const callOutcome of ["error", "timeout", "cancelled"] as const) {
    const zeroed = calibrateCatalogRates(model, [
      invocation({ callOutcome, tokensIn: 0, tokensOut: 0, latencyMs: 30_000 })
    ]);
    assert.equal(zeroed.samples, 0, callOutcome);
    assert.equal(zeroed.excludedNotOk, 1, callOutcome);
    assert.equal(zeroed.skippedMissingUsage, 0, callOutcome);
    assert.equal(zeroed.estimatedCostUsd, model.estimatedCostUsd, callOutcome);
    assert.equal(zeroed.estimatedDurationMs, model.estimatedDurationMs, callOutcome);
    assert.equal(zeroed.latencyMsPer1K, model.latencyMsPer1K, callOutcome);

    const partial = calibrateCatalogRates(model, [
      invocation({ callOutcome, tokensIn: 900_000, tokensOut: 3, latencyMs: 45_000 })
    ]);
    assert.equal(partial.samples, 0, callOutcome);
    assert.equal(partial.latencyMsPer1K, model.latencyMsPer1K, callOutcome);
  }
});

test("one failed call cannot dilute the rate a successful call established", () => {
  const model = cheapCatalogModel();
  const heavy = invocation({ tokensIn: 1_000_000, tokensOut: 1_000_000, latencyMs: 8_000 });
  const okOnly = calibrateCatalogRates(model, [heavy]);
  const withFailure = calibrateCatalogRates(model, [
    heavy,
    invocation({ id: "inv_2" as ModelInvocation["id"], callOutcome: "error", tokensIn: 0, tokensOut: 0, latencyMs: 1 })
  ]);
  assert.equal(withFailure.samples, okOnly.samples);
  assert.equal(withFailure.estimatedCostUsd, okOnly.estimatedCostUsd);
  assert.equal(withFailure.estimatedDurationMs, okOnly.estimatedDurationMs);
  assert.equal(withFailure.excludedNotOk, 1);
});

test("a record with no terminal outcome is excluded rather than assumed successful", () => {
  const model = cheapCatalogModel();
  const rates = calibrateCatalogRates(model, [
    invocation({ callOutcome: undefined, tokensIn: 1_000_000, tokensOut: 1_000_000 })
  ]);
  assert.equal(rates.samples, 0);
  assert.equal(rates.excludedUnattributed, 1);
  assert.equal(rates.excludedNotOk, 0);
  assert.equal(rates.estimatedCostUsd, model.estimatedCostUsd);
  // Excluding it must leave the catalog row untouched, not zeroed.
  assert.equal(withCalibratedRates(model, rates), model);
});

test("exclusion counts are scoped to the model version being calibrated", () => {
  const model = cheapCatalogModel();
  const rates = calibrateCatalogRates(model, [
    invocation({ callOutcome: "error" }),
    invocation({
      callOutcome: "error",
      config: { provider: "fake", model: "cheap", modelVersion: "cheap-v9", parameterHash: "abc" }
    }),
    invocation({
      callOutcome: "error",
      config: { provider: "fake", model: "premium", modelVersion: "cheap-v1", parameterHash: "abc" }
    })
  ]);
  assert.equal(rates.excludedNotOk, 1);
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

test("a catalog calibrated only from failed calls stays uncalibrated", () => {
  const catalog = catalogFromPrimary({ primaryModelId: "premium", fastModelId: "cheap" });
  const calibrated = calibrateCatalogConfig(catalog, [
    invocation({ callOutcome: "error", tokensIn: 1_000_000, tokensOut: 1_000_000, latencyMs: 8_000 })
  ]);
  assert.equal(calibrated.policyVersion, catalog.policyVersion);
  assert.doesNotMatch(calibrated.policyVersion, /calibrated/);
});

test("loadInvocationsFromStateRoot skips a missing file and malformed or incomplete rows", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-inv-log-"));
  try {
    assert.deepEqual(await loadInvocationsFromStateRoot(stateRoot), []);
    await mkdir(join(stateRoot, "runtime"), { recursive: true });
    await writeFile(
      join(stateRoot, "runtime", "invocations.jsonl"),
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

/**
 * The loader documents "malformed or invalid rows are skipped" and feeds the
 * calibrated router on `pi run`/`resume` startup, so a shape-drifted row has to
 * be a skip. `isInvocation` used to throw on these, turning one bad row into a
 * startup crash.
 */
test("loadInvocationsFromStateRoot skips shape-drifted rows instead of crashing startup", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-inv-log-bad-"));
  try {
    await mkdir(join(stateRoot, "runtime"), { recursive: true });
    const good = invocation();
    const badRows = [
      "null",
      "42",
      '"a row"',
      "[]",
      JSON.stringify({ ...good, config: null }),
      JSON.stringify((() => {
        const { config: _config, ...rest } = good;
        return rest;
      })()),
      JSON.stringify({ ...good, config: "cheap" }),
      JSON.stringify({ ...good, config: { ...good.config, modelVersion: 1 } }),
      JSON.stringify({ ...good, pricing: null }),
      JSON.stringify({ ...good, pricing: 7 })
    ];
    await writeFile(
      join(stateRoot, "runtime", "invocations.jsonl"),
      `${[...badRows, JSON.stringify(good)].join("\n")}\n`,
      "utf8"
    );

    const loaded = await loadInvocationsFromStateRoot(stateRoot);
    assert.equal(loaded.length, 1, "only the well-formed row survives");
    assert.equal(loaded[0]?.config.modelVersion, "cheap-v1");

    // A bad row ahead of a good one must not stop the scan, and calibration
    // over the surviving rows still runs.
    const catalog = catalogFromPrimary({ primaryModelId: "premium", fastModelId: "cheap" });
    assert.equal(
      (await calibrateCatalogFromState(catalog, stateRoot)).models.length,
      catalog.models.length
    );
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});
