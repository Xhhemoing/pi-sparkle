import type { EvaluationRecord } from "./types.js";

/**
 * Host-independent evidence invalidation (C2-evidence-2,
 * TASK-20261001-evidence-invalidation).
 *
 * Stored evaluation records bind their target artifact, rubric, evaluator, and
 * dependency snapshot at creation. This module re-checks those bindings
 * against the current reference set and classifies each record without
 * deleting, rewriting, or re-deriving anything: callers keep their bytes, and
 * "invalidated" means "no longer citable", never "gone".
 *
 * Identity comparison is exact string equality. Verifier, artifact, or
 * content identity is never inferred from revision-shaped strings, and no
 * cryptographic guarantee is claimed (ADR-008). Classification is advisory
 * until a host-dependent consumer is authorized; it does not redefine the
 * independent PASS/UNOBSERVED boundary.
 */

/** The reference set evidence is assessed against right now. */
export interface EvidenceReference {
  readonly artifactId: string;
  readonly artifactVersion: string;
  readonly rubricId: string;
  /** Rubric major version number; must match the record's persisted one exactly. */
  readonly rubricVersion: number;
  readonly evaluatorVersion: string;
  /**
   * Caller-defined dependency name → version snapshot. Coverage must be
   * exact: a record missing a name, carrying an extra one, or holding a
   * different value is not comparable and fails closed.
   */
  readonly dependencyVersions: Readonly<Record<string, string>>;
}

export type EvidenceValidityState = "valid" | "invalidated" | "foreign";

export interface EvidenceValidityVerdict {
  readonly state: EvidenceValidityState;
  /** Why the record is not citable, or why it is out of scope. Absent when valid. */
  readonly reason?: string | undefined;
}

/**
 * Classify one stored record against the current references.
 *
 * - `valid`: every reference matches exactly.
 * - `invalidated`: a relevant reference changed, or the record cannot prove
 *   its bindings (no target, or dependency snapshot coverage is not exact).
 *   The reason names the changed reference.
 * - `foreign`: the record belongs to a different artifactId. Unaffected
 *   evidence is retained this way — never invalidated by another artifact's
 *   version change, and never mixed into `valid`.
 */
export function assessEvidenceValidity(
  record: EvaluationRecord,
  reference: EvidenceReference
): EvidenceValidityVerdict {
  const target = record.target;
  if (target === undefined || target.artifactId.trim() === "") {
    return {
      state: "invalidated",
      reason: "unbound: record carries no artifact target binding",
    };
  }
  if (target.artifactId !== reference.artifactId) {
    return { state: "foreign" };
  }

  if (target.artifactVersion !== reference.artifactVersion) {
    return invalidBecause(
      "artifact version changed",
      target.artifactVersion ?? "unavailable",
      reference.artifactVersion
    );
  }
  if (record.rubricId !== reference.rubricId) {
    return invalidBecause("rubric id changed", record.rubricId, reference.rubricId);
  }
  if (record.rubricVersion !== reference.rubricVersion) {
    return invalidBecause("rubric version changed", String(record.rubricVersion), String(reference.rubricVersion));
  }
  if (record.evaluator.version !== reference.evaluatorVersion) {
    return invalidBecause("evaluator version changed", record.evaluator.version, reference.evaluatorVersion);
  }

  const snapshot = record.dependencyVersions;
  if (snapshot === undefined) {
    return {
      state: "invalidated",
      reason: "dependency snapshot unverifiable: record carries none",
    };
  }
  const recordedNames = Object.keys(snapshot);
  const currentNames = Object.keys(reference.dependencyVersions);
  const sameCoverage =
    recordedNames.length === currentNames.length &&
    recordedNames.every((name) => Object.hasOwn(reference.dependencyVersions, name));
  if (!sameCoverage) {
    return {
      state: "invalidated",
      reason: "dependency snapshot unverifiable: names do not exactly cover the current set",
    };
  }
  for (const name of currentNames) {
    const recorded = snapshot[name];
    const current = reference.dependencyVersions[name];
    if (recorded !== current) {
      return invalidBecause(`dependency ${name} version changed`, recorded ?? "unavailable", current ?? "unavailable");
    }
  }

  return { state: "valid" };
}

/**
 * Pure batch helper: partition records into citable, invalidated, and
 * foreign evidence. Inputs are never mutated and the returned arrays hold
 * the same record objects in input order.
 */
export function partitionEvidenceValidity(
  records: readonly EvaluationRecord[],
  reference: EvidenceReference
): {
  readonly valid: readonly EvaluationRecord[];
  readonly invalidated: readonly EvaluationRecord[];
  readonly foreign: readonly EvaluationRecord[];
} {
  const valid: EvaluationRecord[] = [];
  const invalidated: EvaluationRecord[] = [];
  const foreign: EvaluationRecord[] = [];
  for (const record of records) {
    const verdict = assessEvidenceValidity(record, reference);
    if (verdict.state === "valid") valid.push(record);
    else if (verdict.state === "invalidated") invalidated.push(record);
    else foreign.push(record);
  }
  return { valid, invalidated, foreign };
}

function invalidBecause(what: string, recorded: string, current: string): EvidenceValidityVerdict {
  return {
    state: "invalidated",
    reason: `${what}: recorded ${JSON.stringify(recorded)}, current ${JSON.stringify(current)}`,
  };
}
