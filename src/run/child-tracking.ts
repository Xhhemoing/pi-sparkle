import type { RequirementContract } from "../domain/contract.js";
import type { EventId } from "../domain/ids.js";
import type { ConstraintRecord } from "../tracking/types.js";
import { hashAssessment } from "../tracking/types.js";
import { assessChildObservation, type ChildObservation } from "../tracking/from-child.js";
import type { ChildRunOutcome, ChildTaskInput } from "./child-coordinator.js";
import { episodeIdFromEvents } from "./episode-bind.js";
import { applyTrackingGate, nextTrackingSeq, type GateApplyResult } from "./gate-apply.js";
import type { Event } from "./events.js";

/** Ledger, not control: callers append `events` and discard the rest — see {@link GateApplyResult}. */
export function applyChildThreeLine(input: {
  readonly events: readonly Event[];
  readonly child: ChildRunOutcome;
  readonly spec?: ChildTaskInput;
  readonly contract?: RequirementContract;
  readonly nowIso: string;
  readonly generateEventId: () => EventId;
}): { readonly events: readonly Event[]; readonly result: GateApplyResult } {
  const skipped: GateApplyResult = { applied: false, directive: "none", runStatus: "RUNNING" };
  const terminal = input.child.terminalResult;
  if (terminal === undefined) {
    return { events: input.events, result: skipped };
  }
  const episodeId = episodeIdFromEvents(input.events);
  if (episodeId === undefined) {
    return { events: input.events, result: skipped };
  }
  const runId = input.events[0]?.runId;
  if (runId === undefined) {
    return { events: input.events, result: skipped };
  }
  const observation = observationFromChild(input.child, input.spec, input.contract);
  const assessed = assessChildObservation({
    observation,
    episodeId,
    runId
  });
  if (!assessed.apply) {
    return { events: input.events, result: skipped };
  }
  return applyTrackingGate({
    events: input.events,
    assessment: assessed.assessment,
    assessmentHash: hashAssessment(assessed.assessment),
    expectedSeq: nextTrackingSeq(input.events),
    policyVersion: "track-v1",
    nowIso: input.nowIso,
    generateEventId: input.generateEventId
  });
}

export function observationFromChild(
  child: ChildRunOutcome,
  spec?: ChildTaskInput,
  contract?: RequirementContract
): ChildObservation {
  const role = spec?.role ?? "worker";
  const acceptance = spec?.acceptanceCriteria ?? [];
  const requiredChecks =
    role === "tester"
      ? acceptance.length > 0
        ? acceptance.map((criterion) => criterion.id)
        : ["test"]
      : [];
  const constraints: ConstraintRecord[] = (contract?.constraints ?? []).map((constraint) => ({
    id: constraint.id,
    text: constraint.description,
    kind: "constraint",
    mandatory: true
  }));
  const verification = child.terminalResult?.verification;
  return {
    taskId: child.taskId,
    role,
    outcome: child.outcome,
    summary: child.summary,
    evidenceIds: child.evidenceIds,
    artifactIds: child.artifactIds,
    ...(verification !== undefined ? { verification } : {}),
    requiredChecks,
    constraints
  };
}
