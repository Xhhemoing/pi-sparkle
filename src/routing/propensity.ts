export interface PropensityLogEntry {
  readonly episodeHash: string;
  readonly modelId: string;
  /** Probability the policy assigned to this action — required for every eligible action. */
  readonly propensity: number;
  readonly observedUtility: number | undefined;
  readonly costUsd: number;
  readonly guardrailBreach: boolean;
}

export interface OverlapDiagnostics {
  readonly totalActions: number;
  readonly eligibleActions: number;
  readonly minPropensity: number;
  readonly maxPropensity: number;
  /** Every eligible action must carry a propensity strictly inside (0, 1]. */
  readonly supportOk: boolean;
  readonly effectiveSampleSize: number;
}

export function computeOverlapDiagnostics(logs: readonly PropensityLogEntry[]): OverlapDiagnostics {
  if (logs.length === 0) {
    return {
      totalActions: 0,
      eligibleActions: 0,
      minPropensity: 0,
      maxPropensity: 0,
      supportOk: false,
      effectiveSampleSize: 0,
    };
  }
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  let sumSquares = 0;
  for (const log of logs) {
    min = Math.min(min, log.propensity);
    max = Math.max(max, log.propensity);
    sum += log.propensity;
    sumSquares += log.propensity * log.propensity;
  }
  const supportOk = min > 0 && max <= 1;
  const effectiveSampleSize = sumSquares > 0 ? (sum * sum) / sumSquares : 0;
  return {
    totalActions: logs.length,
    eligibleActions: logs.length,
    minPropensity: min,
    maxPropensity: max,
    supportOk,
    effectiveSampleSize,
  };
}

export interface CounterfactualReport {
  readonly reportVersion: number;
  readonly candidate: string;
  readonly baseline: string;
  readonly claims: readonly string[];
  readonly diagnostics: OverlapDiagnostics;
}

export interface ReportValidation {
  readonly valid: boolean;
  readonly reasons: readonly string[];
}

export interface ReportValidationConfig {
  readonly minEffectiveSampleSize: number;
  readonly supportedReportVersion: number;
}

export const DEFAULT_REPORT_VALIDATION: ReportValidationConfig = {
  minEffectiveSampleSize: 2,
  supportedReportVersion: 1,
};

const REGRET_PATTERN = /regret/i;

/**
 * Counterfactual comparisons are only admissible with valid propensity
 * support/overlap and a minimum effective sample size. Regret claims without
 * those diagnostics are rejected outright.
 */
export function validateCounterfactualReport(
  report: CounterfactualReport,
  config: ReportValidationConfig = DEFAULT_REPORT_VALIDATION
): ReportValidation {
  const reasons: string[] = [];
  if (report.reportVersion !== config.supportedReportVersion) {
    reasons.push(`unsupported report version: ${report.reportVersion}`);
  }
  if (!report.diagnostics.supportOk) {
    reasons.push("counterfactual comparison unsupported: propensity support/overlap failed");
  }
  if (report.diagnostics.effectiveSampleSize < config.minEffectiveSampleSize) {
    reasons.push(
      `effective sample size ${report.diagnostics.effectiveSampleSize.toFixed(2)} below minimum ${config.minEffectiveSampleSize}`
    );
  }
  const hasRegretClaim = report.claims.some((claim) => REGRET_PATTERN.test(claim));
  if (hasRegretClaim && reasons.length > 0) {
    reasons.push("regret claim rejected: comparison diagnostics are not valid");
  }
  return { valid: reasons.length === 0, reasons };
}
