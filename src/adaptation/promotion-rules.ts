import { DomainValidationError } from "../domain/errors.js";
import { isCandidateId, isResourceVersionId } from "../domain/ids.js";
import type { ResourceVersionId } from "../domain/ids.js";
import { assertCanPromoteFromReview } from "../review/self-review.js";
import { validateComparisonReport } from "../experiments/comparison-report.js";
import { hashCandidateContent } from "./candidate.js";
import type { CandidateStatus, ImprovementCandidate } from "./candidate.js";
import type { AuthorIdentity } from "./resource.js";
import type { ChangeNote, PromoteInput, PromotionReview } from "./promotion.js";

/**
 * Pure promotion gate rules shared by the registry (CAS promotion) and the
 * promotion service. Keeping them here — with no registry import — breaks the
 * registry ↔ promotion module cycle so the promotion loaders can import the
 * registry statically.
 */

const PROMOTABLE_STATUSES: readonly CandidateStatus[] = ["proposed", "evaluating", "approved"];
const INTENT_ID_PATTERN = /^int_[A-Za-z0-9_-]{1,64}$/;

export function isPromotableStatus(status: CandidateStatus): boolean {
  return PROMOTABLE_STATUSES.includes(status);
}

export function validateChangeNote(
  note: ChangeNote,
  expectedCurrentVersionId: ResourceVersionId
): void {
  if (typeof note.scope !== "string" || note.scope.trim() === "") {
    throw new DomainValidationError("change note scope is required");
  }
  if (!Array.isArray(note.evidence) || note.evidence.length === 0) {
    throw new DomainValidationError("change note must include evidence");
  }
  for (const item of note.evidence) {
    if (typeof item !== "string" || item.trim() === "") {
      throw new DomainValidationError("change note evidence entries must be non-empty strings");
    }
  }
  if (!Array.isArray(note.guardrails) || note.guardrails.length === 0) {
    throw new DomainValidationError("change note must include guardrails");
  }
  for (const item of note.guardrails) {
    if (typeof item !== "string" || item.trim() === "") {
      throw new DomainValidationError("change note guardrail entries must be non-empty strings");
    }
  }
  if (!isResourceVersionId(note.rollbackVersionId)) {
    throw new DomainValidationError(
      `change note rollbackVersionId is invalid: ${String(note.rollbackVersionId)}`
    );
  }
  if (note.rollbackVersionId !== expectedCurrentVersionId) {
    throw new DomainValidationError(
      `change note rollbackVersionId must equal expected current version ${expectedCurrentVersionId}`
    );
  }
}

export function validatePromotionReview(
  review: PromotionReview | undefined
): asserts review is PromotionReview {
  if (
    review === undefined ||
    typeof review.reviewId !== "string" ||
    review.reviewId.trim() === "" ||
    !isCandidateId(review.candidateId) ||
    typeof review.contentHash !== "string" ||
    review.contentHash.trim() === "" ||
    review.verdict !== "approved" ||
    typeof review.reviewerId !== "string" ||
    typeof review.actorId !== "string" ||
    review.reviewerId.trim() === "" ||
    review.actorId.trim() === "" ||
    !Array.isArray(review.evidenceRefs) ||
    review.evidenceRefs.length === 0 ||
    review.evidenceRefs.some((ref) => typeof ref !== "string" || ref.trim() === "")
  ) {
    throw new DomainValidationError("approved promotion review provenance is required");
  }
  assertCanPromoteFromReview(review);
}

export function assertExplicitApprovalActor(approvedBy: AuthorIdentity): void {
  if (approvedBy.identity.trim() === "") {
    throw new DomainValidationError("approvedBy identity is required");
  }
  if (approvedBy.kind === "human") {
    return;
  }
  if (approvedBy.kind === "model") {
    throw new DomainValidationError("model cannot promote");
  }
  throw new DomainValidationError("self-review cannot promote");
}

export function isIntentId(value: unknown): value is string {
  return typeof value === "string" && INTENT_ID_PATTERN.test(value);
}

export function intentIdFor(versionId: ResourceVersionId): string {
  return `int_${versionId.slice("rsv_".length)}`;
}

export function assertRoutingPolicyEvalReport(
  candidate: ImprovementCandidate,
  input: PromoteInput
): void {
  if (candidate.identity.kind !== "routing-policy") {
    return;
  }
  const report = input.evalReport;
  if (report === undefined) {
    throw new DomainValidationError("routing-policy promote requires evalReport");
  }
  const contentHash = hashCandidateContent(input.content);
  if (report.contentHash !== candidate.contentHash || report.contentHash !== contentHash) {
    throw new DomainValidationError(
      "eval report contentHash must equal the candidate contentHash and the promoted content hash"
    );
  }
  if (report.evidenceClass !== "replay") {
    throw new DomainValidationError("eval report evidenceClass must be replay");
  }
  if (report.comparison.evidenceClass === "production") {
    throw new DomainValidationError(
      "routing-policy promote refuses a production-labeled comparison"
    );
  }
  const provisional =
    report.comparison.utilityDelta.provisional === true ||
    report.comparison.costDelta.provisional === true;
  if (provisional) {
    const claimsEmpty = report.comparison.claims.length === 0;
    if (input.review.acceptProvisional !== false || !claimsEmpty) {
      throw new DomainValidationError(
        "provisional eval report is not approval material unless review.acceptProvisional is false and claims are empty"
      );
    }
  }
  const validation = validateComparisonReport(report.comparison);
  if (!validation.valid) {
    throw new DomainValidationError(
      `eval comparison report invalid: ${validation.reasons.join("; ")}`
    );
  }
}
