import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { DomainValidationError } from "../domain/errors.js";
import { isCandidateId, isProjectId, isResourceVersionId } from "../domain/ids.js";
import type { CandidateId, ResourceVersionId } from "../domain/ids.js";
import { isIsoTimestamp } from "../domain/timestamp.js";
import type { IsoTimestamp } from "../domain/timestamp.js";
import {
  assertCanPromoteFromReview,
  type ReviewerKind
} from "../review/self-review.js";
import { withExclusiveFileLock } from "../persist/file-lock.js";
import { validateComparisonReport } from "../experiments/comparison-report.js";
import type { ApprovalProfile } from "./approval-profile.js";
import { CANDIDATE_STATUSES, hashCandidateContent } from "./candidate.js";
import type { CandidateStatus, EvaluationPlan, ImprovementCandidate } from "./candidate.js";
import type { RoutingEvalReport } from "./eval-routing.js";
import type { ResourceRegistry, RegistryOptions } from "./registry.js";
import type { AuthorIdentity, ResourceIdentity, ResourceKind, ResourceScope, ResourceVersion } from "./resource.js";
import { RESOURCE_KINDS } from "./resource.js";
import { parseRollbackLedgerEntry } from "./rollback.js";
import type { RollbackLedgerEntry } from "./rollback.js";

export interface ChangeNote {
  readonly scope: string;
  readonly evidence: readonly string[];
  readonly guardrails: readonly string[];
  readonly rollbackVersionId: ResourceVersionId;
}

export interface PromotionReview {
  readonly reviewId: string;
  readonly candidateId: CandidateId;
  readonly contentHash: string;
  readonly verdict: "approved" | "rejected";
  readonly reviewerKind: ReviewerKind;
  readonly reviewerId: string;
  readonly actorId: string;
  readonly evidenceRefs: readonly string[];
  readonly acceptProvisional?: boolean | undefined;
}

export interface PromoteInput {
  readonly candidateId: CandidateId;
  readonly expectedCurrentVersionId: ResourceVersionId;
  readonly content: string;
  readonly approvedBy: AuthorIdentity;
  readonly review: PromotionReview;
  readonly changeNote: ChangeNote;
  readonly approvalProfile?: ApprovalProfile | undefined;
  /** If false/undefined, require explicit human approval (approvedBy.kind === "human"). */
  readonly explicitApproval: boolean;
  /** Required when candidate.identity.kind === "routing-policy"; missing/undefined refuses. */
  readonly evalReport?: RoutingEvalReport | undefined;
}

export interface PromotionLedgerEntry {
  readonly kind: "promoted" | "rejected" | "intent";
  readonly candidateId: CandidateId;
  readonly fromVersionId: ResourceVersionId;
  readonly toVersionId?: ResourceVersionId | undefined;
  readonly expectedCurrentVersionId: ResourceVersionId;
  readonly approvedBy: AuthorIdentity;
  readonly review?: PromotionReview | undefined;
  readonly changeNote: ChangeNote;
  readonly at: IsoTimestamp;
}

export function reconstructPromotion(ledger: readonly PromotionLedgerEntry[]): {
  readonly parentVersionId: ResourceVersionId;
  readonly candidateId: CandidateId;
  readonly expectedCurrentVersionId: ResourceVersionId;
  readonly toVersionId?: ResourceVersionId;
  readonly approvedBy?: AuthorIdentity;
  readonly rollbackVersionId?: ResourceVersionId;
} {
  let last: PromotionLedgerEntry | undefined;
  for (const entry of ledger) {
    if (entry.kind === "promoted") last = entry;
  }
  if (last === undefined) {
    throw new DomainValidationError("promotion ledger has no promoted entry");
  }
  return {
    parentVersionId: last.fromVersionId,
    candidateId: last.candidateId,
    expectedCurrentVersionId: last.expectedCurrentVersionId,
    ...(last.toVersionId !== undefined ? { toVersionId: last.toVersionId } : {}),
    approvedBy: last.approvedBy,
    rollbackVersionId: last.changeNote.rollbackVersionId
  };
}

