import assert from "node:assert/strict";
import { test } from "node:test";
import { createTaskId, createResourceVersionId } from "../../../src/domain/ids.js";

async function api() {
  const url = new URL("../../../src/routing/write-routing.js", import.meta.url).href;
  const loaded = await import(url).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ERR_MODULE_NOT_FOUND") return {};
    throw error;
  });
  assert.equal(typeof loaded.snapshotStaticWriteRouting, "function", "static routing must validate explicit host metadata");
  return loaded as typeof import("../../../src/routing/write-routing.js");
}
function config() {
  return { catalog: { policyVersion: "host-static-1", models: [{ id: "local/small", providerId: "local", version: "one",
    roles: ["actor" as const], maxComplexity: "HIGH" as const, providerPolicy: "approved" as const, privacyClass: "local" as const,
    capabilities: ["tool-use"], contextWindow: 8000, maxOutputTokens: 2048, inputCostPerMTok: 0,
    outputCostPerMTok: 0, latencyMsPer1K: 1, estimatedCostUsd: 0, estimatedDurationMs: 1 }] },
    modelPolicy: { allowedModels: ["local/small"] }, inputTokenReserve: 100, outputTokens: 512 };
}

test("auto routing rejects absent, nonfinite or inconsistent model identity, capacity and pricing metadata", async () => {
  const { snapshotStaticWriteRouting } = await api();
  for (const field of ["providerId", "version", "capabilities", "providerPolicy", "privacyClass", "contextWindow", "maxOutputTokens", "inputCostPerMTok", "outputCostPerMTok", "latencyMsPer1K", "estimatedCostUsd", "estimatedDurationMs"]) {
    const value = config(); delete (value.catalog.models[0] as unknown as Record<string, unknown>)[field];
    assert.throws(() => snapshotStaticWriteRouting(value), Error, field);
  }
  for (const field of ["contextWindow", "inputCostPerMTok", "outputCostPerMTok", "estimatedCostUsd", "estimatedDurationMs"]) {
    const value = config(); (value.catalog.models[0] as unknown as Record<string, unknown>)[field] = Number.NaN;
    assert.throws(() => snapshotStaticWriteRouting(value), Error, field);
  }
  const wrong = config(); wrong.catalog.models[0]!.providerId = "different";
  assert.throws(() => snapshotStaticWriteRouting(wrong), /provider|canonical/);
  const alias = config(); alias.catalog.models[0]!.id = "small";
  assert.throws(() => snapshotStaticWriteRouting(alias), /provider|canonical/);
});

test("auto routing snapshots nested policy/catalog data and refuses accessors without invoking them", async () => {
  const { snapshotStaticWriteRouting } = await api();
  const value = config(), copied = snapshotStaticWriteRouting(value)!;
  value.modelPolicy.allowedModels[0] = "local/other";
  value.catalog.models[0]!.capabilities.length = 0;
  assert.deepEqual(copied.modelPolicy.allowedModels, ["local/small"]);
  assert.deepEqual(copied.catalog.models[0]!.capabilities, ["tool-use"]);
  let reads = 0;
  const bad = config();
  Object.defineProperty(bad.catalog.models[0], "contextWindow", { get: () => { reads++; return 8000; } });
  assert.throws(() => snapshotStaticWriteRouting(bad), /data|accessor/);
  assert.equal(reads, 0);
  assert.equal(snapshotStaticWriteRouting(undefined), undefined);
});

test("static selection preserves absent, null and observed resource provenance distinctly", async () => {
  const { snapshotStaticWriteRouting, selectStaticWriteModel } = await api();
  const policy = snapshotStaticWriteRouting(config())!;
  const task = { taskId: createTaskId(), objective: "Update value", prompt: "Update value" };
  const unknown = selectStaticWriteModel(policy, task, { policy: undefined, resourceVersionId: undefined }, 60_000);
  assert.equal(Object.hasOwn(unknown.assignment.decision, "routingPolicyResourceVersionId"), false);
  const absent = selectStaticWriteModel(policy, task, { policy: undefined, resourceVersionId: null }, 60_000);
  assert.equal(absent.assignment.decision.routingPolicyResourceVersionId, null);
  const version = createResourceVersionId();
  const observed = selectStaticWriteModel(policy, task, { policy: { primaryModelId: "local/small", avoid: [], prefer: [] }, resourceVersionId: version }, 60_000);
  assert.equal(observed.assignment.decision.routingPolicyResourceVersionId, version);
});
