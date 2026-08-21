import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseTaskId, parseRunId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import {
  aggregateCatalogObserved,
  buildCatalogObservedFromStateRoot,
  catalogObservedPath,
  loadCatalogObservedSnapshot,
  observedStatsForVersion,
  persistCatalogObserved
} from "../../../src/routing/catalog-observed.js";
import {
  catalogFromPrimary,
  cheapCatalogModel
} from "../../../src/routing/primary-catalog.js";
import { createModelRouter } from "../../../src/supervisor/model-router.js";
import type { ModelInvocation } from "../../../src/telemetry/model-invocation.js";

function invocation(overrides: Partial<ModelInvocation> = {}): ModelInvocation {
  return {
    id: "inv_1" as ModelInvocation["id"],
    taskId: parseTaskId("tsk_obs"),
    runId: parseRunId("run_obs"),
    agentInstanceId: "agt_1" as ModelInvocation["agentInstanceId"],
    config: { provider: "fake", model: "cheap", modelVersion: "cheap-v1", parameterHash: "abc" },
    responseHash: "def",
    tokensIn: 100,
    tokensOut: 50,
    latencyMs: 200,
    occurredAt: parseIsoTimestamp("2026-08-19T00:00:00.000Z"),
    ...overrides
  };
}

function cheapConfig(modelVersion: string | undefined) {
  return { provider: "fake", model: "cheap", modelVersion, parameterHash: "abc" };
}

test("p50 tokens and latency are aggregated independently per modelVersion", () => {
  const snapshot = aggregateCatalogObserved([
    invocation({
      tokensIn: 10,
      tokensOut: 100,
      latencyMs: 30,
      config: cheapConfig("cheap-v1")
    }),
    invocation({
      tokensIn: 20,
      tokensOut: 300,
      latencyMs: 10,
      config: cheapConfig("cheap-v1")
    }),
    invocation({
      tokensIn: 100,
      tokensOut: 200,
      latencyMs: 50,
      config: cheapConfig("cheap-v1")
    }),
    invocation({
      tokensIn: 1000,
      tokensOut: 10,
      latencyMs: 8_000,
      config: { provider: "fake", model: "premium", modelVersion: "premium-v1", parameterHash: "abc" }
    }),
    invocation({
      tokensIn: 3000,
      tokensOut: 30,
      latencyMs: 4_000,
      config: { provider: "fake", model: "premium", modelVersion: "premium-v1", parameterHash: "abc" }
    })
  ]);

  const cheap = snapshot.versions["cheap-v1"];
  assert.equal(cheap?.p50TokensIn, 20);
  assert.equal(cheap?.p50TokensOut, 200);
  assert.equal(cheap?.p50LatencyMs, 30);
  assert.equal(cheap?.sampleCount, 3);
  assert.equal(cheap?.tokensInSamples, 3);
  assert.equal(cheap?.tokensOutSamples, 3);
  assert.equal(cheap?.latencySamples, 3);

  const premium = snapshot.versions["premium-v1"];
  assert.equal(premium?.p50TokensIn, 2000);
  assert.equal(premium?.p50TokensOut, 20);
  assert.equal(premium?.p50LatencyMs, 6_000);
  assert.equal(premium?.sampleCount, 2);
});

test("missing tokensIn does not contribute to p50 and is not treated as zero", () => {
  const snapshot = aggregateCatalogObserved([
    invocation({ tokensIn: undefined, tokensOut: 10, latencyMs: 40, config: cheapConfig("cheap-v1") }),
    invocation({ tokensIn: 200, tokensOut: 90, latencyMs: 80, config: cheapConfig("cheap-v1") }),
    invocation({ tokensIn: 400, tokensOut: undefined, latencyMs: 120, config: cheapConfig("cheap-v1") })
  ]);
  const cheap = snapshot.versions["cheap-v1"];
  assert.equal(cheap?.p50TokensIn, 300);
  assert.equal(cheap?.p50TokensOut, 50);
  assert.equal(cheap?.p50LatencyMs, 80);
  assert.equal(cheap?.tokensInSamples, 2);
  assert.equal(cheap?.tokensOutSamples, 2);
  assert.equal(cheap?.latencySamples, 3);
  assert.notEqual(cheap?.p50TokensIn, 0);
});

