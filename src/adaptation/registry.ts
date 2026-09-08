import { DomainValidationError } from "../domain/errors.js";
import {
  createCandidateId,
  createResourceVersionId,
  isCandidateId,
  isResourceVersionId
} from "../domain/ids.js";
import type { CandidateId, IdGenerator, ResourceVersionId } from "../domain/ids.js";
import { nowIso } from "../domain/timestamp.js";
import type { IsoTimestamp } from "../domain/timestamp.js";
import { casActivePointer, assertExpectedActive, resourceIdentityKey } from "./active-pointer.js";
import {
  canAutoPromote,
  createDefaultApprovalProfile,
  validateApprovalProfile
} from "./approval-profile.js";
import {
  assertAcyclicLineage,
  assertSingleResourceBoundary,
  autoPromotableFor,
  hashCandidateContent,
  validateCandidate
} from "./candidate.js";
import type { CandidateInput, CandidateStatus, ImprovementCandidate } from "./candidate.js";
import {
  assertExplicitApprovalActor,
  assertRoutingPolicyEvalReport,
  intentIdFor,
  isIntentId,
  isPromotableStatus,
  validateChangeNote,
  validatePromotionReview
} from "./promotion-rules.js";
import type {
  BeginPromotionResult,
  PendingPromotion,
  PromoteInput,
  PromotionLedgerEntry,
  PromotionResult,
  ResourceRegistrySnapshot
} from "./promotion.js";
import type { AuthorIdentity, ResourceIdentity, ResourceVersion } from "./resource.js";
import { identityEquals } from "./resource.js";
import { RollbackLog, validateRollbackInput } from "./rollback.js";
import type { RollbackInput, RollbackLedgerEntry } from "./rollback.js";

export interface RegistryOptions {
  readonly now?: () => IsoTimestamp;
  readonly generateId?: IdGenerator;
}

export interface BaselineInput {
  readonly identity: ResourceIdentity;
  readonly content: string;
  readonly author: AuthorIdentity;
}

/**
 * Versioned resource registry. Creating a candidate never changes the active
 * version. The active pointer moves only through baseline registration or
 * compare-and-swap promotion (M6-T5). Promotion never mutates a live run.
 */
export class ResourceRegistry {
  private readonly now: () => IsoTimestamp;
  private readonly generateId: IdGenerator;
  private readonly versionsById = new Map<ResourceVersionId, ResourceVersion>();
  private readonly versionsByKey = new Map<string, readonly ResourceVersion[]>();
  private readonly activeByKey = new Map<string, ResourceVersionId>();
  private readonly candidates = new Map<CandidateId, ImprovementCandidate>();
  private readonly ledgerEntries: PromotionLedgerEntry[] = [];
  private readonly pendingByIntent = new Map<string, PendingPromotion>();
  private readonly rollbackLog = new RollbackLog();
  private readonly retiredIds = new Set<ResourceVersionId>();
  private readonly contentsByHash = new Map<string, string>();
  private autoPromoteCount = 0;

  constructor(options: RegistryOptions = {}) {
    this.now = options.now ?? nowIso;
    this.generateId = options.generateId ?? (() => createResourceVersionId());
  }

  static fromSnapshot(snapshot: ResourceRegistrySnapshot, options: RegistryOptions = {}): ResourceRegistry {
    const registry = new ResourceRegistry(options);
    registry.restore(snapshot);
    return registry;
  }

  /** Register the original version of a resource and point the active version at it. */
  registerBaseline(input: BaselineInput): ResourceVersion {
    const key = resourceIdentityKey(input.identity);
    if (this.activeByKey.has(key)) {
      throw new DomainValidationError(`baseline already exists for resource ${key}`);
    }
    const version: ResourceVersion = {
      versionId: createResourceVersionId(this.generateId),
      identity: input.identity,
      contentHash: this.putContent(input.content),
      author: input.author,
      parentVersionId: undefined,
      createdAt: this.now()
    };
    this.addVersion(version);
    this.activeByKey.set(key, version.versionId);
    return version;
  }

