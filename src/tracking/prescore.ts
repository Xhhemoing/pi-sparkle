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
  /** No production caller observes this; see `coverageOutcome`. */
  readonly completedChecks: readonly string[];
  readonly constraints: readonly ConstraintRecord[];
  /** No production caller observes this; see `constraintOutcome`. */
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

export function isSuccessClaim(claim: string): boolean {
  return SUCCESS_CLAIM.test(claim);
}

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
  const successClaim = input.claims.some(isSuccessClaim);
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

/**
 * check-coverage — criteria-shaped, and deliberately not a check.
 *
 * `FAIL` is not in this function's range: a required check nobody reported
 * completing reads UNOBSERVED, never FAIL. That is the recorded contract, not
 * an oversight (Loop 4 R7-2, parent-signed): **acceptance criteria are prompt
 * guidance, and the deterministic verifier is the sole gate on a child's
 * work.** The verifier reaches the gate as `deterministicFail` in `turn.ts`,
 * carrying `verification.kind` from the child's terminal TASK_RESULT.
 *
 * Criteria are load-bearing elsewhere — `run/child-prompt.ts` renders them to
 * the child under "Acceptance:", and `requirement/coverage.ts` makes plan-time
 * coverage of every contract criterion a start condition. They are simply not
 * evidence: the protocol carries one verification verdict per task, not
 * per-criterion outcomes, so the sole production producer of a `PrescoreInput`
 * (`from-child.ts::prescoreInputFromObservation`) can only echo the criteria
 * that were asked for, and this dimension compares a list against a copy of
 * itself.
 *
 * Changing that is a real change, not a tidy-up, and it is three changes:
 *   1. a child-side way to report per-criterion outcomes, so `completedChecks`
 *      can be an observation instead of an echo;
 *   2. resumed child specs — re-synthesised today with empty criteria — fixed
 *      in the same diff, or a resumed node is gated more weakly than the node
 *      the run started with. The FAIL-unreachable tripwire in
 *      `test/unit/run/flowchart-run-abort.test.ts` is where whoever tries
 *      finds out; its docstring names the fix;
 *   3. a way for the FAIL to reach the gate at all. Putting FAIL into this
 *      function's range is not enough on its own: `gates.ts` has no anomaly
 *      code for an unmet acceptance criterion, and `cappedByHardFail` caps
 *      `displayPrescore` only — the gate scores the uncapped `P`. A lone
 *      criteria-shaped FAIL therefore drops P by one dimension's weight and
 *      leaves the directive at `none` (pinned in
 *      `test/unit/tracking/criteria-are-guidance.test.ts`).
 */
function coverageOutcome(input: PrescoreInput): DimensionScore["outcome"] {
  if (input.requiredChecks.length === 0) return "NOT_APPLICABLE";
  if (input.requiredChecks.every((check) => input.completedChecks.includes(check))) return "PASS";
  return "UNOBSERVED";
}

/**
 * constraint-retention — the same contract as check-coverage, reached the
 * other way round. `FAIL` *is* in this function's range, but no production
 * path can produce it: `prescoreInputFromObservation` sets
 * `retainedConstraintIds` to the constraints' own ids, so every shipped call
 * reads PASS (constraints present) or NOT_APPLICABLE (none). A contract
 * constraint is guidance carried into the child's context until something
 * observes retention independently; today nothing does.
 */
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