export interface PromotionResult {
  readonly ok: boolean;
  readonly newVersion?: ResourceVersion | undefined;
  readonly ledger: readonly PromotionLedgerEntry[];
}

export interface BeginPromotionResult {
  readonly intentId: string;
  readonly pendingVersion: ResourceVersion;
  readonly ledger: readonly PromotionLedgerEntry[];
}

export interface PendingPromotion {
  readonly intentId: string;
  readonly candidateId: CandidateId;
  readonly expectedCurrentVersionId: ResourceVersionId;
  readonly pendingVersionId: ResourceVersionId;
  readonly approvedBy: AuthorIdentity;
  readonly review?: PromotionReview | undefined;
  readonly changeNote: ChangeNote;
  readonly usedAutoPromote: boolean;
}

export interface ResourceRegistrySnapshot {
  readonly versions: readonly ResourceVersion[];
  readonly activeVersionIds: readonly ResourceVersionId[];
  readonly candidates: readonly ImprovementCandidate[];
  readonly ledger: readonly PromotionLedgerEntry[];
  readonly pending: readonly PendingPromotion[];
  readonly autoPromotionsUsed: number;
  readonly rollbackLedger?: readonly RollbackLedgerEntry[] | undefined;
  readonly retiredVersionIds?: readonly ResourceVersionId[] | undefined;
  /** Content blobs keyed by contentHash. Optional for snapshots written before this field. */
  readonly contents?: readonly { readonly hash: string; readonly content: string }[] | undefined;
}

const PROMOTABLE_STATUSES: readonly CandidateStatus[] = ["proposed", "evaluating", "approved"];
const LEDGER_KINDS = ["promoted", "rejected", "intent"] as const;
const AUTHOR_KINDS = ["human", "model", "detector"] as const;
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

/** Core promotion entry used by tests and the CLI; no filesystem. */
export function promoteWithRegistry(registry: ResourceRegistry, input: PromoteInput): PromotionResult {
  const candidate = registry.getCandidate(input.candidateId);
  if (candidate !== undefined) {
    assertRoutingPolicyEvalReport(candidate, input);
  }
  return registry.promote(input);
}

export class PromotionService {
  constructor(private readonly registry: ResourceRegistry) {}

  beginPromotion(input: PromoteInput): BeginPromotionResult {
    const candidate = this.registry.getCandidate(input.candidateId);
    if (candidate !== undefined) {
      assertRoutingPolicyEvalReport(candidate, input);
    }
    return this.registry.beginPromotion(input);
  }

  commitPromotion(intentId: string): PromotionResult {
    return this.registry.commitPromotion(intentId);
  }

  promote(input: PromoteInput): PromotionResult {
    return promoteWithRegistry(this.registry, input);
  }
}

export function adaptationRegistryPath(stateRoot: string): string {
  return join(stateRoot, "adaptation", "registry.json");
}

export async function loadAdaptationRegistry(
  stateRoot: string,
  options?: RegistryOptions
): Promise<ResourceRegistry> {
  const path = adaptationRegistryPath(stateRoot);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error: unknown) {
    const code = error !== null && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      throw new DomainValidationError(`no registry snapshot at ${path}`);
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new DomainValidationError(`invalid registry snapshot at ${path}`);
  }
  const snapshot = parseRegistrySnapshot(parsed);
  const { ResourceRegistry: Registry } = await import("./registry.js");
  return Registry.fromSnapshot(snapshot, options);
}

