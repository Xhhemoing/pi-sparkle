import { DomainValidationError } from "../domain/errors.js";
import type { RetentionPolicy as AgeRetentionPolicy } from "../privacy/retention.js";

/**
 * PS-P4 evidence retention for holdout armRuns: keep de-sensitized
 * per-invocation raw evidence by default (not aggregates-only after temp
 * cleanup). Wired so delete/retention tooling can refuse silent raw drops.
 */

export type EvidenceRetentionMode = "keep-raw" | "aggregates-only";

export interface EvidenceRetentionPolicy {
  readonly mode: EvidenceRetentionMode;
  /**
   * When mode is aggregates-only, raw evidence older than this many days may
   * be pruned. Ignored for keep-raw.
   */
  readonly maxRawAgeDays?: number | undefined;
  /** Optional pointer into the shared age-based retention policy. */
  readonly agePolicy?: AgeRetentionPolicy | undefined;
}

/** Default for F6 holdout armRuns: retain raw (redacted) evidence for audit. */
export const DEFAULT_HOLDOUT_EVIDENCE_RETENTION: EvidenceRetentionPolicy = {
  mode: "keep-raw"
};

export function validateEvidenceRetentionPolicy(
  policy: EvidenceRetentionPolicy
): EvidenceRetentionPolicy {
  if (policy.mode !== "keep-raw" && policy.mode !== "aggregates-only") {
    throw new DomainValidationError(`unknown evidence retention mode: ${String(policy.mode)}`);
  }
  if (policy.mode === "aggregates-only") {
    if (
      policy.maxRawAgeDays !== undefined &&
      (!Number.isFinite(policy.maxRawAgeDays) || policy.maxRawAgeDays <= 0)
    ) {
      throw new DomainValidationError("aggregates-only maxRawAgeDays must be a positive finite number");
    }
  }
  return policy;
}

export function shouldRetainRawEvidence(policy: EvidenceRetentionPolicy): boolean {
  return validateEvidenceRetentionPolicy(policy).mode === "keep-raw";
}

/**
 * Delete/retention gate: refuse to drop raw holdout evidence under keep-raw.
 * Aggregates-only callers must pass `aggregatePublished: true`.
 */
export function assertRawEvidenceDeletionAllowed(input: {
  readonly policy: EvidenceRetentionPolicy;
  readonly target: "raw" | "aggregate";
  readonly aggregatePublished?: boolean | undefined;
}): void {
  const policy = validateEvidenceRetentionPolicy(input.policy);
  if (input.target === "aggregate") return;
  if (policy.mode === "keep-raw") {
    throw new DomainValidationError(
      "evidence retention policy is keep-raw; refusing to delete raw holdout armRun evidence"
    );
  }
  if (policy.mode === "aggregates-only" && input.aggregatePublished !== true) {
    throw new DomainValidationError(
      "aggregates-only retention refuses raw delete before aggregates are published"
    );
  }
}
