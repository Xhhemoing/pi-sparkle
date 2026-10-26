import { DomainValidationError } from "../../domain/errors.js";
import { isDeepStrictEqual, types } from "node:util";
import { isCandidateId, isProjectId, isResourceVersionId } from "../../domain/ids.js";
import type { ResourceVersionId } from "../../domain/ids.js";
import { assertCanPromoteFromReview } from "../../review/self-review.js";
import { validateComparisonReport } from "../experiments/comparison-report.js";
import { hashCandidateContent } from "./candidate.js";
import type { CandidateStatus, ImprovementCandidate } from "./candidate.js";
import { identityEquals, type AuthorIdentity, type ResourceIdentity } from "./resource.js";
import { parseTaskResourceContent, TASK_RESOURCE_TOPICS } from "./task-resources.js";
import type { ChangeNote, ManualDelegatedApproval, PromoteInput, PromotionReview } from "./promotion.js";

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

/** The bounded R3 model path stays manual even when persisted flags claim otherwise. */
export function requiresManualR3Approval(approvedBy: AuthorIdentity, resource: ResourceIdentity): boolean {
  return approvedBy.kind === "model" && resource.scope.kind === "project" &&
    TASK_RESOURCE_TOPICS.some(topic => topic === resource.name) &&
    resource.kind === (resource.name === "node-preparation" || resource.name === "check-recipes" ? "workflow-template" : "prompt");
}

/** Strict, detached audit data. Only the host's nonserialized registry options grant authority. */
export function snapshotManualDelegatedApproval(value: unknown): ManualDelegatedApproval {
  const fail = (): never => { throw new DomainValidationError("invalid R3 manual delegated approval authority"); };
  const record = (raw: unknown, keys: readonly string[]): Record<string, unknown> => {
    if (typeof raw !== "object" || raw === null || types.isProxy(raw) ||
        (Object.getPrototypeOf(raw) !== Object.prototype && Object.getPrototypeOf(raw) !== null)) return fail();
    const properties = Object.getOwnPropertyDescriptors(raw);
    if (Reflect.ownKeys(raw).length !== keys.length || keys.some(key => !Object.hasOwn(properties, key)) ||
        Reflect.ownKeys(raw).some(key => typeof key !== "string" || !keys.includes(key)) ||
        Object.values(properties).some(property => !("value" in property))) return fail();
    return Object.fromEntries(keys.map(key => [key, properties[key]!.value]));
  };
  const text = (raw: unknown): string => {
    if (typeof raw !== "string" || !raw.trim() || raw.includes("\0") || raw.length > 4096) return fail();
    return raw;
  };
  const raw = record(value, ["mode", "delegator", "delegate", "ownerInstructionRef", "candidateId", "contentHash", "expectedCurrentVersionId", "resource"]);
  const delegator = record(raw.delegator, ["kind", "identity"]), delegate = record(raw.delegate, ["kind", "identity"]);
  const resource = record(raw.resource, ["kind", "name", "scope"]), scope = record(resource.scope, ["kind", "projectId"]);
  const resourceKind = resource.name === "node-preparation" || resource.name === "check-recipes" ? "workflow-template" : "prompt";
  if (raw.mode !== "r3-manual" || delegator.kind !== "human" || delegate.kind !== "model" ||
      !isCandidateId(raw.candidateId) || !isResourceVersionId(raw.expectedCurrentVersionId)) return fail();
  if (scope.kind !== "project" || !isProjectId(scope.projectId) || !TASK_RESOURCE_TOPICS.some(topic => topic === resource.name) ||
      resource.kind !== resourceKind) {
    throw new DomainValidationError("R3 delegated authority requires an exact project-scoped real-task resource");
  }
  const ownerIdentity = text(delegator.identity), delegateIdentity = text(delegate.identity);
  if (ownerIdentity === delegateIdentity) return fail();
  return Object.freeze({ mode: "r3-manual", delegator: Object.freeze({ kind: "human", identity: ownerIdentity }),
    delegate: Object.freeze({ kind: "model", identity: delegateIdentity }), ownerInstructionRef: text(raw.ownerInstructionRef),
    candidateId: raw.candidateId, contentHash: text(raw.contentHash), expectedCurrentVersionId: raw.expectedCurrentVersionId,
    resource: Object.freeze({ kind: resourceKind, name: resource.name as string, scope: Object.freeze({ kind: "project", projectId: scope.projectId }) }) });
}

/** Validate audit bindings without treating serialized metadata as a live grant. */
export function validateManualDelegatedPromotion(input: {
  readonly approval: ManualDelegatedApproval; readonly candidate: ImprovementCandidate;
  readonly expectedCurrentVersionId: ResourceVersionId; readonly approvedBy: AuthorIdentity;
  readonly review: PromotionReview | undefined; readonly content: string | undefined;
}): ManualDelegatedApproval {
  const approval = snapshotManualDelegatedApproval(input.approval), { candidate, review } = input;
  if (approval.candidateId !== candidate.candidateId || approval.contentHash !== candidate.contentHash ||
      approval.expectedCurrentVersionId !== input.expectedCurrentVersionId || !identityEquals(approval.resource, candidate.identity) ||
      !isDeepStrictEqual(approval.delegate, input.approvedBy)) {
    throw new DomainValidationError("delegated approval does not match the exact candidate, current version, resource or decision author");
  }
  validatePromotionReview(review);
  if (review.reviewerKind !== "independent" || review.actorId !== candidate.author.identity ||
      review.candidateId !== candidate.candidateId || review.contentHash !== candidate.contentHash) {
    throw new DomainValidationError("delegated approval requires exact independent candidate review");
  }
  if (input.content === undefined) throw new DomainValidationError("delegated approval requires actual real-task resource content");
  const content = parseTaskResourceContent(input.content);
  if (content.topic !== candidate.identity.name) throw new DomainValidationError("delegated approval real-task content topic mismatch");
  return approval;
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
  // Legacy reports retain aggregates and changed-route diffs, not every raw
  // pair. This check is structural only; it does not verify unique evidence.
  // Requiring raw-source recomputation here needs a compatible evaluator/CLI
  // evidence path. Explicit approval and the existing replay-only boundary
  // remain required; this is not independent production acceptance evidence.
  const validation = validateComparisonReport(report.comparison);
  if (!validation.valid) {
    throw new DomainValidationError(
      `eval comparison report invalid: ${validation.reasons.join("; ")}`
    );
  }
}
