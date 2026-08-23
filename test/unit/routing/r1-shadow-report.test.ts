import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateComparisonReport } from "../../../src/experiments/comparison-report.js";
import type { ModelDescriptor } from "../../../src/routing/capability-registry.js";
import type { OutcomeObservation } from "../../../src/routing/outcomes.js";
import type { RouteRequest } from "../../../src/routing/policy.js";
import { routeR0, type R0Config } from "../../../src/routing/r0.js";
import { routeR1 } from "../../../src/routing/r1.js";
import {
  buildR1ShadowReport,
  type FrozenR1ShadowEpisode,
} from "../../../src/routing/r1-shadow-report.js";

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
  approvedForHighRisk: true,
});

const MODELS = [CHEAP, MID];
const R0: R0Config = { confidenceGate: 0.7, cascade: true, policyVersion: "r0-v1" };
const FEATURE = "feat-1";
const NOW_MS = 1000;
const IMPROVE = /improve|outperform|better|regret/i;

function request(overrides: Partial<RouteRequest> = {}): RouteRequest {
  return {
    taskFamily: "bugfix",
    privacyRequired: "cloud-approved",
    requiredCapabilities: ["tool-use"],
    contextNeeded: 100_000,
    outputNeeded: 4_000,
    budgetUsd: 10,
    deadlineMs: 60_000,
    highRisk: false,
    ...overrides,
  };
}

function obs(overrides: Partial<OutcomeObservation>): OutcomeObservation {
  return {
    taskFamily: "bugfix",
    role: "engineer",
    modelId: "cheap",
    modelVersion: "v1",
    featureVersion: FEATURE,
    criterion: "taskSuccess",
    outcome: "PASS",
    occurredAtMs: NOW_MS,
    source: "deterministic-check",
    failureClass: "model",
    ...overrides,
  };
}

function frozen(
  overrides: Partial<FrozenR1ShadowEpisode> & Pick<FrozenR1ShadowEpisode, "episodeHash">
): FrozenR1ShadowEpisode {
  const taskFamily = overrides.taskFamily ?? overrides.request?.taskFamily ?? "bugfix";
  return {
    taskFamily,
    role: "engineer",
    request: request({ taskFamily, ...overrides.request }),
    taskSuccess: "PASS",
    ...overrides,
  };
}

/** Cheap is well-sampled below the quality floor; mid is well-sampled above it. */
function midPreferredObservations(): OutcomeObservation[] {
  const cheapFails = Array.from({ length: 8 }, () =>
    obs({ modelId: "cheap", modelVersion: "v1", outcome: "FAIL" })
  );
  const midPasses = Array.from({ length: 50 }, () =>
    obs({ modelId: "mid", modelVersion: "v2", outcome: "PASS" })
  );
  const midFails = Array.from({ length: 10 }, () =>
    obs({ modelId: "mid", modelVersion: "v2", outcome: "FAIL" })
  );
  return [...cheapFails, ...midPasses, ...midFails];
}

function reportInput(
  episodes: readonly FrozenR1ShadowEpisode[],
  observations: readonly OutcomeObservation[] = [],
  extra: { claims?: readonly string[] } = {}
) {
  return {
    episodes,
    models: MODELS,
    r0Config: R0,
    featureVersion: FEATURE,
    nowMs: NOW_MS,
    observations,
    ...extra,
  };
}

const LIVE_PLANE = [
  "src/cli/main.ts",
  "src/run/coordinator.ts",
  "src/run/flowchart-run.ts",
  "src/run/supervisor.ts",
  "src/supervisor/flowchart-supervisor.ts",
  "src/supervisor/model-router.ts",
  "src/routing/assign.ts",
];

