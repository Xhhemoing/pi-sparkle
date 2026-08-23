import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateComparisonReport } from "../../../src/experiments/comparison-report.js";
import { createSealedDatasetManifest } from "../../../src/experiments/dataset.js";
import { HoldoutVault } from "../../../src/experiments/holdout.js";
import type { IsoTimestamp } from "../../../src/domain/timestamp.js";
import type { ModelDescriptor } from "../../../src/routing/capability-registry.js";
import type { OutcomeObservation } from "../../../src/routing/outcomes.js";
import { observationsForR1 } from "../../../src/routing/outcomes.js";
import type { RouteRequest } from "../../../src/routing/policy.js";
import { routeR0, type R0Config } from "../../../src/routing/r0.js";
import { routeR1 } from "../../../src/routing/r1.js";
import {
  runSimulationHoldout,
  type SimulationHoldoutEpisode,
} from "../../../src/experiments/simulation-holdout.js";

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
const SIMULATION_CONFIG = {
  minPairedSamples: 5,
  maxCostIncreaseUsd: 0,
  supportedReportVersion: 1,
  evidenceClass: "simulation" as const,
};

const LIVE_PLANE = [
  "src/cli/main.ts",
  "src/run/coordinator.ts",
  "src/run/flowchart-run.ts",
  "src/run/supervisor.ts",
  "src/supervisor/flowchart-supervisor.ts",
  "src/supervisor/model-router.ts",
  "src/routing/assign.ts",
];

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

function episode(
  overrides: Partial<SimulationHoldoutEpisode> & Pick<SimulationHoldoutEpisode, "episodeHash">
): SimulationHoldoutEpisode {
  const taskFamily = overrides.taskFamily ?? overrides.request?.taskFamily ?? "bugfix";
  const observedModelId = overrides.observedModelId ?? "cheap";
  return {
    taskFamily,
    role: "engineer",
    request: request({ taskFamily, ...overrides.request }),
    taskSuccess: "PASS",
    observedModelId,
    observedModelVersion: overrides.observedModelVersion ?? (observedModelId === "mid" ? "v2" : "v1"),
    ...overrides,
  };
}

function observationFromEpisode(ep: SimulationHoldoutEpisode): OutcomeObservation {
  return {
    taskFamily: ep.taskFamily,
    role: ep.role,
    modelId: ep.observedModelId,
    modelVersion: ep.observedModelVersion,
    featureVersion: FEATURE,
    criterion: "taskSuccess",
    outcome: ep.taskSuccess === "FAIL" ? "FAIL" : "PASS",
    occurredAtMs: NOW_MS,
    source: "deterministic-check",
    failureClass: "model",
  };
}

/** Train posterior: cheap well-sampled below floor; mid well-sampled above floor. */
function trainFollowingMid(): SimulationHoldoutEpisode[] {
  const cheapFails = Array.from({ length: 8 }, (_, i) =>
    episode({
      episodeHash: `train-cheap-fail-${i}`,
      observedModelId: "cheap",
      observedModelVersion: "v1",
      taskSuccess: "FAIL",
    })
  );
  const midPasses = Array.from({ length: 50 }, (_, i) =>
    episode({
      episodeHash: `train-mid-pass-${i}`,
      observedModelId: "mid",
      observedModelVersion: "v2",
      taskSuccess: "PASS",
    })
  );
  const midFails = Array.from({ length: 10 }, (_, i) =>
    episode({
      episodeHash: `train-mid-fail-${i}`,
      observedModelId: "mid",
      observedModelVersion: "v2",
      taskSuccess: "FAIL",
    })
  );
  return [...cheapFails, ...midPasses, ...midFails];
}

/**
 * Holdout labels that would reverse the posterior if leaked: cheap looks good,
 * mid is driven below the floor.
 */
