import type { IndependentCheckRecord } from "./independent-check.js";
import {
  WORKTREE_FINGERPRINT_SCHEMA,
  fingerprintsCompatible,
  type WorktreeFingerprint
} from "./worktree-snapshot.js";

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
 * command check bound to revision / artifactHash / cwd / command / argv and
 * g1a-v1 content fingerprints. A self-report with PASSED and empty evidenceIds
 * fails closed.
 */
export interface ClosedLoopAcceptance {
  readonly selfReport?: SelfReportClaim;
  readonly independentCheck?: IndependentCheckRecord;
  readonly artifactHash?: string;
  readonly revision: string;
  readonly cwd: string;
  readonly command: string;
  readonly args: readonly string[];
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
  /** Host-declared check command (must match independentCheck.command). */
  readonly command: string;
  /** Host-declared argv (must match independentCheck.args). */
  readonly args?: readonly string[];
}

function argsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function fingerprintUsable(fp: WorktreeFingerprint | undefined): boolean {
  return fp !== undefined && fp.schemaVersion === WORKTREE_FINGERPRINT_SCHEMA && fp.digest.length === 64;
}

/**
 * Fail closed unless an independent command check succeeded and an artifact
 * hash is bound. Self-report alone (including PASSED + empty evidenceIds) is
 * never enough — that is the known failure mode this closes.
 *
 * G1A: also requires command/argv match, g1a-v1 fingerprints before/after the
 * check, and identical digests (or host-declared compatible equality already
 * enforced when the check was produced).
 */
export function evaluateIndependentAcceptance(input: EvaluateAcceptanceInput): ClosedLoopAcceptance {
  const hostArgs = input.args ?? [];
  const base = {
    ...(input.selfReport !== undefined ? { selfReport: input.selfReport } : {}),
    ...(input.independentCheck !== undefined ? { independentCheck: input.independentCheck } : {}),
    ...(input.artifactHash !== undefined ? { artifactHash: input.artifactHash } : {}),
    revision: input.revision,
    cwd: input.cwd,
    command: input.command,
    args: hostArgs
  };

  if (input.independentCheck === undefined) {
    return {
      ...base,
      accepted: false,
      reason: "self-report alone is not independent acceptance; independentCheck required"
    };
  }

  const check = input.independentCheck;

  if (!check.ok || check.exitCode !== 0) {
    return {
      ...base,
      accepted: false,
      reason: `independent check failed (exitCode=${check.exitCode})`
    };
  }

  if (input.artifactHash === undefined || input.artifactHash.trim() === "") {
    return {
      ...base,
      accepted: false,
      reason: "artifactHash binding required for independent acceptance"
    };
  }

  if (check.cwd !== input.cwd || check.revision !== input.revision) {
    return {
      ...base,
      accepted: false,
      reason: "independent check cwd/revision mismatch with acceptance binding"
    };
  }

  if (check.command !== input.command || !argsEqual(check.args, hostArgs)) {
    return {
      ...base,
      accepted: false,
      reason: "independent check command/argv mismatch with host-declared acceptance binding"
    };
  }

  if (check.schemaVersion !== WORKTREE_FINGERPRINT_SCHEMA) {
    return {
      ...base,
      accepted: false,
      reason: "independent check missing g1a-v1 schemaVersion (legacy HEAD-only evidence is not upgraded)"
    };
  }

  if (!fingerprintUsable(check.contentFingerprintBefore) || !fingerprintUsable(check.contentFingerprintAfter)) {
    return {
      ...base,
      accepted: false,
      reason: "independent check missing g1a-v1 content fingerprints"
    };
  }

  const compat = fingerprintsCompatible(
    check.contentFingerprintBefore!,
    check.contentFingerprintAfter!,
    check.snapshotManifest ?? {}
  );
  if (!compat.ok) {
    return {
      ...base,
      accepted: false,
      reason: compat.reason || "candidate content fingerprint changed across independent check"
    };
  }

  if (check.contentFingerprintBefore!.headRevision !== input.revision) {
    return {
      ...base,
      accepted: false,
      reason: "fingerprint headRevision does not match acceptance revision binding"
    };
  }

  if (check.artifactHash !== undefined && check.artifactHash !== input.artifactHash) {
    return {
      ...base,
      accepted: false,
      reason: "artifactHash does not match independent check artifact binding"
    };
  }

  return {
    ...base,
    accepted: true,
    reason: "independent check ok with artifact + g1a-v1 content binding"
  };
}
