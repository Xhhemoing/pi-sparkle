import path from "node:path";
import type { RunId } from "../domain/ids.js";
import { hasTrustedVerificationEvidence, type IndependentCheckRecord } from "./independent-check.js";
import type { TrustedVerificationDescriptor } from "./trusted-verification.js";
import { fingerprintsCompatible } from "./worktree-snapshot.js";
export interface Finding {
  readonly id: string;
  readonly criterionId: string;
  readonly severity: "blocker" | "major" | "minor" | "info";
  readonly message: string;
  readonly evidenceRef?: string | undefined;
}

/** Historical observation only: no acceptance, repair or apply authority. */
export interface BoundCheckFinding extends Finding {
  readonly runId: RunId;
  readonly revision: string;
  /** Host-owned attempt identity; a new attempt must use a new generation. */
  readonly generation: string;
  readonly evidenceRef: string;
}

export type CheckFindingsProjection =
  | { readonly state: "available"; readonly findings: readonly BoundCheckFinding[] }
  | { readonly state: "unavailable"; readonly findings: readonly BoundCheckFinding[]; readonly reason: string };

export interface IndependentCheckFindingsInput {
  readonly check: IndependentCheckRecord;
  readonly trustedVerification: TrustedVerificationDescriptor;
  /** Supplied by the host that ran the check; not inferred from checker output. */
  readonly runId: RunId;
  readonly revision: string;
  readonly generation: string;
}

function unavailable(reason: string): CheckFindingsProjection {
  return Object.freeze({ state: "unavailable", findings: Object.freeze([]), reason });
}

/**
 * Reuse the execution path's private identity binding. Exact verification can
 * succeed while the command functionally fails; check.ok alone cannot express
 * that distinction. Copied or serialized records carry no runtime authority.
 */
export function findingsFromIndependentCheck(input: IndependentCheckFindingsInput): CheckFindingsProjection {
  const { check, trustedVerification, runId, revision, generation } = input;
  if (!hasTrustedVerificationEvidence(check, trustedVerification)) {
    return unavailable("original host-bound exact verification evidence required");
  }
  if (typeof runId !== "string" || runId.trim() === "" ||
      typeof revision !== "string" || revision.trim() === "" ||
      typeof generation !== "string" || generation.trim() === "" ||
      check.revision !== revision || !path.isAbsolute(check.cwd) ||
      check.contentFingerprintBefore.headRevision !== revision || check.contentFingerprintAfter.headRevision !== revision ||
      check.command !== trustedVerification.command ||
      check.args.length !== trustedVerification.args.length ||
      check.args.some((arg, index) => arg !== trustedVerification.args[index]) ||
      !fingerprintsCompatible(check.contentFingerprintBefore, check.contentFingerprintAfter, check.snapshotManifest).ok) {
    return unavailable("check does not match its host observation binding");
  }
  if (check.processStatus !== "completed" || check.processCleanupUnsettled === true ||
      check.processSignal !== null || check.processExitCode !== check.exitCode) {
    return unavailable("check process did not complete with settled effects");
  }
  if (check.exitCode === 0) {
    return check.ok ? Object.freeze({ state: "available", findings: Object.freeze([]) }) :
      unavailable("check evidence is incomplete");
  }
  const evidenceRef = check.checkId;
  const criterionId = "host-check";
  const finding: BoundCheckFinding = Object.freeze({
    id: JSON.stringify(["host-check-finding", runId, revision, generation, evidenceRef, criterionId, check.exitCode]),
    criterionId, severity: "major", message: `Host verification completed with a failing exit code (${check.exitCode}).`,
    evidenceRef, runId, revision, generation
  });
  return Object.freeze({ state: "available", findings: Object.freeze([finding]) });
}

/**
 * Match exact versions and retain historical observations, as evaluation
 * invalidation does. These are Findings, not synthetic EvaluationRecords.
 * Tuple IDs coalesce the same observation/cause; fresh evidence remains visible.
 */
export function partitionCurrentFindings(
  findings: readonly BoundCheckFinding[],
  reference: { readonly revision: string; readonly generation: string }
): { readonly current: readonly BoundCheckFinding[]; readonly stale: readonly BoundCheckFinding[] } {
  const current: BoundCheckFinding[] = [];
  const stale: BoundCheckFinding[] = [];
  const seen = new Set<string>();
  for (const finding of findings) {
    const identity = JSON.stringify([finding.runId, finding.revision, finding.generation, finding.evidenceRef, finding.criterionId, finding.id]);
    if (seen.has(identity)) continue;
    seen.add(identity);
    (finding.revision === reference.revision && finding.generation === reference.generation ? current : stale).push(finding);
  }
  return Object.freeze({ current: Object.freeze(current), stale: Object.freeze(stale) });
}
