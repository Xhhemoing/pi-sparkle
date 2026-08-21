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
    independentEvidence: verification?.kind === "PASSED" || verification?.kind === "FAILED"
  };
}

function evidenceRefsOf(observation: ChildObservation): string[] {
  const refs = new Set<string>();
  for (const id of observation.evidenceIds) refs.add(id);
  for (const id of observation.verification?.evidenceIds ?? []) refs.add(id);
  return [...refs];
}