function holdoutOppositeLabels(countCheapPass: number, countMidFail: number): SimulationHoldoutEpisode[] {
  const cheapPasses = Array.from({ length: countCheapPass }, (_, i) =>
    episode({
      episodeHash: `hold-cheap-pass-${i}`,
      observedModelId: "cheap",
      observedModelVersion: "v1",
      taskSuccess: "PASS",
    })
  );
  const midFails = Array.from({ length: countMidFail }, (_, i) =>
    episode({
      episodeHash: `hold-mid-fail-${i}`,
      observedModelId: "mid",
      observedModelVersion: "v2",
      taskSuccess: "FAIL",
    })
  );
  return [...cheapPasses, ...midFails];
}

function holdout(input: {
  train: readonly SimulationHoldoutEpisode[];
  holdout: readonly SimulationHoldoutEpisode[];
  claims?: readonly string[];
  vault?: HoldoutVault;
  holdoutDatasetId?: string;
  opeAppendix?: unknown;
}) {
  return runSimulationHoldout({
    train: input.train,
    holdout: input.holdout,
    models: MODELS,
    r0Config: R0,
    featureVersion: FEATURE,
    nowMs: NOW_MS,
    ...(input.claims !== undefined ? { claims: input.claims } : {}),
    ...(input.vault !== undefined ? { vault: input.vault } : {}),
    ...(input.holdoutDatasetId !== undefined ? { holdoutDatasetId: input.holdoutDatasetId } : {}),
    ...(input.opeAppendix !== undefined ? { opeAppendix: input.opeAppendix } : {}),
  });
}