test("a version whose samples all omit tokensIn has undefined p50TokensIn, not 0", () => {
  const snapshot = aggregateCatalogObserved([
    invocation({ tokensIn: undefined, tokensOut: 40, latencyMs: 15, config: cheapConfig("cheap-v1") }),
    invocation({ tokensIn: undefined, tokensOut: 80, latencyMs: 45, config: cheapConfig("cheap-v1") })
  ]);
  const cheap = snapshot.versions["cheap-v1"];
  assert.equal(cheap?.p50TokensIn, undefined);
  assert.equal(cheap?.p50TokensOut, 60);
  assert.equal(cheap?.p50LatencyMs, 30);
  assert.equal(cheap?.tokensInSamples, 0);
  assert.equal(cheap?.sampleCount, 2);
});

test("observed zero tokensIn is a real p50 of 0, unlike missing usage", () => {
  const zero = aggregateCatalogObserved([
    invocation({ tokensIn: 0, tokensOut: 10, latencyMs: 5, config: cheapConfig("cheap-v1") })
  ]);
  assert.equal(zero.versions["cheap-v1"]?.p50TokensIn, 0);

  const missing = aggregateCatalogObserved([
    invocation({ tokensIn: undefined, tokensOut: 10, latencyMs: 5, config: cheapConfig("cheap-v1") })
  ]);
  assert.equal(missing.versions["cheap-v1"]?.p50TokensIn, undefined);
});

test("empty snapshot and unobserved version have undefined p50 fields, never 0", () => {
  const empty = aggregateCatalogObserved([]);
  assert.deepEqual(empty.versions, {});
  const unobserved = observedStatsForVersion(empty, cheapCatalogModel().version);
  assert.equal(unobserved.p50TokensIn, undefined);
  assert.equal(unobserved.p50TokensOut, undefined);
  assert.equal(unobserved.p50LatencyMs, undefined);
  assert.equal(unobserved.sampleCount, 0);
  assert.equal(unobserved.tokensInSamples, 0);
  assert.equal(unobserved.tokensOutSamples, 0);
  assert.equal(unobserved.latencySamples, 0);
  assert.equal(unobserved.modelVersion, "cheap-v1");
});

test("unpinned invocations are skipped and do not invent a version string", () => {
  const snapshot = aggregateCatalogObserved([
    invocation({ config: cheapConfig(undefined), tokensIn: 9, tokensOut: 9, latencyMs: 9 }),
    invocation({ config: cheapConfig("cheap-v1"), tokensIn: 40, tokensOut: 40, latencyMs: 40 })
  ]);
  assert.equal(snapshot.versions["cheap-v1"]?.p50TokensIn, 40);
  assert.equal(snapshot.versions["cheap-v1"]?.sampleCount, 1);
  assert.equal(Object.keys(snapshot.versions).includes("unpinned"), false);
  assert.equal(Object.keys(snapshot.versions).includes("undefined"), false);
  assert.equal(Object.keys(snapshot.versions).length, 1);
});

test("building the observed snapshot leaves catalogFromPrimary and createModelRouter estimatedCostUsd unchanged", () => {
  const catalog = catalogFromPrimary({ primaryModelId: "premium", fastModelId: "cheap" });
  const cheap = catalog.models.find((model) => model.id === "cheap");
  const premium = catalog.models.find((model) => model.id === "premium");
  assert.ok(cheap);
  assert.ok(premium);
  const cheapCost = cheap.estimatedCostUsd;
  const premiumCost = premium.estimatedCostUsd;

  const snapshot = aggregateCatalogObserved([
    invocation({
      tokensIn: 1_000_000,
      tokensOut: 1_000_000,
      latencyMs: 8_000,
      config: cheapConfig("cheap-v1")
    })
  ]);
  assert.equal(snapshot.versions["cheap-v1"]?.p50TokensIn, 1_000_000);

  assert.equal(cheap.estimatedCostUsd, cheapCost);
  assert.equal(premium.estimatedCostUsd, premiumCost);
  const rebuilt = catalogFromPrimary({ primaryModelId: "premium", fastModelId: "cheap" });
  assert.equal(rebuilt.models.find((model) => model.id === "cheap")?.estimatedCostUsd, cheapCost);
  assert.equal(rebuilt.models.find((model) => model.id === "premium")?.estimatedCostUsd, premiumCost);

  const router = createModelRouter(catalog);
  const decision = router.route({
    taskId: parseTaskId("tsk_obs_live"),
    role: "actor",
    complexity: "LOW",
    modelPolicy: { allowedModels: ["cheap", "premium"] },
    limits: { remainingTimeMs: 60_000 }
  });
  assert.equal(decision.model, "cheap");
  assert.equal(decision.estimatedCostUsd, cheapCost);
});

