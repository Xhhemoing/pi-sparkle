import { DomainValidationError } from "../domain/errors.js";
import { hash32 } from "../domain/hash.js";
import { isCandidateId, isResourceVersionId } from "../domain/ids.js";
import type { CandidateId, ResourceVersionId } from "../domain/ids.js";
import { isIsoTimestamp } from "../domain/timestamp.js";
import type { IsoTimestamp } from "../domain/timestamp.js";
import { isRecord } from "../domain/record.js";
import type { AuthorIdentity, ResourceIdentity, ResourceKind } from "./resource.js";
import { RESOURCE_KINDS, isNonAutoPromotableKind } from "./resource.js";

export const CANDIDATE_STATUSES = [
  "proposed",
  "evaluating",
  "approved",
  "rejected",
  "retired",
] as const;

export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

/**
 * The predeclared evaluation plan every candidate must carry: which stages it
 * must pass (static, replay, holdout, canary) and which metrics it is judged
 * on. Versioned so a plan change never silently re-weights old candidates.
 */
export interface EvaluationPlan {
  readonly stages: readonly string[];
  readonly metrics: readonly string[];
  readonly planVersion: number;
}

export interface ImprovementCandidate {
  readonly candidateId: CandidateId;
  readonly identity: ResourceIdentity;
  /** hash32 over the candidate content; a declared hash must match it. */
  readonly contentHash: string;
  readonly parentVersionId: ResourceVersionId;
  readonly author: AuthorIdentity;
  readonly status: CandidateStatus;
  readonly evaluationPlan: EvaluationPlan;
  /**
   * Derived from the resource kind — permission/security/credential targets
   * are always false and this cannot be overridden by input.
   */
  readonly autoPromotable: boolean;
  readonly createdAt: IsoTimestamp;
}

export interface CandidateInput {
  readonly identity: ResourceIdentity;
  readonly content: string;
  /** Optional predeclared hash; fails closed when it disagrees with the content. */
  readonly declaredHash?: string;
  readonly parentVersionId: ResourceVersionId;
  readonly author: AuthorIdentity;
  readonly evaluationPlan: EvaluationPlan;
}

const HASH_PATTERN = /^[0-9a-f]{1,8}$/;

export function candidateError(candidate: ImprovementCandidate): string | undefined {
  if (!isCandidateId(candidate.candidateId)) {
    return `invalid candidate id: ${String(candidate.candidateId)}`;
  }
  if (!isResourceVersionId(candidate.parentVersionId)) {
    return `invalid parent version id: ${String(candidate.parentVersionId)}`;
  }
  const { identity } = candidate;
  if (identity.name.trim() === "") {
    return "candidate name is required";
  }
  if (!RESOURCE_KINDS.includes(identity.kind)) {
    return `invalid candidate kind: ${String(identity.kind)}`;
  }
  if (identity.scope.kind !== "project" && identity.scope.kind !== "user-global") {
    return "candidate scope is invalid";
  }
  if (typeof candidate.contentHash !== "string" || !HASH_PATTERN.test(candidate.contentHash)) {
    return `invalid contentHash: ${String(candidate.contentHash)}`;
  }
  if (candidate.author.identity.trim() === "") {
    return "candidate author identity is required";
  }
  if (!CANDIDATE_STATUSES.includes(candidate.status)) {
    return `invalid candidate status: ${String(candidate.status)}`;
  }
  if (candidate.evaluationPlan.stages.length === 0) {
    return "evaluation plan requires at least one stage";
  }
  if (candidate.evaluationPlan.metrics.length === 0) {
    return "evaluation plan requires at least one metric";
  }
  if (!Number.isInteger(candidate.evaluationPlan.planVersion) || candidate.evaluationPlan.planVersion < 1) {
    return "evaluation plan version must be a positive integer";
  }
  if (!isIsoTimestamp(candidate.createdAt)) {
    return "candidate createdAt must be an ISO timestamp";
  }
  return undefined;
}

export function validateCandidate(candidate: ImprovementCandidate): void {
  const error = candidateError(candidate);
  if (error !== undefined) {
    throw new DomainValidationError(error);
  }
}

export function isCandidate(value: unknown): value is ImprovementCandidate {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return candidateError(value as ImprovementCandidate) === undefined;
}

export function autoPromotableFor(kind: ResourceKind): boolean {
  return !isNonAutoPromotableKind(kind);
}

/**
 * Walk the parent chain from `startId`. Fails closed on any cycle — lineage
 * must remain a DAG no matter how the registry is mutated later.
 */
export function assertAcyclicLineage(
  startId: string,
  parentOf: (id: string) => string | undefined
): void {
  const visited = new Set<string>([startId]);
  let current: string | undefined = parentOf(startId);
  while (current !== undefined) {
    if (visited.has(current)) {
      throw new DomainValidationError(`cyclic candidate lineage detected at ${current}`);
    }
    visited.add(current);
    current = parentOf(current);
  }
}

/** Compute the content hash a candidate must carry. */
export function hashCandidateContent(content: string): string {
  return hash32(content);
}

export function assertSingleResourceBoundary(identity: ResourceIdentity, content: string): void {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return;
  }
  if (!isRecord(parsed)) return;
  if (Array.isArray(parsed.kinds)) {
    const named = parsed.kinds.filter((kind): kind is string => typeof kind === "string");
    const unique = new Set(named);
    if (unique.size > 1 || (named[0] !== undefined && named[0] !== identity.kind)) {
      throw new DomainValidationError("candidate must declare a single resource boundary");
    }
  }
  if ("targetResource" in parsed && "extraKind" in parsed) {
    throw new DomainValidationError("candidate must declare a single resource boundary");
  }
  if (typeof parsed.extraKind === "string" && parsed.extraKind !== identity.kind) {
    throw new DomainValidationError("candidate must declare a single resource boundary");
  }
}
