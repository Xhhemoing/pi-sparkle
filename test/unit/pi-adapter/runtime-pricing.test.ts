import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateCost, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { parseProvidersConfig } from "../../../src/config/providers-config.js";
import { createPiRuntime } from "../../../src/pi-adapter/runtime.js";

test("configured runtime preserves cache pricing and selects the whole-request tier above 272K", async () => {
  const config = parseProvidersConfig({ version: 1, enabled: [], customProviders: [{
    id: "synthetic", baseUrl: "https://example.invalid", models: [{ id: "priced",
      inputCostPerMTok: 2, outputCostPerMTok: 10, cacheReadCostPerMTok: 0.1, cacheWriteCostPerMTok: 2.5,
      costTiers: [{ inputTokensAbove: 272000, input: 4, output: 15, cacheRead: 0.2, cacheWrite: 5 }]
    }]
  }] });
  const runtime = await createPiRuntime({ stateRoot: "/unused", credentials: new InMemoryCredentialStore(), customProviders: config.customProviders });
  const model = runtime.models.getModel("synthetic", "priced");
  assert.ok(model);
  assert.equal(model.cost.cacheRead, 0.1);
  assert.equal(model.cost.cacheWrite, 2.5);
  const price = (input: number) => calculateCost(model, { input, output: 1000, cacheRead: 1000, cacheWrite: 1000,
    totalTokens: input + 3000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
  const atBoundary = price(270000);
  assert.ok(Math.abs(atBoundary.input - 0.54) < 1e-12);
  assert.ok(Math.abs(atBoundary.total - 0.5526) < 1e-12);
  assert.equal(atBoundary.output, 0.01);
  assert.equal(atBoundary.cacheRead, 0.0001);
  assert.equal(atBoundary.cacheWrite, 0.0025);
  const above = price(270001);
  assert.ok(Math.abs(above.input - 1.080004) < 1e-12);
  assert.ok(Math.abs(above.output - 0.015) < 1e-12);
  assert.ok(Math.abs(above.cacheRead - 0.0002) < 1e-12);
  assert.ok(Math.abs(above.cacheWrite - 0.005) < 1e-12);
  for (const cache of ["cacheRead", "cacheWrite"] as const) {
    const onlyCache = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 272001,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
    onlyCache[cache] = 272001;
    const amount = calculateCost(model, onlyCache);
    const expected = cache === "cacheRead" ? 0.0544002 : 1.360005;
    assert.ok(Math.abs(amount.total - expected) < 1e-12);
  }
});
