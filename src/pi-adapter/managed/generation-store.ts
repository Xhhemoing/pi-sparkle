import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdir, open, readdir } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { DomainValidationError } from "../../domain/errors.js";
import { physicalDirectoryWithoutLinks } from "../../native/physical-directory.js";
import { writeFileAtomic, type AtomicWriteOptions } from "../../persist/atomic-file.js";
import { withExclusiveFileLock, type FileLockOptions } from "../../persist/file-lock.js";
import type { ManagedCandidate } from "./candidate.js";
import { lookupIssuedManagedQualification, validateManagedQualificationRecord, type ManagedQualificationRecord, type ManagedQualificationResult } from "./qualification.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const POINTER_BYTES = 4 * 1024;
const QUALIFICATION_BYTES = 128 * 1024;
const CANDIDATE_BYTES = 1024 * 1024;
export interface ManagedGenerationStoreOptions {
  readonly lock?: FileLockOptions;
  readonly atomicWrite?: Pick<AtomicWriteOptions, "rename">;
}
export interface QualifiedManagedGeneration extends ManagedCandidate {
  readonly qualification: ManagedQualificationRecord;
}
function errorCode(error: unknown): unknown {
  return error !== null && typeof error === "object" && "code" in error ? error.code : undefined;
}
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new DomainValidationError("managed generation metadata must be an object");
  return value as Record<string, unknown>;
}
function equal(actual: unknown, expected: unknown, label: string): void {
  if (!isDeepStrictEqual(actual, expected)) throw new DomainValidationError(`managed generation ${label} mismatch`);
}
function generationId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !UUID.test(value)) throw new DomainValidationError("invalid managed generation ID");
}
function frozenCopy<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (item === null || typeof item !== "object") return;
    for (const child of Object.values(item)) freeze(child);
    Object.freeze(item);
  };
  freeze(copy);
  return copy;
}
function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode && left.nlink === right.nlink;
}
function sameFile(left: BigIntStats, right: BigIntStats): boolean {
  return sameIdentity(left, right) && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}
async function publicationRemnants(file: string): Promise<boolean> {
  const prefix = path.basename(file) + ".";
  return (await readdir(path.dirname(file))).some((name) => name.startsWith(prefix));
}
/** Metadata only: one bounded descriptor, no links, and stable physical parents.
 * This does not authenticate content against an uncooperative local writer. */
async function readObject(file: string, maxBytes: number): Promise<Record<string, unknown> | undefined> {
  let entry: BigIntStats;
  try { entry = await lstat(file, { bigint: true }); }
  catch (error: unknown) {
    if (errorCode(error) !== "ENOENT") throw error;
    if (await publicationRemnants(file)) throw new DomainValidationError("managed generation publication requires reconciliation");
    return undefined;
  }
  if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1n || entry.size > BigInt(maxBytes)) {
    throw new DomainValidationError("managed generation metadata must be a bounded regular single-link file");
  }
  const parents: Array<{ path: string; stat: BigIntStats }> = [];
  const parent = path.dirname(file);
  let cursor = path.parse(parent).root;
  for (const component of parent.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    const stat = await lstat(cursor, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new DomainValidationError("managed generation metadata parent must be a physical directory");
    parents.push({ path: cursor, stat });
  }
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !sameFile(entry, before)) throw new DomainValidationError("managed generation metadata changed before read");
    const bytes = Buffer.alloc(Number(before.size));
    let used = 0;
    while (used < bytes.length) {
      const { bytesRead } = await handle.read(bytes, used, bytes.length - used, used);
      if (bytesRead === 0) throw new DomainValidationError("managed generation metadata truncated during read");
      used += bytesRead;
    }
    const extra = Buffer.alloc(1);
    if ((await handle.read(extra, 0, 1, used)).bytesRead !== 0 || !sameFile(before, await handle.stat({ bigint: true }))) {
      throw new DomainValidationError("managed generation metadata changed during read");
    }
    for (const parent of parents) {
      if (!sameIdentity(parent.stat, await lstat(parent.path, { bigint: true }))) throw new DomainValidationError("managed generation metadata parent changed during read");
    }
    if (!sameFile(entry, await lstat(file, { bigint: true }))) throw new DomainValidationError("managed generation metadata path changed during read");
    return object(JSON.parse(bytes.toString("utf8")));
  } finally { await handle.close(); }
}

/** Cooperative retained selection; approval never runs candidate code under the
 * metadata lock. Persisted data validates lifecycle identity, not engine integrity. */
export class ManagedGenerationStore {
  private readonly managerRoot: string;
  private readonly lock: FileLockOptions;
  private readonly atomicWrite: Pick<AtomicWriteOptions, "rename">;

