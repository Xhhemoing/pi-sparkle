import { DomainValidationError } from "../domain/errors.js";
import type { EvaluationCard } from "./evaluation-card.js";

/**
 * One sealed episode evaluated under both arms in a paired isolated
 * evaluation. The baseline arm is the static policy (R0); the candidate arm
 * is the adaptive policy under test.
 */
export interface PairedEvaluationRecord {
  readonly episodeHash: string;
  readonly taskFamily: string;
  readonly baselineUtility: number;
  readonly candidateUtility: number;
  readonly baselineCostUsd: number;
  readonly candidateCostUsd: number;
}

export interface ConfidenceInterval {
  readonly lower: number;
  readonly upper: number;
  /** Coverage level, e.g. 0.95. */
  readonly level: number;
}

export interface PairedDeltaSummary {
  readonly count: number;
  readonly mean: number;
  /** Standard error of the paired delta (sample stddev / sqrt(count)). */
  readonly standardError: number;
  /** Normal-approximation CI; undefined when fewer than two paired samples. */
  readonly confidenceInterval: ConfidenceInterval | undefined;
  /**
   * True when the paired sample is below `minPairedSamples`. Provisional
   * reports record the evidence but cannot justify improvement/promotion
   * claims.
   */
  readonly provisional: boolean;
}

export interface TaskFamilyBreakdown {
  readonly taskFamily: string;
  readonly count: number;
  readonly utilityDeltaMean: number;
  readonly costDeltaMean: number;
}

export interface ComparisonReport {
  readonly reportVersion: 1;
  /** The versioned evaluation card the comparison was declared against. */
  readonly evaluationCard: EvaluationCard;
  readonly rawCounts: {
    readonly episodes: number;
    readonly baseline: number;
    readonly candidate: number;
  };
  readonly utilityDelta: PairedDeltaSummary;
  readonly costDelta: PairedDeltaSummary;
  /** One row per task family present in the records, first-seen order. */
  readonly familyBreakdown: readonly TaskFamilyBreakdown[];
  readonly claims: readonly string[];
}

export interface ComparisonReportConfig {
  readonly minPairedSamples: number;
  /**
   * The approved cost-quality tolerance for improvement claims: a candidate
   * that claims improvement may not increase mean cost by more than this.
   * Default 0 (no cost increase) until a target is explicitly approved.
   */
  readonly maxCostIncreaseUsd: number;
  readonly supportedReportVersion: number;
}

export const DEFAULT_COMPARISON_REPORT_CONFIG: ComparisonReportConfig = {
  minPairedSamples: 5,
  maxCostIncreaseUsd: 0,
  supportedReportVersion: 1,
};

export interface ComparisonReportValidation {
  readonly valid: boolean;
  readonly reasons: readonly string[];
}

/** z-score for a two-sided 95% confidence interval. */
const Z_95 = 1.959963985;
const EPSILON = 1e-9;

const IMPROVEMENT_PATTERN = /improve|outperform|better|regret/i;

function assertFiniteRange(value: number, name: string, min: number, max: number): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new DomainValidationError(`${name} out of range [${min}, ${max}]: ${value}`);
  }
}

function pairedDeltaSummary(
  deltas: readonly number[],
  minPairedSamples: number
): PairedDeltaSummary {
  const count = deltas.length;
  if (count === 0) {
    throw new DomainValidationError("comparison report requires at least one paired record");
  }
  const mean = deltas.reduce((sum, value) => sum + value, 0) / count;
  let variance = 0;
  for (const delta of deltas) {
    variance += (delta - mean) * (delta - mean);
  }
  const standardError = count >= 2 ? Math.sqrt(variance / (count - 1)) / Math.sqrt(count) : 0;
  const confidenceInterval =
    count >= 2
      ? {
          lower: mean - Z_95 * standardError,
          upper: mean + Z_95 * standardError,
          level: 0.95,
        }
      : undefined;
  return {
    count,
    mean,
    standardError,
    confidenceInterval,
    provisional: count < minPairedSamples,
  };
}

/**
 * Build a versioned paired-comparison report: confidence intervals, raw
 * counts, and a task-family breakdown, cross-checked against the declared
 * evaluation card. Fails closed when the card aggregates disagree with the
 * records, so a card can never be fabricated independently of its evidence.
 */
