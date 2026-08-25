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
  /**
   * That the verifier reached a verdict — *not* that a party other than the
   * actor confirmed it. The sole production producer sets it from the child's
   * own terminal TASK_RESULT; see `from-child.js` at the field, and the
   * discard in `computePrescore` for why nothing may read it as corroboration.
   */
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
  // Discarded, and this one is load-bearing: `independentEvidence` records
  // that a verdict exists, and since Loop 4 R9-2 that verdict can be the
  // child's self-report, so it is not corroboration and may not move the
  // score. Reading it here — or anywhere — is a decision with its own
  // justification, not a tidy-up of a stray `void` (Loop 4 R10-5,
  // parent-signed; the absence of a reader is pinned).
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
 * check-coverage — criteria-shaped, and deliberately still not a check.
 *
 * `FAIL` is not in this function's range: a required check nobody reported
 * completing reads UNOBSERVED, never FAIL. That is the recorded contract, and
 * it survived option (a) unchanged (Loop 4 R7-2, re-affirmed at R11-1,
 * parent-signed): **a criterion this dimension reads is a criterion that was
 * asked for, and asking for something is not evidence about it.**
 *
 * What changed at R11-1 is which criteria can gate, not this dimension. A
 * child may now report per-criterion outcomes on its own verdict
 * (`protocol/v1.ts::VerificationResult.criteria`), and a criterion it reports
 * FAILED reaches the gate as the `unmet-acceptance-criterion` anomaly, fed by
 * an explicit `GateInput` fact that `from-child.ts::assessChildObservation`
 * supplies from the observation. So an unmet criterion does block a run — via
 * a named code with the criterion's own evidence behind it, never via a number
 * this function moves.
 *
 * The rejected alternative is worth keeping written down, because it looks
 * like the obvious one: giving this dimension FAIL. It would be a *silent*
 * gate, and measurably a no-op — a lone criteria-shaped FAIL drops `P` by one
 * dimension's weight, caps `displayPrescore` (which the gate does not score),
 * and leaves the directive at `none`. It would also read a request-derived
 * echo as if it were an observation: the sole production producer of a
 * `PrescoreInput` (`from-child.ts::prescoreInputFromObservation`) still fills
 * `completedChecks` from the criteria that were asked for, on purpose, so this
 * dimension still compares a list against a copy of itself.
 *
 * Criteria remain load-bearing elsewhere too — `run/child-prompt.ts` renders
 * them to the child under "Acceptance:", and `requirement/coverage.ts` makes
 * plan-time coverage of every contract criterion a start condition.
 *
 * Two obligations remain open and are *not* satisfied by this function:
 *   1. a resumed child spec is re-synthesised with empty criteria only where
 *      nobody recorded the node. `run/flowchart-run.ts` writes the
 *      `taskCriteria` seam on `run/replay.ts::FlowchartCheckpointState` from
 *      the caller's child specs and from any logged `TASK_REQUEST` that
 *      carries criteria, so a recorded node is re-asked on resume for exactly
 *      what it was dispatched with. A node neither source names still carries
 *      no spec. That is unknown, not unmet, and the gate keeps it that way —
 *      `unmet-acceptance-criterion` fires only on a reported FAILED, and a
 *      node that never ran reports nothing. The FAIL-unreachable tripwire in
 *      `test/unit/run/flowchart-run-abort.test.ts` still holds this
 *      function's range;
 *   2. only a tester child's criteria become `requiredChecks` at all
 *      (`run/child-tracking.ts`), which is a role decision this dimension
 *      inherits. The gate does not: a reported criterion outcome is read
 *      whatever the child's role.
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
