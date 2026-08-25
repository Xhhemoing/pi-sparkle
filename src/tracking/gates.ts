import type { TrackingConfig } from "./config.js";
import type { AnomalyCode, GateDecision, HumanSignal, OpenMinor } from "./types.js";

export interface GateInput {
  readonly P: number;
  readonly score: number;
  readonly human: HumanSignal;
  readonly config: TrackingConfig;
  readonly deterministicFail: boolean;
  readonly ownershipEscape: boolean;
  readonly claimedVerificationWithoutChecks: boolean;
  /**
   * At least one acceptance criterion the verifier reported on came back
   * FAILED. Supplied by the caller from an observation, never recomputed here
   * from a score or read off a dimension's outcome: the whole point of the
   * code below is that it is auditable back to a criterion id and the evidence
   * that criterion cited, which a derived number cannot be.
   *
   * Required rather than optional so a caller has to state it. A gate fact
   * that defaults to `false` when nobody mentions it is how a gate quietly
   * stops gating, and this one is new enough that every call site should say
   * what it knows.
   */
  readonly criterionUnmet: boolean;
  readonly repeatedNoProgress: boolean;
  readonly userRejectStop: boolean;
  readonly safetyRejected: boolean;
  readonly openMinors: readonly OpenMinor[];
}

export function evaluateGates(input: GateInput): GateDecision {
  const hardCodes: AnomalyCode[] = [];
  if (input.deterministicFail) hardCodes.push("deterministic-fail");
  if (input.ownershipEscape) hardCodes.push("ownership-escape");
  if (input.claimedVerificationWithoutChecks) hardCodes.push("claimed-verification-without-checks");
  // Ordered here deliberately: a whole-task deterministic FAIL, a scope escape
  // and a self-contradicting claim each still stamp the transition's
  // reasonCode ahead of an unmet criterion, because each of them says
  // something about the task that a single criterion does not.
  //
  // Hard rather than soft because `run/gate-apply.ts::mapGateDirective` sends
  // both kinds to `queue_analysis` -> BLOCKED; "soft" would buy no gentleness,
  // only a vaguer reason code on the transition.
  if (input.criterionUnmet) hardCodes.push("unmet-acceptance-criterion");
  if (input.repeatedNoProgress) hardCodes.push("repeated-no-progress");
  if (input.userRejectStop) hardCodes.push("user-reject-stop");
  if (input.safetyRejected) hardCodes.push("permission-security-reject");

  if (hardCodes.length > 0) {
    return {
      kind: "hard",
      codes: hardCodes,
      wakeAnalysis: true,
      expandDetail: true,
      askUser: input.userRejectStop,
      openMinors: input.openMinors
    };
  }

  if (input.score < input.config.softThreshold) {
    return {
      kind: "soft",
      codes: ["soft-threshold"],
      wakeAnalysis: true,
      expandDetail: true,
      askUser: false,
      openMinors: input.openMinors
    };
  }

  if (shouldEscalateMinors(input.openMinors)) {
    return {
      kind: "soft",
      codes: ["minor-escalated"],
      wakeAnalysis: true,
      expandDetail: true,
      askUser: false,
      openMinors: input.openMinors
    };
  }

  return {
    kind: "none",
    codes: [],
    wakeAnalysis: false,
    expandDetail: false,
    askUser: false,
    openMinors: input.openMinors
  };
}

function shouldEscalateMinors(minors: readonly OpenMinor[]): boolean {
  const verified = minors.filter((item) => item.status === "verified-true");
  if (verified.some((item) => item.consecutiveTurns >= 2)) return true;
  if (verified.length >= 3) return true;
  if (verified.some((item) => item.touchesConstraint || item.userRejected)) return true;
  return false;
}