  /**
   * Create an immutable improvement candidate derived from an existing
   * version. Fails closed on unknown parents, incompatible scopes, hash
   * mismatches, and cyclic lineage. Never moves the active pointer.
   */
  createCandidate(input: CandidateInput): ImprovementCandidate {
    if (input.content === "") {
      throw new DomainValidationError("candidate content must not be empty");
    }
    assertSingleResourceBoundary(input.identity, input.content);
    const parent = this.versionsById.get(input.parentVersionId);
    if (parent === undefined) {
      throw new DomainValidationError(`unknown parent version: ${String(input.parentVersionId)}`);
    }
    if (!identityEquals(parent.identity, input.identity)) {
      throw new DomainValidationError(
        `incompatible scope: candidate identity does not match parent ${String(input.parentVersionId)} ` +
          `(kind/name/scope must match exactly)`
      );
    }
    const contentHash = this.putContent(input.content);
    if (input.declaredHash !== undefined && input.declaredHash !== contentHash) {
      throw new DomainValidationError(
        `declared content hash mismatch: ${input.declaredHash} does not match content (${contentHash})`
      );
    }

    const candidate: ImprovementCandidate = {
      candidateId: createCandidateId(this.generateId),
      identity: input.identity,
      contentHash,
      parentVersionId: parent.versionId,
      author: input.author,
      status: "proposed",
      evaluationPlan: input.evaluationPlan,
      autoPromotable: autoPromotableFor(input.identity.kind),
      createdAt: this.now()
    };
    validateCandidate(candidate);
    assertAcyclicLineage(candidate.candidateId, (id) => {
      const version = this.versionsById.get(id as ResourceVersionId);
      return version?.parentVersionId;
    });
    this.candidates.set(candidate.candidateId, candidate);
    return candidate;
  }

  /** Persist content by hash. Identical content is stored once. */
  putContent(content: string): string {
    const contentHash = hashCandidateContent(content);
    this.contentsByHash.set(contentHash, content);
    return contentHash;
  }

  getContent(contentHash: string): string | undefined {
    return this.contentsByHash.get(contentHash);
  }

  /**
   * Active version plus its stored content. Missing content fails closed
   * (undefined) so callers cannot invent a sidecar policy.
   */
  getActiveContent(
    identity: ResourceIdentity
  ): { readonly version: ResourceVersion; readonly content: string } | undefined {
    const version = this.getActiveVersion(identity);
    if (version === undefined) return undefined;
    const content = this.contentsByHash.get(version.contentHash);
    if (content === undefined) return undefined;
    if (hashCandidateContent(content) !== version.contentHash) {
      throw new DomainValidationError(
        `active content hash mismatch for ${version.versionId}`
      );
    }
    return { version, content };
  }

  /** Read-only active pointer. Mutation happens only via CAS promotion. */
  getActiveVersion(identity: ResourceIdentity): ResourceVersion | undefined {
    const activeId = this.activeByKey.get(resourceIdentityKey(identity));
    if (activeId === undefined) {
      return undefined;
    }
    return this.versionsById.get(activeId);
  }

  getVersion(versionId: ResourceVersionId): ResourceVersion | undefined {
    return this.versionsById.get(versionId);
  }

  getCandidate(candidateId: CandidateId): ImprovementCandidate | undefined {
    return this.candidates.get(candidateId);
  }

  versionsFor(identity: ResourceIdentity): readonly ResourceVersion[] {
    return this.versionsByKey.get(resourceIdentityKey(identity)) ?? [];
  }

  candidatesFor(identity: ResourceIdentity): readonly ImprovementCandidate[] {
    const matching: ImprovementCandidate[] = [];
    for (const candidate of Array.from(this.candidates.values())) {
      if (identityEquals(candidate.identity, identity)) {
        matching.push(candidate);
      }
    }
    return matching;
  }

