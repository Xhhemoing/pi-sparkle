import { DomainValidationError } from "../domain/errors.js";
import {
  createCandidateId,
  createResourceVersionId,
} from "../domain/ids.js";
import type { CandidateId, IdGenerator, ResourceVersionId } from "../domain/ids.js";
import { nowIso } from "../domain/timestamp.js";
import type { IsoTimestamp } from "../domain/timestamp.js";
import {
  assertAcyclicLineage,
  autoPromotableFor,
  hashCandidateContent,
  validateCandidate,
} from "./candidate.js";
import type { CandidateInput, ImprovementCandidate } from "./candidate.js";
import type { AuthorIdentity, ResourceIdentity, ResourceVersion } from "./resource.js";
import { identityEquals } from "./resource.js";

export interface RegistryOptions {
  readonly now?: () => IsoTimestamp;
  readonly generateId?: IdGenerator;
}

export interface BaselineInput {
  readonly identity: ResourceIdentity;
  readonly content: string;
  readonly author: AuthorIdentity;
}

function identityKey(identity: ResourceIdentity): string {
  const scopeKey =
    identity.scope.kind === "project"
      ? `project:${identity.scope.projectId}`
      : "user-global";
  return `${identity.kind}|${identity.name}|${scopeKey}`;
}

/**
 * Versioned resource registry (M6-T1). Versions and candidates are immutable;
 * the active pointer moves only through explicit baseline registration — the
 * compare-and-swap promotion API is M6-T5 and does not exist here yet.
 *
 * Creating a candidate never changes the active version.
 */
export class ResourceRegistry {
  private readonly now: () => IsoTimestamp;
  private readonly generateId: IdGenerator;
  private readonly versionsById = new Map<ResourceVersionId, ResourceVersion>();
  private readonly versionsByKey = new Map<string, readonly ResourceVersion[]>();
  private readonly activeByKey = new Map<string, ResourceVersionId>();
  private readonly candidates = new Map<CandidateId, ImprovementCandidate>();

  constructor(options: RegistryOptions = {}) {
    this.now = options.now ?? nowIso;
    this.generateId = options.generateId ?? (() => createResourceVersionId());
  }

  /** Register the original version of a resource and point the active version at it. */
  registerBaseline(input: BaselineInput): ResourceVersion {
    const key = identityKey(input.identity);
    if (this.activeByKey.has(key)) {
      throw new DomainValidationError(`baseline already exists for resource ${key}`);
    }
    const version: ResourceVersion = {
      versionId: createResourceVersionId(this.generateId),
      identity: input.identity,
      contentHash: hashCandidateContent(input.content),
      author: input.author,
      parentVersionId: undefined,
      createdAt: this.now(),
    };
    this.versionsById.set(version.versionId, version);
    this.versionsByKey.set(key, [version]);
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
    const contentHash = hashCandidateContent(input.content);
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
      createdAt: this.now(),
    };
    validateCandidate(candidate);
    assertAcyclicLineage(candidate.candidateId, (id) => {
      const version = this.versionsById.get(id as ResourceVersionId);
      return version?.parentVersionId;
    });
    this.candidates.set(candidate.candidateId, candidate);
    return candidate;
  }

  /** Read-only active pointer. M6-T5 owns promotion; this never mutates. */
  getActiveVersion(identity: ResourceIdentity): ResourceVersion | undefined {
    const activeId = this.activeByKey.get(identityKey(identity));
    if (activeId === undefined) {
      return undefined;
    }
    return this.versionsById.get(activeId);
  }

  getVersion(versionId: ResourceVersionId): ResourceVersion | undefined {
    return this.versionsById.get(versionId);
  }

  versionsFor(identity: ResourceIdentity): readonly ResourceVersion[] {
    return this.versionsByKey.get(identityKey(identity)) ?? [];
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
}
