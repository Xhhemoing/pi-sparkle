import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ModelDescriptor } from "../../../src/routing/capability-registry.js";
import type { RouteRequest } from "../../../src/routing/policy.js";
import { routeR0 } from "../../../src/routing/r0.js";
import type { R0Config } from "../../../src/routing/r0.js";
import {
  DEFAULT_POSTERIOR_CONFIG,
  isWellSampled,
  lowerConfidenceBound,
  updatePosterior,
  weightedSampleSize,
} from "../../../src/routing/posterior.js";
import type { OutcomeObservation } from "../../../src/routing/outcomes.js";
import { routeR1 } from "../../../src/routing/r1.js";

function model(overrides: Partial<ModelDescriptor> & { modelId: string }): ModelDescriptor {
  return {
    providerId: "acme",
    version: "v1",
    contextWindow: 128_000,
    maxOutputTokens: 16_000,
    capabilities: ["tool-use"],
    privacyClass: "cloud-approved",
    providerPolicy: "approved",
    inputCostPerMTok: 1.0,
    outputCostPerMTok: 3.0,
    latencyMsPer1K: 80,
    ...overrides,
  };
}

const CHEAP = model({
  modelId: "cheap",
  version: "v1",
  inputCostPerMTok: 0.1,
  outputCostPerMTok: 0.3,
  contextWindow: 200_000,
});
const MID = model({
  modelId: "mid",
  version: "v2",
  inputCostPerMTok: 0.5,
  outputCostPerMTok: 1.5,
});

const REQUEST: RouteRequest = {
  taskFamily: "bugfix",
  privacyRequired: "cloud-approved",
  requiredCapabilities: ["tool-use"],
  contextNeeded: 100_000,
  outputNeeded: 4_000,
  budgetUsd: 10,
  deadlineMs: 60_000,
  highRisk: false,
};

const R0: R0Config = { confidenceGate: 0.7, cascade: true, policyVersion: "r0-v1" };

function obs(overrides: Partial<OutcomeObservation>): OutcomeObservation {
  return {
    taskFamily: "bugfix",
    role: "engineer",
    modelId: "cheap",
    modelVersion: "v1",
    featureVersion: "feat-1",
    outcome: "PASS",
    // Aligned with the default `nowMs` so fresh observations have exact weight 1.
    occurredAtMs: 1000,
    ...overrides,
  };
}

function r1Input(observations: OutcomeObservation[], overrides: Partial<Parameters<typeof routeR1>[0]> = {}) {
  const r0 = routeR0(R0, [CHEAP, MID], REQUEST);
  return {
    r0,
    role: "engineer",
    featureVersion: "feat-1",
    models: [CHEAP, MID],
    observations,
    nowMs: 1000,
    ...overrides,
  };
}

describe("M5-T2: Bayesian outcome posterior", () => {
  it("ignores ABSTAIN and UNOBSERVED — they are not failures or zeros", () => {
    const onlyInformative = [obs({ outcome: "PASS" }), obs({ outcome: "FAIL" })];
    const withNoise = [
      ...onlyInformative,
      obs({ outcome: "ABSTAIN" }),
      obs({ outcome: "UNOBSERVED" }),
      obs({ outcome: "UNOBSERVED" }),
    ];
    const a = updatePosterior(DEFAULT_POSTERIOR_CONFIG, onlyInformative, 1000);
    const b = updatePosterior(DEFAULT_POSTERIOR_CONFIG, withNoise, 1000);
    assert.deepEqual(a, b);
    assert.equal(a.alpha, 2);
    assert.equal(a.beta, 2);
  });

  it("passes raise the mean and failures lower it", () => {
    const passes = updatePosterior(DEFAULT_POSTERIOR_CONFIG, [obs({ outcome: "PASS" }), obs({ outcome: "PASS" })], 1000);
    const failures = updatePosterior(DEFAULT_POSTERIOR_CONFIG, [obs({ outcome: "FAIL" }), obs({ outcome: "FAIL" })], 1000);
    assert.equal(passes.alpha, 3);
    assert.equal(failures.beta, 3);
    assert.ok(weightedSampleSize(DEFAULT_POSTERIOR_CONFIG, passes) === 2);
  });

  it("recency decay is explicit and deterministic under fake time", () => {
    const config = { ...DEFAULT_POSTERIOR_CONFIG, halfLifeMs: 60 * 60 * 1000 };
    const tenPasses = Array.from({ length: 10 }, () => obs({ outcome: "PASS", occurredAtMs: 0 }));
    const fresh = updatePosterior(config, tenPasses, 0);
    const aged = updatePosterior(config, tenPasses, 2 * 60 * 60 * 1000);
    // weight per observation at 2 half-lives: 2^-2 = 0.25
    assert.equal(aged.alpha, 1 + 10 * 0.25);
    assert.ok(aged.alpha < fresh.alpha);
    // Deterministic: identical inputs give identical outputs.
    assert.deepEqual(aged, updatePosterior(config, tenPasses, 2 * 60 * 60 * 1000));
  });

  it("minimum samples gate well-sampled status", () => {
    const config = { ...DEFAULT_POSTERIOR_CONFIG, minSamples: 5 };
    const two = updatePosterior(config, [obs({ outcome: "PASS" }), obs({ outcome: "PASS" })], 1000);
    assert.equal(isWellSampled(config, two), false);
    const five = updatePosterior(config, Array.from({ length: 5 }, () => obs({ outcome: "PASS" })), 1000);
    assert.equal(isWellSampled(config, five), true);
  });

  it("lower confidence bound rewards evidence density", () => {
    const a = { alpha: 6, beta: 1 }; // mean 0.857, sparse
    const b = { alpha: 51, beta: 11 }; // mean 0.823, dense
    assert.ok(a.alpha / (a.alpha + a.beta) > b.alpha / (b.alpha + b.beta));
    assert.ok(lowerConfidenceBound(DEFAULT_POSTERIOR_CONFIG, b) > lowerConfidenceBound(DEFAULT_POSTERIOR_CONFIG, a));
  });
});