  ledger(): readonly PromotionLedgerEntry[] {
    return [...this.ledgerEntries];
  }

  rollbackLedger(): readonly RollbackLedgerEntry[] {
    return this.rollbackLog.list();
  }

  autoPromotionsUsed(): number {
    return this.autoPromoteCount;
  }

  isRetired(versionId: ResourceVersionId): boolean {
    return this.retiredIds.has(versionId);
  }

  /**
   * Guardrail/user CAS restore of a previous pointer, or a degradation proposal.
   * Never deletes versions. Idempotent when the active pointer is already the target.
   */
  rollback(input: RollbackInput): { ok: boolean; active: ResourceVersion } {
    validateRollbackInput(input);
    const target = this.versionsById.get(input.targetVersionId);
    const knownTargets = this.versionsFor(input.identity);
    if (
      target === undefined ||
      !knownTargets.some((version) => version.versionId === input.targetVersionId)
    ) {
      throw new DomainValidationError(`unknown rollback target: ${String(input.targetVersionId)}`);
    }
    if (!identityEquals(target.identity, input.identity)) {
      throw new DomainValidationError(
        `rollback target ${target.versionId} does not match requested identity`
      );
    }
    if (this.retiredIds.has(input.targetVersionId)) {
      throw new DomainValidationError(
        `version ${input.targetVersionId} is retired and cannot receive new assignments`
      );
    }

    const active = this.getActiveVersion(input.identity);
    if (active === undefined) {
      throw new DomainValidationError(
        `unknown expected version: ${String(input.expectedCurrentVersionId)}`
      );
    }

    if (active.versionId === input.targetVersionId) {
      return { ok: true, active };
    }

    if (input.reason === "degradation" && input.confirm !== true) {
      const last = this.rollbackLog.last();
      const alreadyProposed =
        last?.kind === "rollback-proposed" &&
        last.fromVersionId === active.versionId &&
        last.toVersionId === input.targetVersionId &&
        last.reason === "degradation";
      if (!alreadyProposed) {
        this.rollbackLog.append({
          kind: "rollback-proposed",
          fromVersionId: active.versionId,
          toVersionId: input.targetVersionId,
          reason: "degradation",
          automatic: false,
          evidence: [...input.evidence],
          at: this.now()
        });
      }
      return { ok: false, active };
    }

    casActivePointer(
      this.activeByKey,
      input.identity,
      input.expectedCurrentVersionId,
      input.targetVersionId
    );
    const restored = this.versionsById.get(input.targetVersionId);
    if (restored === undefined) {
      throw new DomainValidationError(`unknown rollback target: ${String(input.targetVersionId)}`);
    }
    this.rollbackLog.append({
      kind: "rolled-back",
      fromVersionId: input.expectedCurrentVersionId,
      toVersionId: input.targetVersionId,
      reason: input.reason,
      automatic: input.reason === "guardrail",
      evidence: [...input.evidence],
      at: this.now()
    });
    return { ok: true, active: restored };
  }

  /** Mark a non-active version as retired. Idempotent. */
  retire(versionId: ResourceVersionId): ResourceVersion {
    if (!isResourceVersionId(versionId)) {
      throw new DomainValidationError(`unknown version: ${String(versionId)}`);
    }
    const version = this.versionsById.get(versionId);
    if (version === undefined) {
      throw new DomainValidationError(`unknown version: ${String(versionId)}`);
    }
    const active = this.getActiveVersion(version.identity);
    if (active?.versionId === versionId) {
      throw new DomainValidationError(`cannot retire the current active version ${versionId}`);
    }
    this.retiredIds.add(versionId);
    return version;
  }

