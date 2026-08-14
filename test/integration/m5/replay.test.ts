import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createManifest,
  manifestHash,
  validateManifest,
} from "../../../src/experiments/manifest.js";
import type { DatasetManifest } from "../../../src/experiments/manifest.js";
import {
  replayPolicy,
} from "../../../src/experiments/replay.js";
import type { FrozenEpisode, RoutingPolicy } from "../../../src/experiments/replay.js";
import {
  createEvaluationCard,
  validateEvaluationCard,
} from "../../../src/experiments/evaluation-card.js";
import type { RouteRequest } from "../../../src/routing/policy.js";

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

function episode(hash: string): FrozenEpisode {
  return {
    episodeHash: hash,
    request: REQUEST,
    role: "engineer",
    featureVersion: "feat-1",
    originalWorkspace: "/live/workspace",
  };
}

function manifest(overrides: Partial<DatasetManifest> = {}): DatasetManifest {
  return createManifest({
    datasetId: "ds-1",
    episodeHashes: ["h1", "h2", "h3"],
    exclusions: [],
    split: { train: ["h1", "h2"], eval: ["h3"] },
    resourceVersions: { model: "v2", features: "feat-1" },
    environment: { node: "22", os: "linux" },
    seed: 42,
    ...overrides,
  });
}

const UNIFORM_POLICY: RoutingPolicy = {
  policyVersion: "uniform-v1",
  eligibleFor: () => ["cheap", "mid"],
  propensityFor: () => 0.5,
  select: (_episode, rng) => (rng() < 0.5 ? "cheap" : "mid"),
};

describe("M5-T3: dataset manifest", () => {
  it("is deterministic regardless of field order", () => {
    const a = manifest();
    const b = {
      ...a,
      split: { eval: ["h3"], train: ["h1", "h2"] },
      environment: { os: "linux", node: "22" },
    } as DatasetManifest;
    assert.equal(manifestHash(a), manifestHash(b));
  });

  it("rejects overlapping splits", () => {
    assert.throws(
      () => manifest({ split: { train: ["h1", "h2"], eval: ["h2", "h3"] } }),
      /both splits/
    );
  });

  it("rejects exclusions that appear in a split", () => {
    assert.throws(
      () => manifest({ exclusions: ["h1"] }),
      /excluded episode appears in a split/
    );
  });

  it("rejects unknown hashes and non-integer seeds", () => {
    assert.throws(
      () => manifest({ split: { train: ["h9"], eval: [] } }),
      /unknown episode/
    );
    assert.throws(() => manifest({ seed: 1.5 }), /integer/);
    assert.throws(() => validateManifest({ ...manifest(), manifestVersion: 2 as 1 }), /unsupported manifest version/);
  });
});

describe("M5-T3: replay harness", () => {
  it("produces byte-stable reruns from frozen inputs", () => {
    const m = manifest();
    const episodes = m.episodeHashes.map(episode);
    const first = replayPolicy(m, episodes, UNIFORM_POLICY, "/replay/out");
    const second = replayPolicy(m, episodes, UNIFORM_POLICY, "/replay/out");
    assert.equal(first.rerunHash, second.rerunHash);
    assert.deepEqual(first.actions, second.actions);
    assert.equal(first.actions.length, 3);
    assert.equal(first.seed, 42);
  });

  it("logs a propensity for every eligible action on every episode", () => {
    const m = manifest();
    const result = replayPolicy(m, m.episodeHashes.map(episode), UNIFORM_POLICY, "/replay/out");
    for (const action of result.actions) {
      assert.deepEqual(action.eligible, ["cheap", "mid"]);
      assert.equal(action.propensity, 0.5);
      assert.deepEqual(action.propensities, [
        { modelId: "cheap", propensity: 0.5 },
        { modelId: "mid", propensity: 0.5 },
      ]);
    }
  });

  it("a changed seed changes the rerun hash deterministically", () => {
    const m = manifest();
    const episodes = m.episodeHashes.map(episode);
    const a = replayPolicy(m, episodes, UNIFORM_POLICY, "/replay/out");
    const b = replayPolicy({ ...m, seed: 43 }, episodes, UNIFORM_POLICY, "/replay/out");
    assert.notEqual(a.rerunHash, b.rerunHash);
  });

  it("refuses to write into original workspaces or active pointers", () => {
    const m = manifest();
    const episodes = m.episodeHashes.map(episode);
    assert.throws(
      () => replayPolicy(m, episodes, UNIFORM_POLICY, "/live/workspace"),
      /overlaps original workspace/
    );
    assert.throws(
      () => replayPolicy(m, episodes, UNIFORM_POLICY, "/live/workspace/replay-out"),
      /overlaps original workspace/
    );
    assert.doesNotThrow(() => replayPolicy(m, episodes, UNIFORM_POLICY, "/replay/out"));
  });

  it("rejects policies that select outside the eligible set", () => {
    const m = manifest();
    const rogue: RoutingPolicy = {
      policyVersion: "rogue-v1",
      eligibleFor: () => ["cheap"],
      propensityFor: () => 1,
      select: () => "mid",
    };
    assert.throws(
      () => replayPolicy(m, m.episodeHashes.map(episode), rogue, "/replay/out"),
      /outside the eligible set/
    );
  });

  it("rejects manifests referencing missing episodes", () => {
    const m = manifest();
    assert.throws(
      () => replayPolicy(m, [episode("h1")], UNIFORM_POLICY, "/replay/out"),
      /missing episode/
    );
  });
});

describe("M5-T3: evaluation card", () => {
  it("reports baseline, observed utility, uncertainty, cost, and guardrails separately", () => {
    const card = createEvaluationCard({
      domains: ["bugfix", "architecture"],
      difficultyTiers: ["easy", "hard"],
      metrics: ["utility", "cost", "latency"],
      baseline: { utility: 0.7, costUsd: 0.5, uncertainty: 0.05 },
      candidate: { utility: 0.82, costUsd: 0.3, uncertainty: 0.09 },
      guardrailViolations: [],
    });
    assert.equal(card.cardVersion, 1);
    assert.equal(card.baseline.utility, 0.7);
    assert.equal(card.candidate.uncertainty, 0.09);
    assert.deepEqual(card.guardrailViolations, []);
  });

  it("validates version, coverage, and ranges", () => {
    const base = {
      domains: ["bugfix"],
      difficultyTiers: ["easy"],
      metrics: ["utility"],
      baseline: { utility: 0.7, costUsd: 0.5, uncertainty: 0.05 },
      candidate: { utility: 0.8, costUsd: 0.3, uncertainty: 0.09 },
      guardrailViolations: [],
    };
    assert.doesNotThrow(() => createEvaluationCard(base));
    assert.throws(() => createEvaluationCard({ ...base, domains: [] }), /domain coverage/);
    assert.throws(
      () => createEvaluationCard({ ...base, candidate: { utility: 2, costUsd: 0.3, uncertainty: 0.09 } }),
      /out of range/
    );
    assert.throws(() => validateEvaluationCard({ ...createEvaluationCard(base), cardVersion: 9 }), /unsupported/);
  });
});
