export type EstimatorId = "paired" | "ips" | "snips" | "dr";

export interface PropensityLogEntry {
  readonly episodeHash: string;
  readonly modelId: string;
  /** Behavior policy μ(a). Deterministic live: 1 for selected, 0 for other eligible. */
  readonly behaviorProbability: number;
  /** Target policy π(a). */
  readonly targetProbability: number;
  readonly observedUtility: number | undefined;
  readonly costUsd: number;
  readonly guardrailBreach: boolean;
  /** @deprecated Use behaviorProbability. Kept for old call sites during migration. */
  readonly propensity?: number;
}

export interface OverlapDiagnostics {
  readonly totalActions: number;
  readonly eligibleActions: number;
  readonly minPropensity: number;
  readonly maxPropensity: number;
  /**
   * True when every target-positive action has μ > 0, probabilities are in
   * [0, 1], and no fabricated strictly-positive μ was required.
   */
  readonly supportOk: boolean;
  readonly effectiveSampleSize: number;
  readonly estimatorId: EstimatorId;
  readonly invalidReason?: "INVALID_ESTIMATE" | undefined;
}

function behaviorMu(entry: PropensityLogEntry): number {
  return entry.behaviorProbability;
}

function targetPi(entry: PropensityLogEntry): number {
  return entry.targetProbability;
}

/**
 * Overlap: π(a) > 0 implies μ(a) > 0. ESS uses importance weights w = π/μ
 * on the μ > 0 support (SNIPS-style). Raw propensity squares are not ESS.
 */
export function computeOverlapDiagnostics(
  logs: readonly PropensityLogEntry[],
  estimatorId: EstimatorId = "snips"
): OverlapDiagnostics {
  if (logs.length === 0) {
    return {
      totalActions: 0,
      eligibleActions: 0,
      minPropensity: 0,
      maxPropensity: 0,
      supportOk: false,
      effectiveSampleSize: 0,
      estimatorId,
      invalidReason: "INVALID_ESTIMATE"
    };
  }
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let overlapOk = true;
  const weights: number[] = [];
  for (const log of logs) {
    const mu = behaviorMu(log);
    const pi = targetPi(log);
    min = Math.min(min, mu);
    max = Math.max(max, mu);
    if (mu < 0 || mu > 1 || pi < 0 || pi > 1) overlapOk = false;
    if (pi > 0 && mu <= 0) overlapOk = false;
    if (mu > 0) weights.push(pi / mu);
  }
  const sum = weights.reduce((acc, w) => acc + w, 0);
  const sumSquares = weights.reduce((acc, w) => acc + w * w, 0);
  const effectiveSampleSize = sumSquares > 0 ? (sum * sum) / sumSquares : 0;
  const supportOk = overlapOk;
  return {
    totalActions: logs.length,
    eligibleActions: logs.length,
    minPropensity: min,
    maxPropensity: max,
    supportOk,
    effectiveSampleSize,
    estimatorId,
    ...(supportOk ? {} : { invalidReason: "INVALID_ESTIMATE" as const })
  };
}

export interface CounterfactualReport {
  readonly reportVersion: number;
  readonly candidate: string;
  readonly baseline: string;
  readonly claims: readonly string[];
  readonly diagnostics: OverlapDiagnostics;
  readonly estimatorId?: EstimatorId;
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
  supportedReportVersion: 1
};

const REGRET_PATTERN = /regret/i;

export function validateCounterfactualReport(
  report: CounterfactualReport,
  config: ReportValidationConfig = DEFAULT_REPORT_VALIDATION
): ReportValidation {
  const reasons: string[] = [];
  if (report.reportVersion !== config.supportedReportVersion) {
    reasons.push(`unsupported report version: ${report.reportVersion}`);
  }
  if (!report.diagnostics.supportOk || report.diagnostics.invalidReason === "INVALID_ESTIMATE") {
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

/** Reject logs that set every eligible μ in (0, 1] to fake overlap for a one-hot policy. */
export function isFabricatedPositiveSupport(logs: readonly PropensityLogEntry[]): boolean {
  if (logs.length < 2) return false;
  const allStrictlyPositive = logs.every((row) => behaviorMu(row) > 0 && behaviorMu(row) <= 1);
  const notOneHot = !logs.some((row) => behaviorMu(row) === 1) || logs.filter((row) => behaviorMu(row) === 1).length !== 1;
  return allStrictlyPositive && notOneHot;
}