  assertAssignable(versionId: ResourceVersionId): void {
    if (!isResourceVersionId(versionId)) {
      throw new DomainValidationError(`unknown version: ${String(versionId)}`);
    }
    const version = this.versionsById.get(versionId);
    if (version === undefined) {
      throw new DomainValidationError(`unknown version: ${String(versionId)}`);
    }
    if (this.retiredIds.has(versionId)) {
      throw new DomainValidationError(
        `version ${versionId} is retired and cannot receive new assignments`
      );
    }
  }

  updateCandidateStatus(candidateId: CandidateId, status: CandidateStatus): ImprovementCandidate {
    const candidate = this.candidates.get(candidateId);
    if (candidate === undefined) {
      throw new DomainValidationError(`unknown candidate: ${String(candidateId)}`);
    }
    const updated: ImprovementCandidate = { ...candidate, status };
    validateCandidate(updated);
    this.candidates.set(candidateId, updated);
    return updated;
  }

  /**
   * Phase 1: record intent and materialize the new version without moving
   * the active pointer. A crash here leaves the candidate inactive.
   */
  beginPromotion(input: PromoteInput): BeginPromotionResult {
    const prepared = this.preparePromotion(input);
    const intentId = intentIdFor(prepared.pendingVersion.versionId);
    if (this.pendingByIntent.has(intentId)) {
      throw new DomainValidationError(`duplicate promotion intent: ${intentId}`);
    }
    this.addVersion(prepared.pendingVersion);
    const pending: PendingPromotion = {
      intentId,
      candidateId: input.candidateId,
      expectedCurrentVersionId: input.expectedCurrentVersionId,
      pendingVersionId: prepared.pendingVersion.versionId,
      approvedBy: input.approvedBy,
      review: input.review,
      changeNote: input.changeNote,
      usedAutoPromote: prepared.usedAutoPromote
    };
    this.pendingByIntent.set(intentId, pending);
    this.appendLedger({
      kind: "intent",
      candidateId: input.candidateId,
      fromVersionId: input.expectedCurrentVersionId,
      toVersionId: prepared.pendingVersion.versionId,
      expectedCurrentVersionId: input.expectedCurrentVersionId,
      approvedBy: input.approvedBy,
      review: input.review,
      changeNote: input.changeNote,
      at: this.now()
    });
    return {
      intentId,
      pendingVersion: prepared.pendingVersion,
      ledger: this.ledger()
    };
  }

  /**
   * Phase 2: compare-and-swap the active pointer onto the pending version.
   */
  commitPromotion(intentId: string): PromotionResult {
    if (!isIntentId(intentId)) {
      throw new DomainValidationError(`invalid promotion intent id: ${intentId}`);
    }
    const pending = this.pendingByIntent.get(intentId);
    if (pending === undefined) {
      throw new DomainValidationError(`unknown promotion intent: ${intentId}`);
    }
    const candidate = this.candidates.get(pending.candidateId);
    if (candidate === undefined) {
      throw new DomainValidationError(`unknown candidate: ${String(pending.candidateId)}`);
    }
    if (!isPromotableStatus(candidate.status)) {
      this.pendingByIntent.delete(intentId);
      throw new DomainValidationError(
        `candidate ${candidate.candidateId} status ${candidate.status} cannot promote`
      );
    }
    const pendingVersion = this.versionsById.get(pending.pendingVersionId);
    if (pendingVersion === undefined) {
      throw new DomainValidationError(`unknown pending version: ${String(pending.pendingVersionId)}`);
    }

    try {
      casActivePointer(
        this.activeByKey,
        candidate.identity,
        pending.expectedCurrentVersionId,
        pendingVersion.versionId
      );
    } catch (error: unknown) {
      this.pendingByIntent.delete(intentId);
      this.appendLedger({
        kind: "rejected",
        candidateId: pending.candidateId,
        fromVersionId: pending.expectedCurrentVersionId,
        toVersionId: pendingVersion.versionId,
        expectedCurrentVersionId: pending.expectedCurrentVersionId,
        approvedBy: pending.approvedBy,
        ...(pending.review !== undefined ? { review: pending.review } : {}),
        changeNote: pending.changeNote,
        at: this.now()
      });
      throw error;
    }

    this.pendingByIntent.delete(intentId);
    this.candidates.set(candidate.candidateId, { ...candidate, status: "approved" });
    if (pending.usedAutoPromote) {
      this.autoPromoteCount += 1;
    }
    this.appendLedger({
      kind: "promoted",
      candidateId: pending.candidateId,
      fromVersionId: pending.expectedCurrentVersionId,
      toVersionId: pendingVersion.versionId,
      expectedCurrentVersionId: pending.expectedCurrentVersionId,
      approvedBy: pending.approvedBy,
      ...(pending.review !== undefined ? { review: pending.review } : {}),
      changeNote: pending.changeNote,
      at: this.now()
    });
    return {
      ok: true,
      newVersion: pendingVersion,
      ledger: this.ledger()
    };
  }

