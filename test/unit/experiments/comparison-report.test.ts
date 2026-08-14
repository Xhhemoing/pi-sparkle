import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeComparisonReport,
  validateComparisonReport,
  DEFAULT_COMPARISON_REPORT_CONFIG,
} from "../../../src/experiments/comparison-report.js";
import type {
  ComparisonReport,
  PairedEvaluationRecord,
} from "../../../src/experiments/comparison-report.js";
import { createEvaluationCard } from "../../../src/experiments/evaluation-card.js";
import type { EvaluationCard } from "../../../src/experiments/evaluation-card.js";

const CARD_BASE = {
  domains: ["bugfix", "docs"],
  difficultyTiers: ["easy", "hard"],
  metrics: ["utility", "cost"],
  baseline: { utility: 0.3, costUsd: 0.1, uncertainty: 0.02 },
  candidate: { utility: 0.6, costUsd: 0.1, uncertainty: 0.03 },
  guardrailViolations: [],
};

/** Utility deltas 0.1..0.5, cost deltas all 0 — candidate strictly better. */
function improvingRecords(): PairedEvaluationRecord[] {
  const rows: Array<[string, string, number]> = [
    ["h1", "bugfix", 0.4],
    ["h2", "bugfix", 0.5],
    ["h3", "bugfix", 0.6],
    ["h4", "docs", 0.7],
    ["h5", "docs", 0.8],
  ];
  return rows.map(([episodeHash, taskFamily, candidateUtility]) => ({
    episodeHash,
    taskFamily,
    baselineUtility: 0.3,
    candidateUtility,
    baselineCostUsd: 0.1,
    candidateCostUsd: 0.1,
  }));
}

function card(overrides: Partial<EvaluationCard> = {}): EvaluationCard {
  return createEvaluationCard({ ...CARD_BASE, ...overrides });
}

