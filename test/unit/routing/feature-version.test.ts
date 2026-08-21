import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeTask } from "../../../src/routing/analyze-task.js";
import { ASSIGN_FEATURE_VERSION, FEATURE_VERSION_REASONS } from "../../../src/routing/feature-version.js";
import { routeR1 } from "../../../src/routing/r1.js";
import { routeR0 } from "../../../src/routing/r0.js";
import type { ModelDescriptor } from "../../../src/routing/capability-registry.js";
import type { OutcomeObservation } from "../../../src/routing/outcomes.js";
import type { RouteRequest } from "../../../src/routing/policy.js";

test("ASSIGN_FEATURE_VERSION is the live isolation key and documents bump reasons", () => {
  assert.equal(ASSIGN_FEATURE_VERSION, "assign-v2");
  assert.ok(FEATURE_VERSION_REASONS.includes("contract-risk-flag-overrides-keywords"));
});

test("contract-risk flag overrides keyword heuristics", () => {
  const docs = analyzeTask("Document how to delete a cache key and describe auth headers", "implementer", {
    contractRisk: true
  });
  assert.equal(docs.highRisk, true);
  const deploy = analyzeTask("Deploy payment credentials to production", "implementer", {
    contractRisk: false
  });
  assert.equal(deploy.highRisk, false);
});

test("R1 posteriors do not reuse observations across feature versions", () => {
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
  const obs = (featureVersion: string): OutcomeObservation => ({
    taskFamily: "edit",
    role: "implementer",
    modelId: "cheap",
    modelVersion: "v1",
    featureVersion,
    criterion: "taskSuccess",
    outcome: "PASS",
    occurredAtMs: 1000,
    source: "deterministic-check"
  });
  const r0 = routeR0({ confidenceGate: 0.7, cascade: true, policyVersion: "r0-v1" }, [cheap, mid], request);
  const reused = routeR1({
    r0,
    role: "implementer",
    featureVersion: ASSIGN_FEATURE_VERSION,
    models: [cheap, mid],
    observations: [obs("assign-v1"), obs("assign-v1"), obs("assign-v1"), obs("assign-v1"), obs("assign-v1")],
    nowMs: 1000
  });
  assert.equal(reused.fallback, true);
});