test("persist omits unobserved p50 fields rather than writing 0, and load restores undefined", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-catalog-obs-"));
  try {
    const snapshot = aggregateCatalogObserved([
      invocation({ tokensIn: undefined, tokensOut: undefined, latencyMs: 12, config: cheapConfig("cheap-v1") })
    ]);
    const path = await persistCatalogObserved(stateRoot, snapshot);
    assert.equal(path, catalogObservedPath(stateRoot));
    const raw = await readFile(path, "utf8");
    assert.doesNotMatch(raw, /"p50TokensIn"\s*:\s*0/);
    assert.doesNotMatch(raw, /"p50TokensOut"\s*:\s*0/);
    assert.match(raw, /"p50LatencyMs"\s*:\s*12/);
    const parsed = JSON.parse(raw) as {
      versions: Record<string, Record<string, unknown>>;
    };
    assert.equal("p50TokensIn" in parsed.versions["cheap-v1"]!, false);
    assert.equal("p50TokensOut" in parsed.versions["cheap-v1"]!, false);

    const loaded = await loadCatalogObservedSnapshot(stateRoot);
    assert.equal(loaded.versions["cheap-v1"]?.p50TokensIn, undefined);
    assert.equal(loaded.versions["cheap-v1"]?.p50TokensOut, undefined);
    assert.equal(loaded.versions["cheap-v1"]?.p50LatencyMs, 12);
    assert.equal(loaded.versions["cheap-v1"]?.sampleCount, 1);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("buildCatalogObservedFromStateRoot reads invocations.jsonl and skips a missing log", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-catalog-obs-log-"));
  try {
    const missing = await buildCatalogObservedFromStateRoot(stateRoot);
    assert.deepEqual(missing.versions, {});
    await writeFile(
      join(stateRoot, "invocations.jsonl"),
      `${JSON.stringify(invocation({ tokensIn: 10, tokensOut: 20, latencyMs: 30 }))}\n`,
      "utf8"
    );
    const loaded = await buildCatalogObservedFromStateRoot(stateRoot);
    assert.equal(loaded.versions["cheap-v1"]?.p50TokensIn, 10);
    assert.equal(loaded.versions["cheap-v1"]?.p50TokensOut, 20);
    assert.equal(loaded.versions["cheap-v1"]?.p50LatencyMs, 30);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("live assign, model-router, primary-catalog, and flowchart-run do not import catalog-observed", async () => {
  const files = [
    "src/routing/assign.ts",
    "src/supervisor/model-router.ts",
    "src/routing/primary-catalog.ts",
    "src/run/flowchart-run.ts",
    "src/routing/catalog-observed.ts"
  ];
  const observed = await readFile("src/routing/catalog-observed.ts", "utf8");
  assert.doesNotMatch(observed, /routing\/r1/);
  assert.doesNotMatch(observed, /routing\/bandit/);
  assert.doesNotMatch(observed, /routing\/shadow/);
  assert.doesNotMatch(observed, /routing\/topology/);
  for (const file of files.slice(0, 4)) {
    const text = await readFile(file, "utf8");
    assert.doesNotMatch(text, /catalog-observed/, `${file} must not import catalog-observed`);
  }
});