describe("offline R1 shadow report", () => {
  it("uses routeR0 as baseline and non-exploratory routeR1 as candidate without invoking", () => {
    const episode = frozen({ episodeHash: "e1", taskSuccess: "PASS" });
    const observations = [obs({ outcome: "PASS" }), obs({ outcome: "PASS" })];
    const result = buildR1ShadowReport(reportInput([episode], observations));
    const r0 = routeR0(R0, MODELS, episode.request);
    const r1 = routeR1({
      r0,
      role: episode.role,
      featureVersion: FEATURE,
      models: MODELS,
      observations,
      nowMs: NOW_MS,
    });

    assert.equal(result.pairs.length, 1);
    const pair = result.pairs[0];
    assert.ok(pair !== undefined);
    assert.equal(pair.episodeHash, "e1");
    assert.equal(pair.taskFamily, "bugfix");
    assert.equal(pair.r0ModelId, r0.selection);
    assert.equal(pair.r1ModelId, r1.selection);
    assert.equal(pair.r1Fallback, r1.fallback);
    assert.equal(pair.invoked, false);
    assert.equal(r0.exploratory, false);
    assert.equal(r1.exploratory, false);
  });

  it("marks the comparison as simulation that cannot close production Checkpoint F", () => {
    const result = buildR1ShadowReport(
      reportInput([frozen({ episodeHash: "e1", taskSuccess: "PASS" })])
    );
    assert.equal(result.comparison.evidenceClass, "simulation");
    assert.equal(result.comparison.canCloseProductionCheckpointF, false);
  });

  it("keeps claims empty or 仿真证据 and strips improve/better/outperform", () => {
    const episodes = [frozen({ episodeHash: "e1", taskSuccess: "PASS" })];
    const plain = buildR1ShadowReport(reportInput(episodes));
    assert.ok(
      plain.comparison.claims.length === 0 ||
        plain.comparison.claims.every((claim) => claim === "仿真证据"),
      `unexpected claims: ${plain.comparison.claims.join("; ")}`
    );
    assert.ok(!plain.comparison.claims.some((claim) => IMPROVE.test(claim)));

    const simulationConfig = {
      minPairedSamples: 5,
      maxCostIncreaseUsd: 0,
      supportedReportVersion: 1,
      evidenceClass: "simulation" as const,
    };
    const validation = validateComparisonReport(plain.comparison, simulationConfig);
    assert.equal(validation.valid, true, validation.reasons.join("; "));

    const stripped = buildR1ShadowReport(
      reportInput(episodes, [], {
        claims: ["adaptive is better", "仿真证据", "candidate improves quality"],
      })
    );
    assert.ok(!stripped.comparison.claims.some((claim) => IMPROVE.test(claim)));
    assert.ok(
      stripped.comparison.claims.length === 0 || stripped.comparison.claims.includes("仿真证据")
    );
    assert.equal(validateComparisonReport(stripped.comparison, simulationConfig).valid, true);

    const spoofed = {
      ...plain.comparison,
      claims: ["candidate outperforms baseline", "adaptive is better"],
    };
    const spoofedValidation = validateComparisonReport(spoofed, simulationConfig);
    assert.equal(spoofedValidation.valid, false);
    assert.ok(spoofedValidation.reasons.some((reason) => /improve|outperform|better|provisional|exclude zero/i.test(reason)));
  });

  it("uses recorded PASS/FAIL for both arms so utilityDelta is 0 while R1 cost can differ", () => {
    const observations = midPreferredObservations();
    const episodes = [
      frozen({ episodeHash: "pass-1", taskSuccess: "PASS" }),
      frozen({ episodeHash: "fail-1", taskSuccess: "FAIL" }),
    ];
    const r0 = routeR0(R0, MODELS, episodes[0]!.request);
    const r1 = routeR1({
      r0,
      role: "engineer",
      featureVersion: FEATURE,
      models: MODELS,
      observations,
      nowMs: NOW_MS,
    });
    assert.equal(r0.selection, "cheap");
    assert.equal(r1.selection, "mid");
    assert.equal(r1.exploratory, false);

    const cheapCost = r0.candidates.find((row) => row.modelId === "cheap")?.estimatedCostUsd;
    const midCost = r0.candidates.find((row) => row.modelId === "mid")?.estimatedCostUsd;
    assert.ok(cheapCost !== undefined && midCost !== undefined);
    assert.ok(midCost > cheapCost);

    const result = buildR1ShadowReport(reportInput(episodes, observations));
    assert.equal(result.observedUtilityOnBothArms, true);
    assert.equal(result.selectionDisagreementCount, 2);
    assert.equal(result.selectionDisagreementRate, 1);
    assert.equal(result.comparison.rawCounts.episodes, 2);
    assert.equal(result.comparison.utilityDelta.mean, 0);
    assert.equal(result.comparison.evaluationCard.baseline.utility, 0.5);
    assert.equal(result.comparison.evaluationCard.candidate.utility, 0.5);
    assert.equal(result.comparison.evaluationCard.baseline.costUsd, cheapCost);
    assert.equal(result.comparison.evaluationCard.candidate.costUsd, midCost);
    assert.equal(result.comparison.costDelta.mean, midCost - cheapCost);
    assert.equal(result.pairs[0]?.r0ModelId, "cheap");
    assert.equal(result.pairs[0]?.r1ModelId, "mid");
    assert.equal(result.pairs[0]?.invoked, false);
  });

  it("does not turn UNOBSERVED episodes into PASS", () => {
    const result = buildR1ShadowReport(
      reportInput([
        frozen({ episodeHash: "pass", taskSuccess: "PASS" }),
        frozen({ episodeHash: "fail", taskSuccess: "FAIL" }),
        frozen({ episodeHash: "unseen", taskSuccess: "UNOBSERVED" }),
      ])
    );
    assert.equal(result.pairs.length, 3);
    assert.equal(result.comparison.rawCounts.episodes, 2);
    assert.equal(result.comparison.evaluationCard.baseline.utility, 0.5);
    assert.equal(result.comparison.evaluationCard.candidate.utility, 0.5);
    assert.notEqual(result.comparison.evaluationCard.baseline.utility, 2 / 3);
  });

  it("fails closed when every frozen episode is UNOBSERVED", () => {
    assert.throws(
      () =>
        buildR1ShadowReport(
          reportInput([frozen({ episodeHash: "unseen", taskSuccess: "UNOBSERVED" })])
        ),
      /PASS or FAIL|paired record/i
    );
  });

  it("keeps R1 non-exploratory on high-risk frozen episodes", () => {
    const episode = frozen({
      episodeHash: "risk-1",
      taskSuccess: "PASS",
      request: request({ highRisk: true }),
    });
    const result = buildR1ShadowReport(reportInput([episode]));
    const r0 = routeR0(R0, MODELS, episode.request);
    const r1 = routeR1({
      r0,
      role: episode.role,
      featureVersion: FEATURE,
      models: MODELS,
      observations: [],
      nowMs: NOW_MS,
    });
    assert.equal(r0.selection, "mid");
    assert.equal(r1.selection, "mid");
    assert.equal(r0.exploratory, false);
    assert.equal(r1.exploratory, false);
    assert.equal(result.pairs[0]?.r0ModelId, "mid");
    assert.equal(result.pairs[0]?.r1ModelId, "mid");
    assert.equal(result.pairs[0]?.invoked, false);
    assert.notEqual(result.pairs[0]?.r0ModelId, "cheap");
  });

  it("live plane files do not import r1-shadow-report", async () => {
    for (const file of LIVE_PLANE) {
      const text = await readFile(file, "utf8");
      assert.doesNotMatch(text, /r1-shadow-report/, `${file} must not import r1-shadow-report`);
      assert.doesNotMatch(text, /routing\/r1/, `${file} must not import R1`);
    }
  });
});
