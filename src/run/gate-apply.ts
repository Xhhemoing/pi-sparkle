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

function currentGateStatus(events: readonly Event[]): GateRunStatus {
  let status: GateRunStatus = "RUNNING";
  for (const event of events) {
    if (event.type === "GATE_TRANSITION") status = event.payload.to;
    else if (event.type === "RUN_BLOCKED") status = "BLOCKED";
    else if (event.type === "RUN_WAITING_FOR_USER") status = "WAITING_FOR_USER";
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