export function computeComparisonReport(
  records: readonly PairedEvaluationRecord[],
  evaluationCard: EvaluationCard,
  claims: readonly string[],
  config: ComparisonReportConfig = DEFAULT_COMPARISON_REPORT_CONFIG
): ComparisonReport {
  if (records.length === 0) {
    throw new DomainValidationError("comparison report requires at least one paired record");
  }
  for (const record of records) {
    if (record.episodeHash.trim() === "" || record.taskFamily.trim() === "") {
      throw new DomainValidationError("paired record requires episodeHash and taskFamily");
    }
    assertFiniteRange(record.baselineUtility, "baselineUtility", -1, 1);
    assertFiniteRange(record.candidateUtility, "candidateUtility", -1, 1);
    assertFiniteRange(record.baselineCostUsd, "baselineCostUsd", 0, Number.MAX_VALUE);
    assertFiniteRange(record.candidateCostUsd, "candidateCostUsd", 0, Number.MAX_VALUE);
  }

  const utilityDeltas: number[] = [];
  const costDeltas: number[] = [];
  const families = new Map<string, { utilitySum: number; costSum: number; count: number }>();
  for (const record of records) {
    utilityDeltas.push(record.candidateUtility - record.baselineUtility);
    costDeltas.push(record.candidateCostUsd - record.baselineCostUsd);
    const family = families.get(record.taskFamily) ?? { utilitySum: 0, costSum: 0, count: 0 };
    family.utilitySum += record.candidateUtility - record.baselineUtility;
    family.costSum += record.candidateCostUsd - record.baselineCostUsd;
    family.count += 1;
    families.set(record.taskFamily, family);
  }

  const baselineUtilityMean =
    records.reduce((sum, record) => sum + record.baselineUtility, 0) / records.length;
  const candidateUtilityMean =
    records.reduce((sum, record) => sum + record.candidateUtility, 0) / records.length;
  const baselineCostMean =
    records.reduce((sum, record) => sum + record.baselineCostUsd, 0) / records.length;
  const candidateCostMean =
    records.reduce((sum, record) => sum + record.candidateCostUsd, 0) / records.length;

  if (Math.abs(baselineUtilityMean - evaluationCard.baseline.utility) > EPSILON) {
    throw new DomainValidationError(
      `evaluation card baseline utility ${evaluationCard.baseline.utility} disagrees with records (${baselineUtilityMean})`
    );
  }
  if (Math.abs(candidateUtilityMean - evaluationCard.candidate.utility) > EPSILON) {
    throw new DomainValidationError(
      `evaluation card candidate utility ${evaluationCard.candidate.utility} disagrees with records (${candidateUtilityMean})`
    );
  }
  if (Math.abs(baselineCostMean - evaluationCard.baseline.costUsd) > EPSILON) {
    throw new DomainValidationError(
      `evaluation card baseline cost ${evaluationCard.baseline.costUsd} disagrees with records (${baselineCostMean})`
    );
  }
  if (Math.abs(candidateCostMean - evaluationCard.candidate.costUsd) > EPSILON) {
    throw new DomainValidationError(
      `evaluation card candidate cost ${evaluationCard.candidate.costUsd} disagrees with records (${candidateCostMean})`
    );
  }

  const familyBreakdown: TaskFamilyBreakdown[] = [];
  for (const [taskFamily, family] of Array.from(families.entries())) {
    familyBreakdown.push({
      taskFamily,
      count: family.count,
      utilityDeltaMean: family.utilitySum / family.count,
      costDeltaMean: family.costSum / family.count,
    });
  }

  return {
    reportVersion: 1,
    evaluationCard,
    rawCounts: {
      episodes: records.length,
      baseline: records.length,
      candidate: records.length,
    },
    utilityDelta: pairedDeltaSummary(utilityDeltas, config.minPairedSamples),
    costDelta: pairedDeltaSummary(costDeltas, config.minPairedSamples),
    familyBreakdown,
    claims,
  };
}

/**
 * Gate the report's claims. Improvement-flavored claims (improved /
 * outperforms / better / regret) are only valid when the paired samples are
 * non-provisional, the utility delta confidence interval excludes zero on the
 * positive side, and the cost delta stays within the approved tolerance.
 */
export function validateComparisonReport(
  report: ComparisonReport,
  config: ComparisonReportConfig = DEFAULT_COMPARISON_REPORT_CONFIG
): ComparisonReportValidation {
  const reasons: string[] = [];
  if (report.reportVersion !== config.supportedReportVersion) {
    reasons.push(`unsupported report version: ${report.reportVersion}`);
  }

  const { rawCounts } = report;
  if (
    rawCounts.episodes !== report.utilityDelta.count ||
    rawCounts.episodes !== report.costDelta.count ||
    rawCounts.baseline !== rawCounts.episodes ||
    rawCounts.candidate !== rawCounts.episodes
  ) {
    reasons.push("raw counts disagree with the paired delta sample sizes");
  }

  const breakdownTotal = report.familyBreakdown.reduce(
    (sum, family) => sum + family.count,
    0
  );
  if (breakdownTotal !== report.utilityDelta.count) {
    reasons.push(
      `task-family breakdown covers ${breakdownTotal} records but the report holds ${report.utilityDelta.count}`
    );
  }
  if (new Set(report.familyBreakdown.map((family) => family.taskFamily)).size !== report.familyBreakdown.length) {
    reasons.push("task-family breakdown contains duplicate families");
  }

  const hasImprovementClaim = report.claims.some((claim) => IMPROVEMENT_PATTERN.test(claim));
  if (hasImprovementClaim) {
    if (report.utilityDelta.provisional || report.costDelta.provisional) {
      reasons.push(
        `improvement claim rejected: paired sample is provisional (below ${config.minPairedSamples})`
      );
    }
    const utilityCi = report.utilityDelta.confidenceInterval;
    if (utilityCi === undefined || utilityCi.lower <= 0) {
      reasons.push(
        "improvement claim rejected: utility delta confidence interval does not exclude zero on the positive side"
      );
    }
    const costCi = report.costDelta.confidenceInterval;
    if (costCi !== undefined && costCi.upper > config.maxCostIncreaseUsd) {
      reasons.push(
        `improvement claim rejected: cost delta confidence interval upper bound ${costCi.upper} exceeds the approved cost tolerance ${config.maxCostIncreaseUsd}`
      );
    }
  }

  return { valid: reasons.length === 0, reasons };
}
