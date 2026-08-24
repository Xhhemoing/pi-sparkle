import type { VerificationKind } from "../protocol/v1.js";
import { computePrescore, type PrescoreInput } from "./prescore.js";
import { runTrackingTurn, type TrackingTurnResult } from "./turn.js";
import { UNOBSERVED, type ConstraintRecord, type TrackingAssessment, type ToolSituation } from "./types.js";
import type { PrescoreResult } from "./types.js";

export type ObservedChildOutcome = "SUCCESS" | "PARTIAL" | "FAILURE" | "CANCELLED" | "TIMEOUT";

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
  };
  readonly requiredChecks: readonly string[];
  readonly constraints: readonly ConstraintRecord[];
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
 * The only fact that gates the child is `verification.kind`: PASSED or FAILED
 * from the deterministic verifier admits the child to scoring, and FAILED is
 * what becomes `deterministicFail` — the hard gate. The task's acceptance
 * criteria and the run contract's constraints are recorded as dimension
 * verdicts and move the numeric prescore, but cannot change the directive.
 * See `prescore.ts::coverageOutcome` for the recorded contract.
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
    gateFacts: { deterministicFail: verification.kind === "FAILED" }
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
 * not observed, and that is deliberate (Loop 4 R7-2, parent-signed): a child's
 * terminal TASK_RESULT carries one verification verdict, no per-criterion or
 * per-constraint outcome, so there is nothing honest to put here. Echoing the
 * inputs keeps the two criteria-shaped dimensions from silently reading as
 * failures of the child; it also makes them incapable of failing one. The
 * deterministic verifier is the gate — see `prescore.ts::coverageOutcome`.
 *
 * Anyone replacing either derivation with a real observation is changing the
 * gate's semantics on every plane, not just this function.
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

function evidenceRefsOf(observation: ChildObservation): string[] {
  const refs = new Set<string>();
  for (const id of observation.evidenceIds) refs.add(id);
  for (const id of observation.verification?.evidenceIds ?? []) refs.add(id);
  return [...refs];
}
