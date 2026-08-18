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
