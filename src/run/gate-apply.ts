import { DomainValidationError } from "../domain/errors.js";
import { createMessageId, type EventId, type RunId } from "../domain/ids.js";
import type { IsoTimestamp } from "../domain/timestamp.js";
import { hashAssessment, type TrackingAssessment } from "../tracking/types.js";
import {
  type Event,
  type GateDirective,
  type GateRunStatus,
  validateEvent
} from "./events.js";

export type { GateDirective, GateRunStatus } from "./events.js";

/**
 * What the gate did with one assessment.
 *
 * `runStatus` is a consistency ledger for the transition record, not a control
 * input (Loop 4 R9-6, parent-signed). It reports the status this apply wrote —
 * or, when nothing was written, would have written — into
 * `GATE_TRANSITION.payload.to`, so that a caller reconciling its own view
 * against the record has the gate's answer in hand. It is deliberately not the
 * channel through which the gate steers a run, and outside this module nothing
 * reads it:
 *
 * - the flowchart plane (`flowchart-run.ts::executeClusteredNode`, reached
 *   through `child-tracking.ts::applyChildThreeLine`) appends the returned
 *   events and discards the result whole. Its control comes from the flowchart
 *   supervisor's state machine and its reported status from `replayRun` over
 *   the log, so the gate reaches that plane only as the `RUN_BLOCKED` /
 *   `RUN_WAITING_FOR_USER` events appended below;
 * - the parent DAG coordinator reads `directive` and nothing else.
 *
 * So the reconstruction is near-write-only on the flowchart plane, and that is
 * the posture rather than an oversight to be tidied away. Wiring `runStatus`
 * into either plane's control flow would move the gate from writing the record
 * to driving the run, which is a decision needing its own justification: the
 * gate's authority is deliberately bounded, and the adjacent question of how
 * much it may block is settled — soft and hard both block (Loop 4 R8-4 C7).
 * The absence of a reader is pinned, so growing one is a visible act.
 */
export interface GateApplyResult {
  readonly applied: boolean;
  readonly directive: GateDirective;
  readonly transitionId?: string;
  readonly runStatus: GateRunStatus;
}

export function applyTrackingGate(input: {
  readonly events: readonly Event[];
  readonly assessment: TrackingAssessment;
  readonly assessmentHash: string;
  readonly expectedSeq: number;
  readonly policyVersion: string;
  readonly nowIso: string;
  readonly generateEventId: () => EventId;
}): { readonly events: readonly Event[]; readonly result: GateApplyResult } {
  if (input.assessmentHash !== hashAssessment(input.assessment)) {
    throw new DomainValidationError(
      "assessmentHash mismatch: does not match hashAssessment(assessment)"
    );
  }
  const idempotencyKey = `${input.assessmentHash}:${input.expectedSeq}`;
  const existing = input.events.find(
    (event): event is Extract<Event, { type: "GATE_TRANSITION" }> =>
      event.type === "GATE_TRANSITION" && event.payload.idempotencyKey === idempotencyKey
  );
  if (existing !== undefined) {
    return {
      events: input.events,
      result: {
        applied: false,
        directive: existing.payload.directive,
        transitionId: existing.payload.transitionId,
        runStatus: existing.payload.to
      }
    };
  }
  const existingAssessment = input.events.find(
    (event): event is Extract<Event, { type: "TRACKING_ASSESSMENT" }> =>
      event.type === "TRACKING_ASSESSMENT" &&
      event.payload.seq === input.expectedSeq &&
      event.payload.assessmentHash === input.assessmentHash
  );
  if (existingAssessment !== undefined) {
    return {
      events: input.events,
      result: {
        applied: false,
        directive: mapGateDirective(input.assessment).directive,
        runStatus: currentGateStatus(input.events)
      }
    };
  }

  const mapped = mapGateDirective(input.assessment);
  const from = currentGateStatus(input.events);
  const runId = input.assessment.runId as RunId;
  const occurredAt = input.nowIso as IsoTimestamp;
  const next = [...input.events];

  next.push(
    validateEvent({
      id: input.generateEventId(),
      schemaVersion: 1,
      occurredAt,
      runId,
      type: "TRACKING_ASSESSMENT",
      actor: "supervisor",
      payload: {
        assessment: input.assessment,
        assessmentHash: input.assessmentHash,
        seq: input.expectedSeq
      }
    })
  );

  if (mapped.directive === "none") {
    return {
      events: next,
      result: { applied: true, directive: "none", runStatus: from }
    };
  }

  const transitionId = input.generateEventId();
  next.push(
    validateEvent({
      id: transitionId,
      schemaVersion: 1,
      occurredAt,
      runId,
      type: "GATE_TRANSITION",
      actor: "supervisor",
      payload: {
        transitionId,
        episodeId: input.assessment.episodeId,
        turnId: input.assessment.turnId,
        seq: input.expectedSeq,
        from,
        to: mapped.runStatus,
        reasonCode: mapped.reasonCode,
        assessmentHash: input.assessmentHash,
        evidenceRefs: input.assessment.evidenceRefs,
        policyVersion: input.policyVersion,
        idempotencyKey,
        directive: mapped.directive
      }
    })
  );

  if (mapped.directive === "queue_analysis") {
    // replay/resume treat RUN_BLOCKED as terminal BLOCKED until an explicit unblock;
    // that is the intended Phase A meaning of queue_analysis.
    next.push(
      validateEvent({
        id: input.generateEventId(),
        schemaVersion: 1,
        occurredAt,
        runId,
        type: "RUN_BLOCKED",
        actor: "supervisor",
        payload: {
          reason: "ANALYSIS_QUEUED",
          requiredEvidence: [...input.assessment.evidenceRefs]
        }
      })
    );
  }

  if (mapped.directive === "wait_user") {
    const waitingId = input.generateEventId();
    next.push(
      validateEvent({
        id: waitingId,
        schemaVersion: 1,
        occurredAt,
        runId,
        type: "RUN_WAITING_FOR_USER",
        actor: "supervisor",
        payload: {
          messageId: createMessageId(() => waitingId.slice("evt_".length))
        }
      })
    );
  }

  return {
    events: next,
    result: {
      applied: true,
      directive: mapped.directive,
      transitionId,
      runStatus: mapped.runStatus
    }
  };
}