  /** Atomic begin+commit for the happy path. */
  promote(input: PromoteInput): PromotionResult {
    const began = this.beginPromotion(input);
    return this.commitPromotion(began.intentId);
  }

  snapshot(): ResourceRegistrySnapshot {
    return {
      versions: Array.from(this.versionsById.values()),
      activeVersionIds: Array.from(this.activeByKey.values()),
      candidates: Array.from(this.candidates.values()),
      ledger: this.ledger(),
      pending: Array.from(this.pendingByIntent.values()),
      autoPromotionsUsed: this.autoPromoteCount,
      rollbackLedger: this.rollbackLog.list(),
      retiredVersionIds: Array.from(this.retiredIds),
      contents: Array.from(this.contentsByHash.entries()).map(([hash, content]) => ({ hash, content }))
    };
  }

  restore(snapshot: ResourceRegistrySnapshot): void {
    this.versionsById.clear();
    this.versionsByKey.clear();
    this.activeByKey.clear();
    this.candidates.clear();
    this.ledgerEntries.length = 0;
    this.pendingByIntent.clear();
    this.rollbackLog.restore([]);
    this.retiredIds.clear();
    this.contentsByHash.clear();
    this.autoPromoteCount = snapshot.autoPromotionsUsed;
    for (const blob of snapshot.contents ?? []) {
      if (hashCandidateContent(blob.content) !== blob.hash) {
        throw new DomainValidationError(`snapshot content hash mismatch: ${blob.hash}`);
      }
      this.contentsByHash.set(blob.hash, blob.content);
    }

    for (const version of snapshot.versions) {
      if (!isResourceVersionId(version.versionId)) {
        throw new DomainValidationError(`invalid version id in snapshot: ${String(version.versionId)}`);
      }
      this.addVersion(version);
    }
    for (const versionId of snapshot.activeVersionIds) {
      const version = this.versionsById.get(versionId);
      if (version === undefined) {
        throw new DomainValidationError(`snapshot active version is unknown: ${String(versionId)}`);
      }
      this.activeByKey.set(resourceIdentityKey(version.identity), version.versionId);
    }
    for (const candidate of snapshot.candidates) {
      if (!isCandidateId(candidate.candidateId)) {
        throw new DomainValidationError(`invalid candidate id in snapshot: ${String(candidate.candidateId)}`);
      }
      this.candidates.set(candidate.candidateId, candidate);
    }
    this.ledgerEntries.push(...snapshot.ledger);
    for (const pending of snapshot.pending) {
      if (!this.versionsById.has(pending.pendingVersionId)) {
        throw new DomainValidationError(
          `snapshot pending version is unknown: ${String(pending.pendingVersionId)}`
        );
      }
      this.pendingByIntent.set(pending.intentId, pending);
    }
    this.rollbackLog.restore(snapshot.rollbackLedger ?? []);
    for (const versionId of snapshot.retiredVersionIds ?? []) {
      if (!isResourceVersionId(versionId)) {
        throw new DomainValidationError(`invalid retired version id in snapshot: ${String(versionId)}`);
      }
      if (!this.versionsById.has(versionId)) {
        throw new DomainValidationError(`snapshot retired version is unknown: ${String(versionId)}`);
      }
      this.retiredIds.add(versionId);
    }
  }

