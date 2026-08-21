import assert from "node:assert/strict";
import { test } from "node:test";
import { applyEvidenceCascade } from "../../../src/routing/cascade-evidence.js";
import type { ModelDescriptor } from "../../../src/routing/capability-registry.js";
import { routeR0, type R0Config } from "../../../src/routing/r0.js";
import type { RouteRequest } from "../../../src/routing/policy.js";

function model(overrides: Partial<ModelDescriptor> & { modelId: string }): ModelDescriptor {
  return {
    providerId: "acme",
    version: "v1",
    contextWindow: 128_000,
    maxOutputTokens: 16_000,
    capabilities: ["tool-use"],
    privacyClass: "cloud-approved",
    providerPolicy: "approved",
    inputCostPerMTok: 1,
    outputCostPerMTok: 3,
    latencyMsPer1K: 80,
    ...overrides
  };
}

const CHEAP = model({ modelId: "cheap", version: "cheap-v1", inputCostPerMTok: 0.1, outputCostPerMTok: 0.3 });
const MID = model({ modelId: "mid", version: "mid-v1", inputCostPerMTok: 0.5, outputCostPerMTok: 1.5 });

const REQUEST: RouteRequest = {
  taskFamily: "edit",
  privacyRequired: "cloud-approved",
  requiredCapabilities: ["tool-use"],
  contextNeeded: 1_000,
  outputNeeded: 500,
  budgetUsd: 10,
  deadlineMs: 60_000,
  highRisk: false
};

const CONFIG: R0Config = { confidenceGate: 0.7, cascade: true, policyVersion: "r0-v1" };

test("cheap PASS from a deterministic check is retained", () => {
  const decision = routeR0(CONFIG, [CHEAP, MID], REQUEST);
  const result = applyEvidenceCascade(CONFIG, decision, "cheap", {
    source: "deterministic-check",
    kind: "PASS"
  });
  assert.equal(result.retained, true);
  assert.equal(result.escalated, false);
  assert.equal(result.abstained, false);
  assert.equal(result.decision.selection, "cheap");
});

test("cheap deterministic FAIL escalates", () => {
  const decision = routeR0(CONFIG, [CHEAP, MID], REQUEST);
  const result = applyEvidenceCascade(CONFIG, decision, "cheap", {
    source: "deterministic-check",
    kind: "FAIL"
  });
  assert.equal(result.escalated, true);
  assert.equal(result.decision.selection, "mid");
});

test("no check ABSTAINs without exploring", () => {
  const decision = routeR0(CONFIG, [CHEAP, MID], REQUEST);
  const result = applyEvidenceCascade(CONFIG, decision, "cheap", { source: "none", kind: "ABSTAIN" });
  assert.equal(result.abstained, true);
  assert.equal(result.escalated, false);
  assert.match(result.decision.reason, /no deterministic check/);
});

test("high-risk forbids cascade exploration", () => {
  const decision = routeR0(CONFIG, [CHEAP, MID], { ...REQUEST, highRisk: true });
  const result = applyEvidenceCascade(CONFIG, decision, decision.selection ?? "cheap", {
    source: "deterministic-check",
    kind: "FAIL"
  });
  assert.equal(result.escalated, false);
  assert.match(result.decision.reason, /cascade exploration forbidden/);
});

test("critic cannot prove PASS", () => {
  const decision = routeR0(CONFIG, [CHEAP, MID], REQUEST);
  const result = applyEvidenceCascade(CONFIG, decision, "cheap", { source: "critic", kind: "PASS" });
  assert.equal(result.abstained, true);
  assert.match(result.decision.reason, /critic cannot prove PASS/);
});