export function executionAuthority(input: {
  readonly taskContext: unknown;
  readonly supervisorDirective: GateDirective;
  readonly rollingSummaryText?: string;
}): unknown {
  void input.supervisorDirective;
  void input.rollingSummaryText;
  return input.taskContext;
}

/**
 * The gate's own view of the run status, reconstructed for the `from` field of
 * the next transition.
 *
 * It tracks the active `RUN_BLOCKED` id for the same reason replay does: only
 * an unblock that names the block in force clears it. A stale or unmatched
 * `RUN_UNBLOCKED` leaves the gate BLOCKED, so the two reconstructions agree
 * about which run is running — without that, an unblocked run's next
 * transition would claim to start from a block that no longer exists.
 *
 * Writing that field is its whole job: this reconstruction never decides
 * anything. In production it is observable only through the `from` field of a
 * *subsequently* written transition, and a run that recovers writes no such
 * transition, because a passing re-verification maps to `directive: "none"`.
 * Only the run that fails again reads it back, which is why exactly one
 * end-to-end shape observes it at all — the re-block cycle in
 * `test/integration/run/unblock-flow.test.ts`. Keeping it in step with replay
 * is therefore an obligation about the record, on the same footing as
 * {@link GateApplyResult}'s `runStatus`, and not a control path.
 */
function currentGateStatus(events: readonly Event[]): GateRunStatus {
  let status: GateRunStatus = "RUNNING";
  let blockedEventId: EventId | undefined;
  for (const event of events) {
    if (event.type === "GATE_TRANSITION") status = event.payload.to;
    else if (event.type === "RUN_BLOCKED") {
      status = "BLOCKED";
      blockedEventId = event.id;
    } else if (event.type === "RUN_UNBLOCKED") {
      if (blockedEventId !== undefined && event.payload.blockedEventId === blockedEventId) {
        status = "RUNNING";
        blockedEventId = undefined;
      }
    } else if (event.type === "RUN_WAITING_FOR_USER") status = "WAITING_FOR_USER";
    else if (event.type === "USER_ANSWER" || event.type === "RUN_STARTED") status = "RUNNING";
  }
  return status;
}

function mapGateDirective(assessment: TrackingAssessment): {
  directive: GateDirective;
  runStatus: GateRunStatus;
  reasonCode: string;
} {
  const gate = assessment.gate;
  if (gate.askUser) {
    return {
      directive: "wait_user",
      runStatus: "WAITING_FOR_USER",
      reasonCode: gate.codes[0] ?? "ASK_USER"
    };
  }
  if (gate.kind === "none") {
    return { directive: "none", runStatus: "RUNNING", reasonCode: "NONE" };
  }
  if (gate.kind === "hard" && gate.codes.includes("user-reject-stop")) {
    return {
      directive: "wait_user",
      runStatus: "WAITING_FOR_USER",
      reasonCode: "user-reject-stop"
    };
  }
  if (gate.kind === "soft" || gate.kind === "hard" || gate.wakeAnalysis) {
    return {
      directive: "queue_analysis",
      runStatus: "BLOCKED",
      reasonCode: gate.codes[0] ?? "ANALYSIS_QUEUED"
    };
  }
  return {
    directive: "wait_user",
    runStatus: "WAITING_FOR_USER",
    reasonCode: "FAIL_CLOSED"
  };
}

export function nextTrackingSeq(events: readonly Event[]): number {
  let next = 0;
  for (const event of events) {
    if (event.type === "TRACKING_ASSESSMENT" || event.type === "GATE_TRANSITION") {
      next = Math.max(next, event.payload.seq + 1);
    }
  }
  return next;
}