export async function saveAdaptationRegistry(
  stateRoot: string,
  registry: ResourceRegistry
): Promise<void> {
  const path = adaptationRegistryPath(stateRoot);
  const serialized = `${JSON.stringify(registry.snapshot(), null, 2)}\n`;
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(tempPath, "wx");
  try {
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

export function withAdaptationRegistryLock<T>(
  stateRoot: string,
  operation: () => Promise<T>,
  options?: { readonly timeoutMs?: number; readonly retryMs?: number }
): Promise<T> {
  return withExclusiveFileLock(`${adaptationRegistryPath(stateRoot)}.lock`, operation, options);
}

export function parseRegistrySnapshot(value: unknown): ResourceRegistrySnapshot {
  const record = asRecord(value, "registry snapshot");
  const versions = asArray(record.versions, "versions").map(parseResourceVersion);
  const activeVersionIds = asArray(record.activeVersionIds, "activeVersionIds").map((id, index) => {
    if (!isResourceVersionId(id)) {
      throw new DomainValidationError(`activeVersionIds[${index}] is not a ResourceVersionId`);
    }
    return id;
  });
  const candidates = asArray(record.candidates, "candidates").map(parseCandidate);
  const ledger = asArray(record.ledger, "ledger").map(parseLedgerEntry);
  const pending = asArray(record.pending, "pending").map(parsePending);
  const autoPromotionsUsed = record.autoPromotionsUsed;
  if (!Number.isInteger(autoPromotionsUsed) || (autoPromotionsUsed as number) < 0) {
    throw new DomainValidationError("autoPromotionsUsed must be an integer >= 0");
  }
  const rollbackLedger =
    record.rollbackLedger === undefined
      ? []
      : asArray(record.rollbackLedger, "rollbackLedger").map(parseRollbackLedgerEntry);
  const retiredVersionIds =
    record.retiredVersionIds === undefined
      ? []
      : asArray(record.retiredVersionIds, "retiredVersionIds").map((id, index) => {
          if (!isResourceVersionId(id)) {
            throw new DomainValidationError(`retiredVersionIds[${index}] is not a ResourceVersionId`);
          }
          return id;
        });
  const contents =
    record.contents === undefined
      ? []
      : asArray(record.contents, "contents").map((entry, index) => {
          const blob = asRecord(entry, `contents[${index}]`);
          if (typeof blob.hash !== "string" || blob.hash.trim() === "") {
            throw new DomainValidationError(`contents[${index}].hash is required`);
          }
          if (typeof blob.content !== "string") {
            throw new DomainValidationError(`contents[${index}].content must be a string`);
          }
          return { hash: blob.hash, content: blob.content };
        });
  return {
    versions,
    activeVersionIds,
    candidates,
    ledger,
    pending,
    autoPromotionsUsed: autoPromotionsUsed as number,
    rollbackLedger,
    retiredVersionIds,
    contents
  };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DomainValidationError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new DomainValidationError(`${label} must be an array`);
  }
  return value;
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new DomainValidationError(`${label} must be an array of strings`);
  }
  return value as string[];
}

function parseAuthor(value: unknown, label: string): AuthorIdentity {
  const record = asRecord(value, label);
  if (typeof record.kind !== "string" || !(AUTHOR_KINDS as readonly string[]).includes(record.kind)) {
    throw new DomainValidationError(`${label}.kind is invalid`);
  }
  if (typeof record.identity !== "string" || record.identity.trim() === "") {
    throw new DomainValidationError(`${label}.identity is required`);
  }
  return { kind: record.kind as AuthorIdentity["kind"], identity: record.identity };
}

function parseScope(value: unknown): ResourceScope {
  const record = asRecord(value, "scope");
  if (record.kind === "user-global") {
    return { kind: "user-global" };
  }
  if (record.kind === "project") {
    if (!isProjectId(record.projectId)) {
      throw new DomainValidationError("project scope requires a valid projectId");
    }
    return { kind: "project", projectId: record.projectId };
  }
  throw new DomainValidationError("scope kind must be project or user-global");
}

function parseIdentity(value: unknown): ResourceIdentity {
  const record = asRecord(value, "identity");
  if (typeof record.kind !== "string" || !RESOURCE_KINDS.includes(record.kind as ResourceKind)) {
    throw new DomainValidationError(`invalid resource kind: ${String(record.kind)}`);
  }
  if (typeof record.name !== "string" || record.name.trim() === "") {
    throw new DomainValidationError("resource name is required");
  }
  return {
    kind: record.kind as ResourceKind,
    name: record.name,
    scope: parseScope(record.scope)
  };
}

