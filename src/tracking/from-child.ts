import type { VerificationKind } from "../protocol/v1.js";
import { computePrescore, type PrescoreInput } from "./prescore.js";
import { runTrackingTurn, type TrackingTurnResult } from "./turn.js";
import { UNOBSERVED, type ConstraintRecord, type TrackingAssessment, type ToolSituation } from "./types.js";
import type { PrescoreResult } from "./types.js";

export type ObservedChildOutcome = "SUCCESS" | "PARTIAL" | "FAILURE" | "CANCELLED" | "TIMEOUT";

/** One criterion's reported outcome, as it arrives on the child's verdict. */
export interface CriterionObservation {
  readonly id: string;
  readonly kind: VerificationKind;
  readonly evidenceIds: readonly string[];
}

export interface ChildObservation {
  readonly taskId: string;
  readonly role: string;
  readonly outcome: ObservedChildOutcome;
  readonly summary: string;
  readonly evidenceIds: readonly string[];
  readonly artifactIds: readonly string[];
  readonly verification?: {
    readonly kind: VerificationKind;
    readonly evidenceIds: readonly string[];
    /**
     * Per-criterion outcomes the verifier reported, carried through from
     * `protocol/v1.ts::VerificationResult`. Absent means the verifier spoke
     * only about the task as a whole — which is what every child said before
     * this channel existed, and still what a silent one says.
     */
    readonly criteria?: readonly CriterionObservation[];
  };
  readonly requiredChecks: readonly string[];
  readonly constraints: readonly ConstraintRecord[];
}

/**
 * The criteria this child reported FAILED — the only per-criterion fact that
 * gates anything.
 *
 * `UNOBSERVED` and absence both stay open: "the verifier did not look at this
 * criterion" and "the verifier said nothing about criteria at all" are not
 * "the child did not meet it". A node that never ran reports nothing, so it
 * is unknown, not unmet, with no special case needed to keep it that way.
 *
 * Criterion ids are not correlated against the task's spec. The observation is
 * the child's own statement about work it did; an id nobody asked for is a
 * reporting slip, and treating a slip as grounds to discard a real FAILED
 * outcome would be the wrong way round.
 */
export function unmetCriteriaOf(observation: ChildObservation): readonly CriterionObservation[] {
  return (observation.verification?.criteria ?? []).filter((criterion) => criterion.kind === "FAILED");
}

export function shouldApplyThreeLine(input: {
  readonly verificationKind?: VerificationKind;
  readonly coverage: number;
  readonly hasHardPassOrFail: boolean;
}): boolean {
  if (input.verificationKind !== "PASSED" && input.verificationKind !== "FAILED") return false;
  return input.coverage > 0 && input.hasHardPassOrFail;
}

export type ChildTrackingDecision =
  | { readonly apply: false }
  | {
      readonly apply: true;
      readonly prescore: PrescoreResult;
      readonly turn: TrackingTurnResult;
      readonly assessment: TrackingAssessment;
    };

/**
 * Decides whether a routed child's TASK_RESULT has enough protocol facts to
 * run three-line scoring. Does not invent tracker prose or fill UNOBSERVED as 0.5.
 *
 * `verification.kind` still decides admission: PASSED or FAILED from the
 * verifier admits the child to scoring, UNOBSERVED does not, and FAILED is
 * what becomes `deterministicFail`.
 *
 * Two facts now reach the gate rather than one (Loop 4 R11-1, option (a)).
 * The second is `criterionUnmet`, and it is built here from what the child
 * *reported*, not from what the caller asked for: `unmetCriteriaOf` reads the
 * verdict's own per-criterion outcomes. A criterion the child listed as FAILED
 * blocks even when the whole-task verdict is PASSED, which is the case the
 * channel exists for — a child that finished, said so, and is honest about the
 * one thing it did not meet.
 *
 * The criteria the caller *asked for* remain what they were: `requiredChecks`
 * feeds check-coverage, whose range still has no FAIL, and constraints still
 * read back their own ids. See `prescore.ts::coverageOutcome` for why those
 * two dimensions are records rather than gates.
 */