  constructor(managerRoot: string, options: ManagedGenerationStoreOptions = {}) {
    this.managerRoot = physicalDirectoryWithoutLinks(managerRoot);
    this.lock = {
      ...(options.lock?.timeoutMs === undefined ? {} : { timeoutMs: options.lock.timeoutMs }),
      ...(options.lock?.retryMs === undefined ? {} : { retryMs: options.lock.retryMs })
    };
    this.atomicWrite = options.atomicWrite?.rename === undefined ? {} : { rename: options.atomicWrite.rename };
  }

  private locked<T>(operation: () => Promise<T>): Promise<T> {
    equal(physicalDirectoryWithoutLinks(this.managerRoot), this.managerRoot, "manager root");
    return withExclusiveFileLock(path.join(this.managerRoot, "manager.lock"), async () => {
      equal(physicalDirectoryWithoutLinks(this.managerRoot), this.managerRoot, "manager root");
      return operation();
    }, this.lock);
  }

  private async candidateLocked(record: ManagedQualificationRecord): Promise<QualifiedManagedGeneration> {
    equal(record.managerRoot, this.managerRoot, "qualification manager");
    generationId(record.generationId);
    const generations = physicalDirectoryWithoutLinks(path.join(this.managerRoot, "generations"));
    const root = physicalDirectoryWithoutLinks(path.join(generations, record.generationId));
    equal(record.candidateRoot, root, "qualification candidate root");
    const appRoot = physicalDirectoryWithoutLinks(path.join(root, "app"));
    const manifest = await readObject(path.join(root, "candidate.json"), CANDIDATE_BYTES);
    if (manifest === undefined) throw new DomainValidationError("managed generation is missing completed candidate metadata");
    equal(manifest.generationId, record.generationId, "candidate ID");
    equal(manifest.versions, record.versions, "candidate versions");
    return frozenCopy({ generationId: record.generationId, root, appRoot, versions: record.versions, qualification: record });
  }

  private async qualifiedLocked(id: string): Promise<QualifiedManagedGeneration> {
    const qualifications = physicalDirectoryWithoutLinks(path.join(this.managerRoot, "qualifications"));
    const raw = await readObject(path.join(qualifications, `${id}.json`), QUALIFICATION_BYTES);
    if (raw === undefined) throw new DomainValidationError(`managed generation qualification is missing: ${id}`);
    const record = validateManagedQualificationRecord(raw);
    equal(record.generationId, id, "qualification ID");
    return this.candidateLocked(record);
  }

  private async approvedLocked(): Promise<QualifiedManagedGeneration | undefined> {
    const pointer = await readObject(path.join(this.managerRoot, "approved.json"), POINTER_BYTES);
    if (pointer === undefined) return undefined;
    equal(Object.keys(pointer), ["generationId"], "approved pointer fields");
    generationId(pointer.generationId);
    return this.qualifiedLocked(pointer.generationId);
  }

  private async publish(file: string, value: unknown, maxBytes: number): Promise<void> {
    const bytes = JSON.stringify(value) + "\n";
    if (Buffer.byteLength(bytes, "utf8") > maxBytes) throw new DomainValidationError("managed generation publication exceeds byte limit");
    await writeFileAtomic(file, bytes, { mode: 0o600, ...this.atomicWrite });
  }

  async approve(result: ManagedQualificationResult): Promise<QualifiedManagedGeneration> {
    // Capture private authority before waiting; caller-visible fields are never
    // read for approval and the persisted validator cannot recreate a receipt.
    const proposed = lookupIssuedManagedQualification(result, this.managerRoot);
    return this.locked(async () => {
      await this.approvedLocked(); // Corrupt current state is never silently repaired.
      const candidate = await this.candidateLocked(proposed);
      const directory = path.join(this.managerRoot, "qualifications");
      await mkdir(directory, { recursive: true });
      physicalDirectoryWithoutLinks(directory);
      const file = path.join(directory, `${proposed.generationId}.json`);
      const existing = await readObject(file, QUALIFICATION_BYTES);
      let qualified = candidate;
      if (existing === undefined) {
        await this.publish(file, proposed, QUALIFICATION_BYTES);
      } else {
        const record = validateManagedQualificationRecord(existing);
        equal(record.generationId, proposed.generationId, "existing qualification ID");
        equal(record.versions, proposed.versions, "existing qualification versions");
        qualified = await this.candidateLocked(record);
      }
      // A valid existing record is reused, never replaced: older roots can
      // continue referencing it even when this pointer publication fails.
      await this.publish(path.join(this.managerRoot, "approved.json"), { generationId: proposed.generationId }, POINTER_BYTES);
      return qualified;
    });
  }

  async readApproved(): Promise<QualifiedManagedGeneration | undefined> {
    return this.locked(() => this.approvedLocked());
  }

  async getQualifiedGeneration(id: string): Promise<QualifiedManagedGeneration> {
    generationId(id);
    return this.locked(() => this.qualifiedLocked(id));
  }
}
