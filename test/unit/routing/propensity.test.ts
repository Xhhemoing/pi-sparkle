import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeOverlapDiagnostics,
  isFabricatedPositiveSupport,
  validateCounterfactualReport,
} from "../../../src/routing/propensity.js";
import type {
  CounterfactualReport,
  PropensityLogEntry,
} from "../../../src/routing/propensity.js";

function log(behaviorProbability: number, targetProbability: number): PropensityLogEntry {
  return {
    episodeHash: "h1",
    modelId: "m",
    behaviorProbability,
    targetProbability,
    observedUtility: undefined,
    costUsd: 0,
    guardrailBreach: false,
  };
}

function report(overrides: Partial<CounterfactualReport> = {}): CounterfactualReport {
  return {
    reportVersion: 1,
    candidate: "r1",
    baseline: "r0",
    claims: [],
    diagnostics: computeOverlapDiagnostics([log(0.5, 0.5), log(0.5, 0.5), log(0.5, 0.5), log(0.5, 0.5)]),
    ...overrides,
  };
}

describe("M5-T3: propensity ledger", () => {
  it("computes ESS from importance weights, not raw propensity squares", () => {
    const diagnostics = computeOverlapDiagnostics([log(0.5, 0.5), log(0.5, 0.5), log(0.5, 0.5), log(0.5, 0.5)]);
    assert.equal(diagnostics.supportOk, true);
    assert.equal(diagnostics.estimatorId, "snips");
    assert.equal(diagnostics.effectiveSampleSize, 4);
  });

  it("one-hot live overlap fails when the target puts mass on an unselected arm", () => {
    const diagnostics = computeOverlapDiagnostics([log(1, 0), log(0, 1)]);
    assert.equal(diagnostics.supportOk, false);
    assert.equal(diagnostics.invalidReason, "INVALID_ESTIMATE");
  });

  it("one-hot live with matching target is valid support", () => {
    const diagnostics = computeOverlapDiagnostics([log(1, 1), log(0, 0)]);
    assert.equal(diagnostics.supportOk, true);
    assert.equal(diagnostics.minPropensity, 0);
  });

  it("propensities above 1 are invalid", () => {
    const diagnostics = computeOverlapDiagnostics([log(1.5, 1.5)]);
    assert.equal(diagnostics.supportOk, false);
  });

  it("empty logs report no support", () => {
    const diagnostics = computeOverlapDiagnostics([]);
    assert.equal(diagnostics.supportOk, false);
    assert.equal(diagnostics.totalActions, 0);
  });

  it("rejects fabricated strictly-positive support for a deterministic policy", () => {
    const logs = [log(0.5, 0.5), log(0.5, 0.5)];
    assert.equal(isFabricatedPositiveSupport(logs), true);
  });

  it("effective sample size never exceeds the action count", () => {
    const diagnostics = computeOverlapDiagnostics([
      log(0.1, 0.1),
      log(0.9, 0.9),
      log(0.25, 0.25),
      log(0.75, 0.75),
    ]);
    assert.ok(diagnostics.effectiveSampleSize > 0);
    assert.ok(diagnostics.effectiveSampleSize <= diagnostics.totalActions);
  });

  it("accepts a well-supported comparison report", () => {
    const validation = validateCounterfactualReport(report());
    assert.equal(validation.valid, true);
    assert.deepEqual(validation.reasons, []);
  });

  it("rejects reports whose propensity support failed", () => {
    const validation = validateCounterfactualReport(
      report({ diagnostics: computeOverlapDiagnostics([log(1, 0), log(0, 1)]) })
    );
    assert.equal(validation.valid, false);
    assert.ok(validation.reasons.some((r) => /support\/overlap/.test(r)));
  });

  it("rejects reports with insufficient effective sample size", () => {
    const validation = validateCounterfactualReport(
      report({ diagnostics: computeOverlapDiagnostics([log(1, 1)]) })
    );
    assert.equal(validation.valid, false);
    assert.ok(validation.reasons.some((r) => /effective sample size/.test(r)));
  });

  it("rejects counterfactual regret claims without valid diagnostics", () => {
    const unsupported = report({
      claims: ["candidate achieves 30% lower regret than baseline"],
      diagnostics: computeOverlapDiagnostics([log(1, 0), log(0, 1)]),
    });
    const validation = validateCounterfactualReport(unsupported);
    assert.equal(validation.valid, false);
    assert.ok(validation.reasons.some((r) => /regret claim rejected/.test(r)));

    const supported = report({
      claims: ["candidate achieves 30% lower regret than baseline"],
    });
    assert.equal(validateCounterfactualReport(supported).valid, true);
  });

  it("rejects unsupported report versions", () => {
    const validation = validateCounterfactualReport(report({ reportVersion: 99 }));
    assert.equal(validation.valid, false);
    assert.ok(validation.reasons.some((r) => /unsupported report version/.test(r)));
  });
});