function parseResourceVersion(value: unknown): ResourceVersion {
  const record = asRecord(value, "resource version");
  if (!isResourceVersionId(record.versionId)) {
    throw new DomainValidationError(`invalid version id: ${String(record.versionId)}`);
  }
  if (typeof record.contentHash !== "string" || record.contentHash.trim() === "") {
    throw new DomainValidationError("version contentHash is required");
  }
  if (!isIsoTimestamp(record.createdAt)) {
    throw new DomainValidationError("version createdAt must be an ISO timestamp");
  }
  let parentVersionId: ResourceVersionId | undefined;
  if (record.parentVersionId !== undefined && record.parentVersionId !== null) {
    if (!isResourceVersionId(record.parentVersionId)) {
      throw new DomainValidationError(`invalid parentVersionId: ${String(record.parentVersionId)}`);
    }
    parentVersionId = record.parentVersionId;
  }
  return {
    versionId: record.versionId,
    identity: parseIdentity(record.identity),
    contentHash: record.contentHash,
    author: parseAuthor(record.author, "version.author"),
    parentVersionId,
    createdAt: record.createdAt
  };
}

function parseEvaluationPlan(value: unknown): EvaluationPlan {
  const record = asRecord(value, "evaluationPlan");
  const stages = asStringArray(record.stages, "evaluationPlan.stages");
  const metrics = asStringArray(record.metrics, "evaluationPlan.metrics");
  if (!Number.isInteger(record.planVersion) || (record.planVersion as number) < 1) {
    throw new DomainValidationError("evaluation plan version must be a positive integer");
  }
  return { stages, metrics, planVersion: record.planVersion as number };
}

function parseCandidate(value: unknown): ImprovementCandidate {
  const record = asRecord(value, "candidate");
  if (!isCandidateId(record.candidateId)) {
    throw new DomainValidationError(`invalid candidate id: ${String(record.candidateId)}`);
  }
  if (!isResourceVersionId(record.parentVersionId)) {
    throw new DomainValidationError(`invalid candidate parentVersionId: ${String(record.parentVersionId)}`);
  }
  if (typeof record.contentHash !== "string" || record.contentHash.trim() === "") {
    throw new DomainValidationError("candidate contentHash is required");
  }
  if (typeof record.status !== "string" || !(CANDIDATE_STATUSES as readonly string[]).includes(record.status)) {
    throw new DomainValidationError(`invalid candidate status: ${String(record.status)}`);
  }
  if (typeof record.autoPromotable !== "boolean") {
    throw new DomainValidationError("candidate autoPromotable must be a boolean");
  }
  if (!isIsoTimestamp(record.createdAt)) {
    throw new DomainValidationError("candidate createdAt must be an ISO timestamp");
  }
  return {
    candidateId: record.candidateId,
    identity: parseIdentity(record.identity),
    contentHash: record.contentHash,
    parentVersionId: record.parentVersionId,
    author: parseAuthor(record.author, "candidate.author"),
    status: record.status as CandidateStatus,
    evaluationPlan: parseEvaluationPlan(record.evaluationPlan),
    autoPromotable: record.autoPromotable,
    createdAt: record.createdAt
  };
}

function parseChangeNote(value: unknown): ChangeNote {
  const record = asRecord(value, "changeNote");
  if (!isResourceVersionId(record.rollbackVersionId)) {
    throw new DomainValidationError("changeNote.rollbackVersionId is invalid");
  }
  return {
    scope: typeof record.scope === "string" ? record.scope : "",
    evidence: asStringArray(record.evidence, "changeNote.evidence"),
    guardrails: asStringArray(record.guardrails, "changeNote.guardrails"),
    rollbackVersionId: record.rollbackVersionId
  };
}

