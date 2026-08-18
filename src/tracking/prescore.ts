import { DEFAULT_TRACKING_CONFIG, type TrackingConfig } from "./config.js";
import type {
  ConstraintRecord,
  DimensionScore,
  PrescoreResult,
  ToolSituation
} from "./types.js";
import { UNOBSERVED } from "./types.js";

export interface PrescoreInput {
  readonly claims: readonly string[];
  readonly toolSituations: readonly ToolSituation[];
  readonly writePaths: readonly string[];
  readonly ownedPaths: readonly string[];
  readonly requiredChecks: readonly string[];
  readonly completedChecks: readonly string[];
  readonly constraints: readonly ConstraintRecord[];
  readonly retainedConstraintIds: readonly string[];
  readonly progressed: boolean | typeof UNOBSERVED;
  readonly stalledTurns: number;
  readonly independentEvidence: boolean;
  readonly narrative?: "PASS" | "ABSTAIN" | "UNOBSERVED";
  readonly actorSelfScore?: number;
  readonly lightMinorCount?: number;
  readonly config?: TrackingConfig;
}

const SUCCESS_CLAIM = /pass|passed|verified|succeed/i;
const DIMENSION_WEIGHT = 1;

export function computePrescore(input: PrescoreInput): PrescoreResult {
  const config = input.config ?? DEFAULT_TRACKING_CONFIG;
  const dimensions: DimensionScore[] = [
    dimension("evidence-consistency", evidenceOutcome(input), true),
    dimension("scope-safety", scopeOutcome(input), true),
    dimension("check-coverage", coverageOutcome(input), true),
    dimension("constraint-retention", constraintOutcome(input), true),
    dimension("progress-vs-stall", progressOutcome(input), true),
    dimension("narrative-coherence", input.narrative ?? "ABSTAIN", false)
  ];

  let observedWeight = 0;
  let applicableWeight = 0;
  let qualitySum = 0;

  for (const item of dimensions) {
    if (item.id === "narrative-coherence") continue;
    if (item.outcome === "NOT_APPLICABLE") continue;
    applicableWeight += DIMENSION_WEIGHT;
    if (item.outcome === "PASS" || item.outcome === "FAIL") {
      observedWeight += DIMENSION_WEIGHT;
      qualitySum += DIMENSION_WEIGHT * (item.outcome === "PASS" ? 1 : 0);
    }
  }

  const quality = observedWeight === 0 ? 0 : qualitySum / observedWeight;
  const coverage = applicableWeight === 0 ? 0 : observedWeight / applicableWeight;
  let P = quality * coverage;

  const dip = (input.lightMinorCount ?? 0) * config.minorPDip;
  if (dip > 0) {
    P = Math.max(0, P - dip);
  }

  P = Number(P.toFixed(4));

  const cappedByHardFail = dimensions.some((item) => item.hardRelated && item.outcome === "FAIL");
  const displayPrescore = cappedByHardFail ? Math.min(P, config.hardFailCap) : P;

  void input.actorSelfScore;
  void input.independentEvidence;

  return {
    P,
    quality: Number(quality.toFixed(4)),
    coverage: Number(coverage.toFixed(4)),
    dimensions,
    cappedByHardFail,
    displayPrescore: Number(displayPrescore.toFixed(4))
  };
}

function dimension(
  id: DimensionScore["id"],
  outcome: DimensionScore["outcome"],
  hardRelated: boolean
): DimensionScore {
  return {
    id,
    outcome,
    hardRelated,
    ...(outcome === "PASS" || outcome === "FAIL" ? { value: outcome === "PASS" ? 1 : 0 } : {})
  };
}

function evidenceOutcome(input: PrescoreInput): DimensionScore["outcome"] {
  const successClaim = input.claims.some((claim) => SUCCESS_CLAIM.test(claim));
  const failedTool = input.toolSituations.some((tool) => tool.exitCode !== undefined && tool.exitCode !== 0);
  const observedPass = input.toolSituations.some((tool) => tool.exitCode === 0);
  if (successClaim && (failedTool || (!observedPass && input.completedChecks.length === 0))) {
    return "FAIL";
  }
  if (failedTool) return "FAIL";
  if (input.claims.length === 0 && input.toolSituations.length === 0) return "UNOBSERVED";
  return "PASS";
}

function scopeOutcome(input: PrescoreInput): DimensionScore["outcome"] {
  if (input.toolSituations.length === 0 && input.writePaths.length === 0) return "UNOBSERVED";
  if (input.toolSituations.some((tool) => tool.escaped)) return "FAIL";
  for (const path of input.writePaths) {
    if (!input.ownedPaths.includes(path)) return "FAIL";
  }
  return "PASS";
}

function coverageOutcome(input: PrescoreInput): DimensionScore["outcome"] {
  if (input.requiredChecks.length === 0) return "NOT_APPLICABLE";
  if (input.requiredChecks.every((check) => input.completedChecks.includes(check))) return "PASS";
  return "UNOBSERVED";
}

function constraintOutcome(input: PrescoreInput): DimensionScore["outcome"] {
  if (input.constraints.length === 0) return "NOT_APPLICABLE";
  if (input.constraints.every((item) => input.retainedConstraintIds.includes(item.id))) return "PASS";
  return "FAIL";
}

function progressOutcome(input: PrescoreInput): DimensionScore["outcome"] {
  if (input.progressed === UNOBSERVED) return "UNOBSERVED";
  if (input.progressed === false || input.stalledTurns >= 2) return "FAIL";
  return "PASS";
}