describe("M5-T2: R1 router", () => {
  it("falls back to the conservative R0 baseline when estimates are sparse", () => {
    const input = r1Input([obs({ outcome: "PASS" }), obs({ outcome: "PASS" })]);
    const decision = routeR1(input);
    assert.equal(decision.fallback, true);
    assert.equal(decision.selection, input.r0.selection);
    assert.match(decision.reason, /baseline/);
    assert.equal(decision.exploratory, false);
  });

  it("selects the eligible model with the highest lower confidence bound", () => {
    const cheapPasses = Array.from({ length: 5 }, () => obs({ modelId: "cheap", modelVersion: "v1", outcome: "PASS" }));
    const midMixed = Array.from({ length: 50 }, () => obs({ modelId: "mid", modelVersion: "v2", outcome: "PASS" }))
      .concat(Array.from({ length: 10 }, () => obs({ modelId: "mid", modelVersion: "v2", outcome: "FAIL" })));
    const decision = routeR1(r1Input([...cheapPasses, ...midMixed]));
    // cheap mean is higher but mid is far better sampled: LCB prefers mid.
    assert.equal(decision.selection, "mid");
    assert.equal(decision.fallback, false);
    const midEstimate = decision.estimates.find((e) => e.modelId === "mid");
    const cheapEstimate = decision.estimates.find((e) => e.modelId === "cheap");
    assert.ok(cheapEstimate !== undefined && midEstimate !== undefined);
    assert.ok(cheapEstimate!.mean > midEstimate!.mean);
    assert.ok(midEstimate!.lcb > cheapEstimate!.lcb);
  });

  it("model-version resets isolate estimates", () => {
    // v1 observations legitimately feed cheap@v1 but must not leak into mid@v2.
    const v1Passes = Array.from({ length: 5 }, () => obs({ modelVersion: "v1", outcome: "PASS" }));
    const decision = routeR1(r1Input(v1Passes));
    assert.equal(decision.selection, "cheap");
    const midEstimate = decision.estimates.find((e) => e.modelId === "mid");
    assert.equal(midEstimate?.alpha, DEFAULT_POSTERIOR_CONFIG.priorAlpha);
    assert.equal(midEstimate?.samples, 0);
  });

  it("feature-version changes isolate estimates", () => {
    const oldFeature = Array.from({ length: 5 }, () => obs({ featureVersion: "feat-0", outcome: "PASS" }));
    const decision = routeR1(r1Input(oldFeature));
    assert.equal(decision.fallback, true);
  });

  it("is fully deterministic for frozen inputs", () => {
    const observations = Array.from({ length: 5 }, () => obs({ outcome: "PASS" }));
    const a = routeR1(r1Input(observations));
    const b = routeR1(r1Input(observations));
    assert.deepEqual(a, b);
  });

  it("propagates an R0 refusal", () => {
    const impossible: RouteRequest = { ...REQUEST, requiredCapabilities: ["image-gen"] };
    const r0 = routeR0(R0, [CHEAP, MID], impossible);
    const decision = routeR1({
      r0,
      role: "engineer",
      featureVersion: "feat-1",
      models: [CHEAP, MID],
      observations: [],
      nowMs: 1000,
    });
    assert.equal(decision.selection, undefined);
    assert.match(decision.reason, /refused/);
  });
});