describe("paired simulation holdout runner", () => {
  it("requires an explicit train vs holdout split and does not silently shuffle", () => {
    const train = trainFollowingMid();
    const evalSet = [
      episode({ episodeHash: "h1", taskSuccess: "PASS" }),
      episode({ episodeHash: "h2", taskSuccess: "FAIL" }),
      episode({ episodeHash: "h3", taskSuccess: "PASS" }),
      episode({ episodeHash: "h4", taskSuccess: "PASS" }),
      episode({ episodeHash: "h5", taskSuccess: "PASS" }),
    ];
    assert.throws(
      () =>
        runSimulationHoldout({
          models: MODELS,
          r0Config: R0,
          featureVersion: FEATURE,
          nowMs: NOW_MS,
        } as never),
      /train|holdout|split/i
    );

    const ordered = holdout({ train, holdout: evalSet });
    assert.deepEqual(
      ordered.pairs.map((pair) => pair.episodeHash),
      evalSet.map((row) => row.episodeHash)
    );
    assert.equal(ordered.protocol.trainEpisodeCount, train.length);
    assert.equal(ordered.protocol.holdoutEpisodeCount, evalSet.length);
    assert.equal(ordered.protocol.design, "paired");
  });

  it("splits from a caller-provided manifest without shuffling", () => {
    const train = [
      episode({ episodeHash: "h1", observedModelId: "cheap", taskSuccess: "FAIL" }),
      episode({ episodeHash: "h2", observedModelId: "cheap", taskSuccess: "FAIL" }),
      episode({ episodeHash: "h3", observedModelId: "mid", observedModelVersion: "v2", taskSuccess: "PASS" }),
      episode({ episodeHash: "h4", observedModelId: "mid", observedModelVersion: "v2", taskSuccess: "PASS" }),
      episode({ episodeHash: "h5", observedModelId: "mid", observedModelVersion: "v2", taskSuccess: "PASS" }),
      episode({ episodeHash: "h6", observedModelId: "mid", observedModelVersion: "v2", taskSuccess: "PASS" }),
      episode({ episodeHash: "h7", observedModelId: "mid", observedModelVersion: "v2", taskSuccess: "PASS" }),
      episode({ episodeHash: "h8", observedModelId: "cheap", taskSuccess: "FAIL" }),
    ];
    const holdoutEps = [
      episode({ episodeHash: "h9", taskSuccess: "PASS" }),
      episode({ episodeHash: "h10", taskSuccess: "FAIL" }),
      episode({ episodeHash: "h11", taskSuccess: "PASS" }),
      episode({ episodeHash: "h12", taskSuccess: "PASS" }),
      episode({ episodeHash: "h13", taskSuccess: "PASS" }),
    ];
    const validation = [episode({ episodeHash: "h14", taskSuccess: "PASS" })];
    const episodes = [...train, ...holdoutEps, ...validation];
    const manifest = createSealedDatasetManifest({
      datasetId: "ds-holdout-1",
      episodeHashes: episodes.map((row) => row.episodeHash),
      splits: {
        train: train.map((row) => row.episodeHash),
        validation: ["h14"],
        holdout: holdoutEps.map((row) => row.episodeHash),
      },
      exclusions: [],
      rotation: 0,
      previousHoldout: undefined,
      resourceVersions: { model: "v2", features: FEATURE },
      createdAt: "2026-08-19T00:00:00.000Z" as IsoTimestamp,
    });

    const result = runSimulationHoldout({
      episodes,
      manifest,
      models: MODELS,
      r0Config: R0,
      featureVersion: FEATURE,
      nowMs: NOW_MS,
    });
    assert.deepEqual(
      result.pairs.map((pair) => pair.episodeHash),
      holdoutEps.map((row) => row.episodeHash)
    );
    assert.equal(result.protocol.trainEpisodeCount, train.length);
    assert.equal(result.protocol.holdoutEpisodeCount, holdoutEps.length);
    assert.ok(!result.pairs.some((pair) => pair.episodeHash === "h14"));
  });

  it("updates R1 from train only; holdout labels that would reverse the posterior do not contaminate routing", () => {
    const train = trainFollowingMid();
    const evalSet = holdoutOppositeLabels(40, 80);
    const trainObs = observationsForR1(train.map(observationFromEpisode));
    const leakedObs = observationsForR1([...train, ...evalSet].map(observationFromEpisode));
    const sample = evalSet[0]!;
    const r0 = routeR0(R0, MODELS, sample.request);
    const r1Train = routeR1({
      r0,
      role: sample.role,
      featureVersion: FEATURE,
      models: MODELS,
      observations: trainObs,
      nowMs: NOW_MS,
    });
    const r1Leaked = routeR1({
      r0,
      role: sample.role,
      featureVersion: FEATURE,
      models: MODELS,
      observations: leakedObs,
      nowMs: NOW_MS,
    });
    assert.equal(r0.selection, "cheap");
    assert.equal(r1Train.selection, "mid");
    assert.equal(r1Leaked.selection, "cheap");

    const result = holdout({ train, holdout: evalSet });
    assert.ok(result.pairs.length > 0);
    for (const pair of result.pairs) {
      assert.equal(pair.r0ModelId, "cheap");
      assert.equal(pair.r1ModelId, "mid");
      assert.equal(pair.invoked, false);
    }
  });

  it("evaluates holdout as paired R0 vs non-exploratory R1 with invoked false", () => {
    const train = trainFollowingMid();
    const evalSet = [
      episode({ episodeHash: "h1", taskSuccess: "PASS" }),
      episode({ episodeHash: "h2", taskSuccess: "FAIL" }),
      episode({ episodeHash: "h3", taskSuccess: "PASS" }),
      episode({ episodeHash: "h4", taskSuccess: "PASS" }),
      episode({ episodeHash: "h5", taskSuccess: "PASS" }),
    ];
    const result = holdout({ train, holdout: evalSet });
    assert.equal(result.pairs.length, 5);
    for (const pair of result.pairs) {
      assert.equal(pair.invoked, false);
      assert.ok(pair.r0ModelId === "cheap" || pair.r0ModelId === "mid");
      assert.ok(pair.r1ModelId === "cheap" || pair.r1ModelId === "mid");
    }
    assert.equal(result.comparison.utilityDelta.mean, 0);
    assert.equal(result.protocol.design, "paired");
    assert.equal(result.protocol.minPairedSamples, 5);
  });

  it("surfaces why the utility delta is zero and how often the arms disagree", () => {
    const train = trainFollowingMid();
    const evalSet = holdoutOppositeLabels(15, 15);
    const result = holdout({ train, holdout: evalSet });

    // A zero utility delta here is structural, not a measured tie. The flag
    // must reach the caller alongside the delta, or F-SIM output reads as
    // "no difference" when it is really "no counterfactual outcome".
    assert.equal(result.observedUtilityOnBothArms, true);
    assert.equal(result.comparison.utilityDelta.mean, 0);

    const disagreements = result.pairs.filter((pair) => pair.r0ModelId !== pair.r1ModelId).length;
    assert.equal(result.selectionDisagreementCount, disagreements);
    assert.equal(result.selectionDisagreementRate, disagreements / result.pairs.length);
    assert.ok(disagreements > 0, "train posterior should move R1 off the R0 choice");
  });

  it("marks evidenceClass simulation and cannot close production Checkpoint F", () => {
    const result = holdout({
      train: trainFollowingMid(),
      holdout: [
        episode({ episodeHash: "h1", taskSuccess: "PASS" }),
        episode({ episodeHash: "h2", taskSuccess: "FAIL" }),
      ],
    });
    assert.equal(result.comparison.evidenceClass, "simulation");
    assert.equal(result.comparison.canCloseProductionCheckpointF, false);
    assert.equal(result.protocol.evidenceClass, "simulation");
    assert.equal(result.protocol.canCloseProductionCheckpointF, false);
  });

  it("is non-provisional at n>=5 holdout pairs and provisional below that gate", () => {
    const train = trainFollowingMid();
    const five = Array.from({ length: 5 }, (_, i) =>
      episode({ episodeHash: `ok-${i}`, taskSuccess: i === 1 ? "FAIL" : "PASS" })
    );
    const four = five.slice(0, 4);
    const enough = holdout({ train, holdout: five });
    const short = holdout({ train, holdout: four });
    assert.equal(enough.comparison.utilityDelta.count, 5);
    assert.equal(enough.comparison.utilityDelta.provisional, false);
    assert.equal(enough.comparison.costDelta.provisional, false);
    assert.equal(short.comparison.utilityDelta.count, 4);
    assert.equal(short.comparison.utilityDelta.provisional, true);
  });

  it("reports familyBreakdown and does not claim a tiny family is better", () => {
    const train = trainFollowingMid();
    const evalSet = [
      episode({ episodeHash: "bf-1", taskFamily: "bugfix", taskSuccess: "PASS" }),
      episode({ episodeHash: "bf-2", taskFamily: "bugfix", taskSuccess: "PASS" }),
      episode({ episodeHash: "bf-3", taskFamily: "bugfix", taskSuccess: "FAIL" }),
      episode({ episodeHash: "bf-4", taskFamily: "bugfix", taskSuccess: "PASS" }),
      episode({ episodeHash: "docs-1", taskFamily: "docs", taskSuccess: "PASS" }),
    ];
    const result = holdout({
      train,
      holdout: evalSet,
      claims: ["docs family is better", "仿真证据"],
    });
    assert.ok(result.comparison.familyBreakdown.length >= 2);
    const docs = result.comparison.familyBreakdown.find((row) => row.taskFamily === "docs");
    const bugfix = result.comparison.familyBreakdown.find((row) => row.taskFamily === "bugfix");
    assert.equal(docs?.count, 1);
    assert.equal(bugfix?.count, 4);
    assert.ok(!result.comparison.claims.some((claim) => /docs/i.test(claim) && IMPROVE.test(claim)));
    assert.ok(!result.comparison.claims.some((claim) => IMPROVE.test(claim)));
  });

  it("rejects improvement-flavored claims under honest shared labels or a positive cost CI upper bound", () => {
    const train = trainFollowingMid();
    const evalSet = Array.from({ length: 5 }, (_, i) =>
      episode({ episodeHash: `h-${i}`, taskSuccess: "PASS" })
    );
    const result = holdout({ train, holdout: evalSet });
    const utilityCi = result.comparison.utilityDelta.confidenceInterval;
    assert.ok(utilityCi !== undefined);
    assert.ok(utilityCi.lower <= 0, "honest shared PASS/FAIL labels keep utility CI from being strictly positive");
    const costCi = result.comparison.costDelta.confidenceInterval;
    assert.ok(costCi !== undefined);
    assert.ok(costCi.upper > 0, "R1 picking a costlier eligible model leaves cost CI upper > 0");

    const spoofed = {
      ...result.comparison,
      claims: ["adaptive is better", "candidate improves quality"],
    };
    const validation = validateComparisonReport(spoofed, SIMULATION_CONFIG);
    assert.equal(validation.valid, false);
    assert.ok(
      validation.reasons.some((reason) => /utility delta confidence interval/i.test(reason)),
      validation.reasons.join("; ")
    );
    assert.ok(
      validation.reasons.some((reason) => /cost delta confidence interval/i.test(reason)),
      validation.reasons.join("; ")
    );
  });

  it("defaults copy to 仿真证据 and keeps OPE out of main claims", () => {
    const result = holdout({
      train: trainFollowingMid(),
      holdout: Array.from({ length: 5 }, (_, i) =>
        episode({ episodeHash: `h-${i}`, taskSuccess: "PASS" })
      ),
      opeAppendix: { estimate: 0.9, claims: ["OPE outperforms baseline"] },
    });
    assert.ok(
      result.comparison.claims.length === 0 ||
        result.comparison.claims.every((claim) => claim === "仿真证据"),
      `unexpected claims: ${result.comparison.claims.join("; ")}`
    );
    assert.ok(!result.comparison.claims.some((claim) => IMPROVE.test(claim)));
    const validation = validateComparisonReport(result.comparison, SIMULATION_CONFIG);
    assert.equal(validation.valid, true, validation.reasons.join("; "));
    assert.ok(result.opeAppendix !== undefined);
    assert.notEqual(result.comparison.claims, result.opeAppendix);
    const appendix = result.opeAppendix as { validImprovementEstimate?: boolean; invalidReason?: string };
    assert.equal(appendix.validImprovementEstimate, false);
    assert.equal(appendix.invalidReason, "INVALID_ESTIMATE");
  });

  it("audits HoldoutVault access, rejects sealed holdouts, and does not register results as open holdout", () => {
    const train = trainFollowingMid();
    const evalSet = Array.from({ length: 5 }, (_, i) =>
      episode({ episodeHash: `h-${i}`, taskSuccess: "PASS" })
    );
    const vault = new HoldoutVault({
      now: () => "2026-08-19T00:00:00.000Z" as IsoTimestamp,
      generateId: () => "ha_holdout",
    });
    vault.register("ds-sim-1");
    const result = holdout({
      train,
      holdout: evalSet,
      vault,
      holdoutDatasetId: "ds-sim-1",
    });
    const state = vault.state("ds-sim-1");
    assert.equal(state.status, "open");
    assert.ok(state.audit.length >= 1);
    assert.ok(state.audit.some((entry) => entry.purpose.length > 0));
    assert.ok(result.holdoutAudit !== undefined);
    assert.equal(result.holdoutAudit?.length, state.audit.length);
    assert.throws(() => vault.state("simulation-holdout-report"), /unregistered/);
    assert.throws(() => vault.state("comparison-report"), /unregistered/);

    const sealed = new HoldoutVault();
    sealed.register("ds-sealed");
    sealed.seal("ds-sealed", "compromised for test");
    assert.throws(
      () =>
        holdout({
          train,
          holdout: evalSet,
          vault: sealed,
          holdoutDatasetId: "ds-sealed",
        }),
      /sealed/
    );
  });

  it("live plane files do not import simulation-holdout", async () => {
    for (const file of LIVE_PLANE) {
      const text = await readFile(file, "utf8");
      assert.doesNotMatch(text, /simulation-holdout/, `${file} must not import simulation-holdout`);
      assert.doesNotMatch(text, /routing\/r1/, `${file} must not import R1`);
    }
  });
});
