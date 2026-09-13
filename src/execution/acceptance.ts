import type { IndependentCheckRecord } from "./independent-check.js";

/**
 * Optional child self-report. Never sufficient alone for independent
 * acceptance — see {@link evaluateIndependentAcceptance}.
 */
export interface SelfReportClaim {
  readonly source: "subagent";
  readonly verification: "PASSED" | "FAILED" | "UNOBSERVED";
  readonly evidenceIds: readonly string[];
  readonly summary?: string;
}

/**
 * Closed-loop acceptance record. Acceptance requires a successful independent
 * command check bound to revision / artifactHash / cwd / command. A self-report
 * with PASSED and empty evidenceIds fails closed.
 */
export interface ClosedLoopAcceptance {
  readonly selfReport?: SelfReportClaim;
  readonly independentCheck?: IndependentCheckRecord;
  readonly artifactHash?: string;
  readonly revision: string;
  readonly cwd: string;
  readonly command: string;
  readonly accepted: boolean;
  readonly reason: string;
}

export interface EvaluateAcceptanceInput {
  readonly selfReport?: SelfReportClaim;
  readonly independentCheck?: IndependentCheckRecord;
  /** Required artifact content hash for binding. */
  readonly artifactHash?: string;
  readonly revision: string;
  readonly cwd: string;
  readonly command: string;
}

/**
 * Fail closed unless an independent command check succeeded and an artifact
 * hash is bound. Self-report alone (including PASSED + empty evidenceIds) is
 * never enough — that is the known failure mode this closes.
 */
export function evaluateIndependentAcceptance(input: EvaluateAcceptanceInput): ClosedLoopAcceptance {
  const base = {
    ...(input.selfReport !== undefined ? { selfReport: input.selfReport } : {}),
    ...(input.independentCheck !== undefined ? { independentCheck: input.independentCheck } : {}),
    ...(input.artifactHash !== undefined ? { artifactHash: input.artifactHash } : {}),
    revision: input.revision,
    cwd: input.cwd,
    command: input.command
  };

  if (input.independentCheck === undefined) {
    return {
      ...base,
      accepted: false,
      reason: "self-report alone is not independent acceptance; independentCheck required"
    };
  }

  if (!input.independentCheck.ok || input.independentCheck.exitCode !== 0) {
    return {
      ...base,
      accepted: false,
      reason: `independent check failed (exitCode=${input.independentCheck.exitCode})`
    };
  }

  if (input.artifactHash === undefined || input.artifactHash.trim() === "") {
    return {
      ...base,
      accepted: false,
      reason: "artifactHash binding required for independent acceptance"
    };
  }

  // Bindings must agree with the check record when present.
  if (
    input.independentCheck.cwd !== input.cwd ||
    input.independentCheck.revision !== input.revision
  ) {
    return {
      ...base,
      accepted: false,
      reason: "independent check cwd/revision mismatch with acceptance binding"
    };
  }

  if (
    input.independentCheck.artifactHash !== undefined &&
    input.independentCheck.artifactHash !== input.artifactHash
  ) {
    return {
      ...base,
      accepted: false,
      reason: "artifactHash does not match independent check artifact binding"
    };
  }

  return {
    ...base,
    accepted: true,
    reason: "independent check ok with artifact binding"
  };
}
