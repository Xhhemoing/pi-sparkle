import assert from "node:assert/strict";
import { test } from "node:test";
import { compareShadowR1 } from "../../../src/experiments/shadow-compare.js";
import type { ModelDescriptor } from "../../../src/routing/capability-registry.js";
import { routeR0 } from "../../../src/routing/r0.js";
import type { OutcomeObservation } from "../../../src/routing/outcomes.js";
import type { RouteRequest } from "../../../src/routing/policy.js";

test("shadow R1 records what it would pick without invoking", () => {
  const cheap: ModelDescriptor = {
    modelId: "cheap",
    providerId: "acme",
    version: "v1",
    contextWindow: 128_000,
    maxOutputTokens: 16_000,
    capabilities: ["tool-use"],
    privacyClass: "cloud-approved",
    providerPolicy: "approved",
    inputCostPerMTok: 0.1,
    outputCostPerMTok: 0.3,
    latencyMsPer1K: 80
  };
  const mid: ModelDescriptor = { ...cheap, modelId: "mid", version: "v2", inputCostPerMTok: 0.5, outputCostPerMTok: 1.5 };
  const request: RouteRequest = {
    taskFamily: "edit",
    privacyRequired: "cloud-approved",
    requiredCapabilities: ["tool-use"],
    contextNeeded: 1000,
    outputNeeded: 100,
    budgetUsd: 10,
    deadlineMs: 60_000,
    highRisk: false
  };
  const r0 = routeR0({ confidenceGate: 0.7, cascade: true, policyVersion: "r0-v1" }, [cheap, mid], request);
  const observations: OutcomeObservation[] = [];
  const result = compareShadowR1({
    r0,
    role: "implementer",
    featureVersion: "assign-v2",
    models: [cheap, mid],
    observations,
    nowMs: 1000,
    liveModelId: r0.selection ?? "cheap"
  });
  assert.equal(result.invoked, false);
  assert.equal(typeof result.agree, "boolean");
});
