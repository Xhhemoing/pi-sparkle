import { DomainValidationError } from "../domain/errors.js";
import { createEvaluationCard, type EvaluationCard } from "./evaluation-card.js";
import {
  computeComparisonReport,
  validateComparisonReport,
  type ComparisonReport,
  type ComparisonReportConfig,
  type PairedEvaluationRecord
} from "./comparison-report.js";

/**
 * Shared offline comparison gating used by the R1 shadow report and the
 * routing-policy replay evaluator. Improvement-flavored claims are stripped
 * and the report recomputed when validation rejects them; a report that still
 * fails validation after stripping fails closed.
 */

const IMPROVEMENT_CLAIM = /improve|outperform|better|regret/i;

export function isImprovementClaim(claim: string): boolean {
  return IMPROVEMENT_CLAIM.test(claim);
}

export function stripImprovementClaims(claims: readonly string[]): readonly string[] {
  return claims.filter((claim) => !isImprovementClaim(claim));
}

/** Evaluation card aggregated from paired records for one difficulty tier. */
export function pairedEvaluationCard(
  records: readonly PairedEvaluationRecord[],
  difficultyTier: string
): EvaluationCard {
  const domains = [...new Set(records.map((record) => record.taskFamily))];
  const baselineUtilities = records.map((record) => record.baselineUtility);
  const candidateUtilities = records.map((record) => record.candidateUtility);
  const baselineCosts = records.map((record) => record.baselineCostUsd);
  const candidateCosts = records.map((record) => record.candidateCostUsd);
  return createEvaluationCard({
    domains,
    difficultyTiers: [difficultyTier],
    metrics: ["utility", "cost"],
    baseline: {
      utility: mean(baselineUtilities),
      costUsd: mean(baselineCosts),
      uncertainty: sampleStandardError(baselineUtilities)
    },
    candidate: {
      utility: mean(candidateUtilities),
      costUsd: mean(candidateCosts),
      uncertainty: sampleStandardError(candidateUtilities)
    },
    guardrailViolations: []
  });
}

export function gatedComparisonReport(input: {
  readonly records: readonly PairedEvaluationRecord[];
  readonly claims: readonly string[];
  readonly config: ComparisonReportConfig;
  readonly difficultyTier: string;
}): ComparisonReport {
  const card = pairedEvaluationCard(input.records, input.difficultyTier);
  const report = computeComparisonReport(input.records, card, input.claims, input.config);
  const validation = validateComparisonReport(report, input.config);
  if (validation.valid) {
    return report;
  }
  const stripped = stripImprovementClaims(report.claims);
  const retry = computeComparisonReport(input.records, card, stripped, input.config);
  const retryValidation = validateComparisonReport(retry, input.config);
  if (!retryValidation.valid) {
    throw new DomainValidationError(
      `comparison report invalid: ${retryValidation.reasons.join("; ")}`
    );
  }
  return retry;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStandardError(values: readonly number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const average = mean(values);
  let variance = 0;
  for (const value of values) {
    variance += (value - average) * (value - average);
  }
  return Math.sqrt(variance / (values.length - 1)) / Math.sqrt(values.length);
}