function parseLedgerEntry(value: unknown): PromotionLedgerEntry {
  const record = asRecord(value, "ledger entry");
  if (typeof record.kind !== "string" || !(LEDGER_KINDS as readonly string[]).includes(record.kind)) {
    throw new DomainValidationError(`invalid ledger kind: ${String(record.kind)}`);
  }
  if (!isCandidateId(record.candidateId)) {
    throw new DomainValidationError("ledger candidateId is invalid");
  }
  if (!isResourceVersionId(record.fromVersionId)) {
    throw new DomainValidationError("ledger fromVersionId is invalid");
  }
  if (!isResourceVersionId(record.expectedCurrentVersionId)) {
    throw new DomainValidationError("ledger expectedCurrentVersionId is invalid");
  }
  if (!isIsoTimestamp(record.at)) {
    throw new DomainValidationError("ledger at must be an ISO timestamp");
  }
  let toVersionId: ResourceVersionId | undefined;
  if (record.toVersionId !== undefined && record.toVersionId !== null) {
    if (!isResourceVersionId(record.toVersionId)) {
      throw new DomainValidationError("ledger toVersionId is invalid");
    }
    toVersionId = record.toVersionId;
  }
  const entry: PromotionLedgerEntry = {
    kind: record.kind as PromotionLedgerEntry["kind"],
    candidateId: record.candidateId,
    fromVersionId: record.fromVersionId,
    expectedCurrentVersionId: record.expectedCurrentVersionId,
    approvedBy: parseAuthor(record.approvedBy, "ledger.approvedBy"),
    ...(record.review !== undefined ? { review: parsePromotionReview(record.review) } : {}),
    changeNote: parseChangeNote(record.changeNote),
    at: record.at
  };
  return toVersionId === undefined ? entry : { ...entry, toVersionId };
}

export function parsePromotionReview(value: unknown): PromotionReview {
  const record = asRecord(value, "promotion review");
  if (
    record.reviewerKind !== "self" &&
    record.reviewerKind !== "peer" &&
    record.reviewerKind !== "independent"
  ) {
    throw new DomainValidationError("promotion review reviewerKind is invalid");
  }
  if (!isCandidateId(record.candidateId)) {
    throw new DomainValidationError("promotion review candidateId is invalid");
  }
  if (record.acceptProvisional !== undefined && typeof record.acceptProvisional !== "boolean") {
    throw new DomainValidationError("promotion review acceptProvisional must be a boolean");
  }
  const review: PromotionReview = {
    reviewId: typeof record.reviewId === "string" ? record.reviewId : "",
    candidateId: record.candidateId,
    contentHash: typeof record.contentHash === "string" ? record.contentHash : "",
    verdict: record.verdict === "rejected" ? "rejected" : "approved",
    reviewerKind: record.reviewerKind,
    reviewerId: typeof record.reviewerId === "string" ? record.reviewerId : "",
    actorId: typeof record.actorId === "string" ? record.actorId : "",
    evidenceRefs: asStringArray(record.evidenceRefs, "promotion review evidenceRefs"),
    ...(typeof record.acceptProvisional === "boolean"
      ? { acceptProvisional: record.acceptProvisional }
      : {})
  };
  validatePromotionReview(review);
  return review;
}

function parsePending(value: unknown): PendingPromotion {
  const record = asRecord(value, "pending promotion");
  if (!isIntentId(record.intentId)) {
    throw new DomainValidationError(`invalid intent id: ${String(record.intentId)}`);
  }
  if (!isCandidateId(record.candidateId)) {
    throw new DomainValidationError("pending candidateId is invalid");
  }
  if (!isResourceVersionId(record.expectedCurrentVersionId)) {
    throw new DomainValidationError("pending expectedCurrentVersionId is invalid");
  }
  if (!isResourceVersionId(record.pendingVersionId)) {
    throw new DomainValidationError("pending pendingVersionId is invalid");
  }
  if (typeof record.usedAutoPromote !== "boolean") {
    throw new DomainValidationError("pending usedAutoPromote must be a boolean");
  }
  return {
    intentId: record.intentId,
    candidateId: record.candidateId,
    expectedCurrentVersionId: record.expectedCurrentVersionId,
    pendingVersionId: record.pendingVersionId,
    approvedBy: parseAuthor(record.approvedBy, "pending.approvedBy"),
    ...(record.review !== undefined ? { review: parsePromotionReview(record.review) } : {}),
    changeNote: parseChangeNote(record.changeNote),
    usedAutoPromote: record.usedAutoPromote
  };
}
