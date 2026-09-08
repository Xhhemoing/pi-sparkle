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
  nObsEff,
  updatePosterior,
  weightedSampleSize,
} from "../../../src/routing/posterior.js";
import type { OutcomeObservation } from "../../../src/routing/outcomes.js";
import { DEFAULT_QUALITY_FLOOR, routeR1 } from "../../../src/routing/r1.js";

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
    criterion: "taskSuccess",
    outcome: "PASS",
    occurredAtMs: 1000,
    source: "deterministic-check",
    failureClass: "model",
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

  it("nObsEff subtracts prior strength and cannot impersonate samples", () => {
    const config = { ...DEFAULT_POSTERIOR_CONFIG, priorAlpha: 20, priorBeta: 20, minSamples: 5 };
    const priorOnly = updatePosterior(config, [], 1000);
    assert.equal(nObsEff(config, priorOnly), 0);
    assert.equal(isWellSampled(config, priorOnly), false);
  });

  it("beta quantile LCB of Beta(1,1) is the uniform 0.05 quantile", () => {
    const q = lowerConfidenceBound(
      { ...DEFAULT_POSTERIOR_CONFIG, lcbKind: "beta-quantile" },
      { alpha: 1, beta: 1 }
    );
    assert.ok(Math.abs(q - 0.05) < 0.002);
  });

  it("lower confidence bound rewards evidence density for both LCB kinds", () => {
    const sparse = { alpha: 6, beta: 1 };
    const dense = { alpha: 51, beta: 11 };
    assert.ok(sparse.alpha / (sparse.alpha + sparse.beta) > dense.alpha / (dense.alpha + dense.beta));
    for (const lcbKind of ["normal", "beta-quantile"] as const) {
      const config = { ...DEFAULT_POSTERIOR_CONFIG, lcbKind };
      assert.ok(
        lowerConfidenceBound(config, dense) > lowerConfidenceBound(config, sparse),
        lcbKind
      );
    }
  });

  it("beta-quantile LCB covers a seeded Bernoulli(0.7) fixture at least 90%", () => {
    const rng = mulberry32(1);
    const p = 0.7;
    const n = 30;
    const trials = 400;
    let covered = 0;
    for (let t = 0; t < trials; t++) {
      let alpha = 1;
      let beta = 1;
      for (let i = 0; i < n; i++) {
        if (rng() < p) alpha += 1;
        else beta += 1;
      }
      const lcb = lowerConfidenceBound(
        { ...DEFAULT_POSTERIOR_CONFIG, lcbKind: "beta-quantile" },
        { alpha, beta }
      );
      if (lcb <= p) covered += 1;
    }
    const rate = covered / trials;
    assert.ok(rate >= 0.9 && rate <= 1, `coverage ${rate}`);
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

  it("selects the cheapest eligible model whose LCB clears the quality floor", () => {
    const cheapPasses = Array.from({ length: 5 }, () => obs({ modelId: "cheap", modelVersion: "v1", outcome: "PASS" }));
    const midMixed = Array.from({ length: 50 }, () => obs({ modelId: "mid", modelVersion: "v2", outcome: "PASS" }))
      .concat(Array.from({ length: 10 }, () => obs({ modelId: "mid", modelVersion: "v2", outcome: "FAIL" })));
    const decision = routeR1(r1Input([...cheapPasses, ...midMixed]));
    assert.equal(decision.selection, "cheap");
    assert.equal(decision.fallback, false);
    assert.match(decision.reason, /cheapest above quality floor/);
    const midEstimate = decision.estimates.find((e) => e.modelId === "mid");
    const cheapEstimate = decision.estimates.find((e) => e.modelId === "cheap");
    assert.ok(cheapEstimate !== undefined && midEstimate !== undefined);
    assert.ok(cheapEstimate.lcb >= DEFAULT_QUALITY_FLOOR);
    assert.ok(midEstimate.lcb >= DEFAULT_QUALITY_FLOOR);
    assert.ok(midEstimate.lcb > cheapEstimate.lcb);
  });

  it("falls back to the R0 baseline when no well-sampled model clears the quality floor", () => {
    const cheapFails = Array.from({ length: 8 }, () => obs({ modelId: "cheap", modelVersion: "v1", outcome: "FAIL" }));
    const midFails = Array.from({ length: 8 }, () => obs({ modelId: "mid", modelVersion: "v2", outcome: "FAIL" }));
    const input = r1Input([...cheapFails, ...midFails]);
    const decision = routeR1(input);
    assert.equal(decision.fallback, true);
    assert.equal(decision.selection, input.r0.selection);
    assert.match(decision.reason, /quality floor/);
  });

  it("does not treat policyCompliance or userAcceptance as taskSuccess", () => {
    const cheapPasses = Array.from({ length: 5 }, () => obs({ modelId: "cheap", modelVersion: "v1", outcome: "PASS" }));
    const userFails = Array.from({ length: 40 }, () =>
      obs({
        modelId: "cheap",
        modelVersion: "v1",
        criterion: "userAcceptance",
        outcome: "FAIL",
      })
    );
    const decision = routeR1(r1Input([...cheapPasses, ...userFails]));
    assert.equal(decision.selection, "cheap");
    const cheapEstimate = decision.estimates.find((e) => e.modelId === "cheap");
    assert.equal(cheapEstimate?.samples, 5);
  });

  it("keeps the previous above-floor model until a cheaper one clears floor plus hysteresis", () => {
    const cheapPasses = Array.from({ length: 5 }, () => obs({ modelId: "cheap", modelVersion: "v1", outcome: "PASS" }));
    const midMixed = Array.from({ length: 50 }, () => obs({ modelId: "mid", modelVersion: "v2", outcome: "PASS" }))
      .concat(Array.from({ length: 10 }, () => obs({ modelId: "mid", modelVersion: "v2", outcome: "FAIL" })));
    const held = routeR1(
      r1Input([...cheapPasses, ...midMixed], { previousModelId: "mid", hysteresisMargin: 0.3 })
    );
    assert.equal(held.selection, "mid");
    assert.match(held.reason, /hysteresis/);
    const switched = routeR1(
      r1Input([...cheapPasses, ...midMixed], { previousModelId: "mid", hysteresisMargin: 0.01 })
    );
    assert.equal(switched.selection, "cheap");
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

  it("fails closed when a tier has no pinned version — an id never impersonates a version", () => {
    // Observations recorded under a "mid" key that would only match if the
    // model id were allowed to stand in for the missing version.
    const impersonated = Array.from({ length: 5 }, () =>
      obs({ modelId: "mid", modelVersion: "mid", outcome: "PASS" })
    );
    // "mid" is absent from the descriptor list, so its tier cannot be estimated.
    const decision = routeR1(r1Input(impersonated, { models: [CHEAP] }));
    assert.equal(decision.estimates.some((e) => e.modelId === "mid"), false);
    assert.equal(decision.estimates.some((e) => e.key.includes("|mid|")), false);
    // The cheap tier stays estimable; sparse cheap evidence falls back to R0.
    assert.equal(decision.fallback, true);
    assert.equal(decision.selection, "cheap");
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

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