  private preparePromotion(input: PromoteInput): {
    readonly pendingVersion: ResourceVersion;
    readonly usedAutoPromote: boolean;
  } {
    validateChangeNote(input.changeNote, input.expectedCurrentVersionId);
    validatePromotionReview(input.review);
    if (!isCandidateId(input.candidateId)) {
      throw new DomainValidationError(`unknown candidate: ${String(input.candidateId)}`);
    }
    if (!isResourceVersionId(input.expectedCurrentVersionId)) {
      throw new DomainValidationError(
        `unknown expected version: ${String(input.expectedCurrentVersionId)}`
      );
    }

    const candidate = this.candidates.get(input.candidateId);
    if (candidate === undefined) {
      throw new DomainValidationError(`unknown candidate: ${String(input.candidateId)}`);
    }
    assertRoutingPolicyEvalReport(candidate, input);
    const contentHash = this.putContent(input.content);
    if (contentHash !== candidate.contentHash) {
      throw new DomainValidationError(
        `content hash mismatch: provided content does not match candidate ${candidate.candidateId}`
      );
    }
    if (
      input.review.actorId !== candidate.author.identity ||
      input.review.candidateId !== candidate.candidateId ||
      input.review.contentHash !== contentHash
    ) {
      throw new DomainValidationError("promotion review must match candidate author, id, and content hash");
    }
    if (!isPromotableStatus(candidate.status)) {
      throw new DomainValidationError(
        `candidate ${candidate.candidateId} status ${candidate.status} cannot promote`
      );
    }
    if (input.review.candidateId !== candidate.candidateId) {
      throw new DomainValidationError("promotion review candidate does not match promotion candidate");
    }

    const expected = this.versionsById.get(input.expectedCurrentVersionId);
    if (expected === undefined) {
      throw new DomainValidationError(
        `unknown expected version: ${String(input.expectedCurrentVersionId)}`
      );
    }
    if (!identityEquals(expected.identity, candidate.identity)) {
      throw new DomainValidationError(
        `expected version ${expected.versionId} does not match candidate identity`
      );
    }

    const active = this.getActiveVersion(candidate.identity);
    assertExpectedActive(active, input.expectedCurrentVersionId);

    for (const pending of Array.from(this.pendingByIntent.values())) {
      if (pending.candidateId === candidate.candidateId) {
        throw new DomainValidationError(
          `promotion already in flight for ${candidate.candidateId}`
        );
      }
    }

    const profile = input.approvalProfile ?? createDefaultApprovalProfile();
    validateApprovalProfile(profile);
    const autoEligible =
      canAutoPromote(profile, candidate.identity.kind, this.autoPromoteCount) &&
      candidate.autoPromotable;
    const usingAuto = autoEligible && input.explicitApproval !== true;
    if (!usingAuto) {
      if (input.explicitApproval !== true) {
        throw new DomainValidationError("explicit approval is required to promote");
      }
      assertExplicitApprovalActor(input.approvedBy);
    }

    const pendingVersion: ResourceVersion = {
      versionId: createResourceVersionId(this.generateId),
      identity: candidate.identity,
      contentHash: candidate.contentHash,
      author: candidate.author,
      parentVersionId: input.expectedCurrentVersionId,
      createdAt: this.now()
    };
    return { pendingVersion, usedAutoPromote: usingAuto };
  }

  private addVersion(version: ResourceVersion): void {
    this.versionsById.set(version.versionId, version);
    const key = resourceIdentityKey(version.identity);
    const existing = this.versionsByKey.get(key) ?? [];
    this.versionsByKey.set(key, [...existing, version]);
  }

  private appendLedger(entry: PromotionLedgerEntry): void {
    this.ledgerEntries.push(entry);
  }
}