describe("Checkpoint F-2: paired comparison report", () => {
  it("computes a normal-approximation CI on the paired utility delta", () => {
    const report = computeComparisonReport(improvingRecords(), card(), []);
    assert.equal(report.utilityDelta.count, 5);
    assert.equal(report.utilityDelta.mean, 0.3);
    assert.equal(report.utilityDelta.provisional, false);
    const ci = report.utilityDelta.confidenceInterval;
    assert.ok(ci !== undefined);
    assert.equal(ci.level, 0.95);
    assert.ok(Math.abs(ci.lower - 0.1614095563) < 1e-6, `lower=${ci.lower}`);
    assert.ok(Math.abs(ci.upper - 0.4385904437) < 1e-6, `upper=${ci.upper}`);
    assert.ok(ci.lower > 0, "utility delta CI excludes zero on the positive side");
  });

  it("reports raw counts for episodes and both arms", () => {
    const report = computeComparisonReport(improvingRecords(), card(), []);
    assert.deepEqual(report.rawCounts, { episodes: 5, baseline: 5, candidate: 5 });
  });

  it("breaks the deltas down per task family in first-seen order", () => {
    const report = computeComparisonReport(improvingRecords(), card(), []);
    assert.equal(report.familyBreakdown.length, 2);
    const [bugfix, docs] = report.familyBreakdown;
    assert.equal(bugfix?.taskFamily, "bugfix");
    assert.equal(bugfix?.count, 3);
    assert.ok(Math.abs((bugfix?.utilityDeltaMean ?? 0) - 0.2) < 1e-9);
    assert.equal(bugfix?.costDeltaMean, 0);
    assert.equal(docs?.taskFamily, "docs");
    assert.equal(docs?.count, 2);
    assert.ok(Math.abs((docs?.utilityDeltaMean ?? 0) - 0.45) < 1e-9);
    assert.equal(docs?.costDeltaMean, 0);
  });

  it("is deterministic from the same frozen records and card", () => {
    const records = improvingRecords();
    const a = computeComparisonReport(records, card(), ["candidate improves quality"]);
    const b = computeComparisonReport(records, card(), ["candidate improves quality"]);
    assert.deepEqual(a, b);
  });

  it("approves an improvement claim when CI excludes zero and cost stays within tolerance", () => {
    const report = computeComparisonReport(
      improvingRecords(),
      card(),
      ["candidate improves quality at equal cost"]
    );
    const validation = validateComparisonReport(report);
    assert.deepEqual(validation, { valid: true, reasons: [] });
  });

  it("rejects improvement claims on provisional samples", () => {
    const report = computeComparisonReport(
      improvingRecords().slice(0, 4),
      card({
        baseline: { utility: 0.3, costUsd: 0.1, uncertainty: 0.02 },
        candidate: { utility: (0.4 + 0.5 + 0.6 + 0.7) / 4, costUsd: 0.1, uncertainty: 0.03 },
      }),
      ["candidate improves quality"]
    );
    assert.equal(report.utilityDelta.provisional, true);
    const validation = validateComparisonReport(report);
    assert.equal(validation.valid, false);
    assert.ok(validation.reasons.some((reason) => /provisional/.test(reason)));
  });

  it("rejects improvement claims when the utility CI includes zero", () => {
    const tied = improvingRecords().map((record) => ({
      ...record,
      candidateUtility: record.baselineUtility,
    }));
    const report = computeComparisonReport(
      tied,
      card({
        candidate: { utility: 0.3, costUsd: 0.1, uncertainty: 0.03 },
      }),
      ["candidate outperforms baseline"]
    );
    const validation = validateComparisonReport(report);
    assert.equal(validation.valid, false);
    assert.ok(
      validation.reasons.some((reason) => /does not exclude zero/.test(reason)),
      validation.reasons.join("; ")
    );
  });

  it("rejects improvement claims when cost rises above the approved tolerance", () => {
    const pricier = improvingRecords().map((record) => ({
      ...record,
      candidateCostUsd: 0.3,
    }));
    const report = computeComparisonReport(
      pricier,
      card({
        candidate: { utility: 0.6, costUsd: 0.3, uncertainty: 0.03 },
      }),
      ["candidate improves quality"]
    );
    const validation = validateComparisonReport(report);
    assert.equal(validation.valid, false);
    assert.ok(
      validation.reasons.some((reason) => /cost tolerance/.test(reason)),
      validation.reasons.join("; ")
    );
  });

  it("fails closed when the evaluation card disagrees with the records", () => {
    assert.throws(
      () =>
        computeComparisonReport(
          improvingRecords(),
          card({
            baseline: { utility: 0.31, costUsd: 0.1, uncertainty: 0.02 },
          }),
          []
        ),
      /disagrees with records/
    );
  });

  it("rejects empty record sets and out-of-range utilities", () => {
    assert.throws(() => computeComparisonReport([], card(), []), /at least one paired record/);
    assert.throws(
      () =>
        computeComparisonReport(
          [{ ...improvingRecords()[0]!, candidateUtility: 1.5 }],
          card(),
          []
        ),
      /out of range/
    );
  });

  it("validates raw-count consistency and breakdown coverage on tampered reports", () => {
    const report = computeComparisonReport(improvingRecords(), card(), []);
    const tamperedCounts: ComparisonReport = {
      ...report,
      rawCounts: { episodes: 4, baseline: 4, candidate: 4 },
    };
    assert.ok(
      validateComparisonReport(tamperedCounts).reasons.some((reason) =>
        /raw counts disagree/.test(reason)
      )
    );

    const tamperedCoverage: ComparisonReport = {
      ...report,
      familyBreakdown: report.familyBreakdown.slice(0, 1),
    };
    assert.ok(
      validateComparisonReport(tamperedCoverage).reasons.some((reason) =>
        /covers 3 records/.test(reason)
      )
    );

    const duplicateFamilies: ComparisonReport = {
      ...report,
      familyBreakdown: [report.familyBreakdown[0]!, report.familyBreakdown[0]!],
    };
    assert.ok(
      validateComparisonReport(duplicateFamilies).reasons.some((reason) =>
        /duplicate families/.test(reason)
      )
    );

    const staleVersion: ComparisonReport = { ...report, reportVersion: 9 as 1 };
    assert.ok(
      validateComparisonReport(staleVersion).reasons.some((reason) =>
        /unsupported report version/.test(reason)
      )
    );
  });

  it("honors a raised cost tolerance when explicitly configured", () => {
    const pricier = improvingRecords().map((record) => ({
      ...record,
      candidateCostUsd: 0.3,
    }));
    const report = computeComparisonReport(
      pricier,
      card({
        candidate: { utility: 0.6, costUsd: 0.3, uncertainty: 0.03 },
      }),
      ["candidate improves quality"]
    );
    const validation = validateComparisonReport(report, {
      ...DEFAULT_COMPARISON_REPORT_CONFIG,
      maxCostIncreaseUsd: 0.25,
    });
    assert.equal(validation.valid, true);
  });
});