export function assessChildObservation(input: {
  readonly observation: ChildObservation;
  readonly episodeId: string;
  readonly runId: string;
}): ChildTrackingDecision {
  const verification = input.observation.verification;
  if (verification === undefined || (verification.kind !== "PASSED" && verification.kind !== "FAILED")) {
    return { apply: false };
  }
  const prescoreInput = prescoreInputFromObservation(input.observation);
  const prescore = computePrescore(prescoreInput);
  const hasHardPassOrFail = prescore.dimensions.some(
    (dimension) => dimension.hardRelated && (dimension.outcome === "PASS" || dimension.outcome === "FAIL")
  );
  if (
    !shouldApplyThreeLine({
      verificationKind: verification.kind,
      coverage: prescore.coverage,
      hasHardPassOrFail
    })
  ) {
    return { apply: false };
  }
  const failRefs = evidenceRefsOf(input.observation);
  if (prescore.dimensions.some((dimension) => dimension.outcome === "FAIL") && failRefs.length === 0) {
    return { apply: false };
  }
  const window = {
    contextFacts: [`role ${input.observation.role}`, `task ${input.observation.taskId}`],
    toolSituations: prescoreInput.toolSituations,
    constraints: input.observation.constraints,
    unresolvedDecisions: [],
    confirmedDecisions: [],
    openMinors: []
  };
  const turn = runTrackingTurn({
    window,
    prescoreInput,
    humanInput: {},
    gateFacts: {
      deterministicFail: verification.kind === "FAILED",
      criterionUnmet: unmetCriteriaOf(input.observation).length > 0
    }
  });
  return {
    apply: true,
    prescore,
    turn,
    assessment: {
      schemaVersion: 1,
      episodeId: input.episodeId,
      runId: input.runId,
      turnId: input.observation.taskId,
      prescore: prescore.displayPrescore,
      quality: prescore.quality,
      coverage: prescore.coverage,
      human: turn.human,
      score: turn.score,
      dimensions: prescore.dimensions.map((dimension) => {
        const verdict = dimension.outcome === "ABSTAIN" ? "UNOBSERVED" : dimension.outcome;
        if (verdict === "FAIL") {
          return { id: dimension.id, verdict, evidenceRefs: failRefs };
        }
        return { id: dimension.id, verdict };
      }),
      gate: turn.gate,
      evidenceRefs: failRefs
    }
  };
}

/**
 * The sole production producer of a `PrescoreInput`.
 *
 * `completedChecks` and `retainedConstraintIds` are derived from the request,
 * not observed, and they stay that way (Loop 4 R7-2, re-affirmed at R11-1).
 * A terminal TASK_RESULT may now carry per-criterion outcomes, so there *is*
 * something observed to put in `completedChecks` — and putting it there was
 * rejected. Doing so would turn `turn.ts`'s
 * `derivedClaimedVerificationWithoutChecks` into the leading hard code for a
 * PASSED child with an unmet criterion, conditioned on whether the child's own
 * prose matches `isSuccessClaim`; that hands an untrusted-text match a gating
 * decision and misses the child that reports the gap without boasting. The
 * reported outcomes reach the gate directly instead, as
 * `unmet-acceptance-criterion` — see {@link unmetCriteriaOf} and
 * `prescore.ts::coverageOutcome`.
 *
 * The consequence is worth stating plainly: the two criteria-shaped dimensions
 * still compare a list against a copy of itself and still cannot fail a child.
 * They are a record of what was asked for. The gate reads what was reported.
 */
export function prescoreInputFromObservation(observation: ChildObservation): PrescoreInput {
  const verification = observation.verification;
  const claims = observation.summary.trim() === "" ? [] : [observation.summary];
  const toolSituations: ToolSituation[] = [];
  if (verification !== undefined && verification.kind !== "UNOBSERVED") {
    toolSituations.push({
      name: "task-result",
      exitCode: verification.kind === "PASSED" ? 0 : 1,
      wrote: observation.artifactIds.length > 0,
      escaped: false,
      artifactIds: [...observation.artifactIds],
      evidenceIds: evidenceRefsOf(observation),
      hashes: []
    });
  }
  const progressed =
    observation.outcome === "SUCCESS" || observation.outcome === "PARTIAL"
      ? true
      : observation.outcome === "FAILURE" || observation.outcome === "TIMEOUT"
        ? false
        : UNOBSERVED;
  return {
    claims,
    toolSituations,
    writePaths: [],
    ownedPaths: [],
    requiredChecks: observation.requiredChecks,
    completedChecks: verification?.kind === "PASSED" ? [...observation.requiredChecks] : [],
    constraints: observation.constraints,
    retainedConstraintIds: observation.constraints.map((constraint) => constraint.id),
    progressed,
    stalledTurns: 0,
    // Not third-party verification, despite the name. This says only that the
    // verifier reached a verdict; it does not say a party other than the actor
    // produced one. Since Loop 4 R9-2 a pi child can author its own terminal
    // TASK_RESULT via `sparkle_report_task_result`, so on that path
    // `verification.kind` — and this flag with it — is the child's report of
    // what it ran. Nothing reads the flag today (`prescore.ts` discards it),
    // which is what keeps the gap harmless: a future consumer that reads it as
    // independent corroboration would be scoring a claim as if it were a
    // check. Recorded, deliberately not renamed (Loop 4 R10-5, parent-signed);
    // pinned in `test/unit/tracking/independent-evidence-posture.test.ts`.
    independentEvidence: verification?.kind === "PASSED" || verification?.kind === "FAILED"
  };
}

/**
 * Every reference the child's verdict rests on, including the ones cited by an
 * individual criterion. A criterion outcome that gates a run has to leave its
 * evidence on the recorded assessment, or the anomaly names a criterion nobody
 * can look up afterwards. Which criterion it was stays readable from the
 * child's own `CHILD_MESSAGE` row, which carries the whole array durably.
 */
function evidenceRefsOf(observation: ChildObservation): string[] {
  const refs = new Set<string>();
  for (const id of observation.evidenceIds) refs.add(id);
  for (const id of observation.verification?.evidenceIds ?? []) refs.add(id);
  for (const criterion of observation.verification?.criteria ?? []) {
    for (const id of criterion.evidenceIds) refs.add(id);
  }
  return [...refs];
}
