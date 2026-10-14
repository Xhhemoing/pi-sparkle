import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { dirname, parse, resolve, sep } from "node:path";
import { DomainValidationError } from "../domain/errors.js";
import { writeFileAtomic } from "../persist/atomic-file.js";
import { withExclusiveFileLock, type FileLockOptions } from "../persist/file-lock.js";
import {
  freezeWorkItemValue, selectNextWorkItem, validateWorkItemEvidence, validateWorkQueue,
  workItemBaseRevision, workItemText,
  type WorkItemClaim, type WorkItemDefinition, type WorkItemEvidence, type WorkItemRecipe,
  type WorkItemRecord, type WorkItemStatus, type WorkQueue
} from "./work-items.js";

export interface WorkItemVerificationContext {
  readonly item: WorkItemDefinition;
  readonly claim: WorkItemClaim;
  readonly recipe: WorkItemRecipe;
}
export interface WorkItemStoreOptions {
  /** Host-owned read-only resolver of actual artifacts; never deserialize this from worker JSON. */
  readonly verifyEvidence?: (evidence: WorkItemEvidence, context: WorkItemVerificationContext, signal: AbortSignal) => Promise<boolean>;
  /** Total verifier time per item, 1..300000 ms. */
  readonly verificationTimeoutMs?: number;
  readonly lock?: FileLockOptions;
}
export interface WorkItemClaimResult {
  readonly item: WorkItemDefinition;
  readonly token: string;
  readonly claim: WorkItemClaim;
}

const MAX_QUEUE_BYTES = 1_048_576;
function fail(reason: string): never { throw new DomainValidationError(`work item store: ${reason}`); }
function code(error: unknown): unknown {
  return error !== null && typeof error === "object" && "code" in error ? error.code : undefined;
}
function duration(value: number | undefined, fallback: number, maximum: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) fail("duration out of bounds");
  return result;
}

/**
 * One host-selected queue file, not a global project plan. Claims are cooperative
 * fencing tokens with no expiry; abandoned owners require explicit host release.
 */
export class WorkItemStore {
  readonly path: string;
  private readonly lockOptions: FileLockOptions;
  private readonly verifyEvidence: WorkItemStoreOptions["verifyEvidence"];
  private readonly verificationTimeoutMs: number;

  constructor(path: string, options: WorkItemStoreOptions = {}) {
    this.path = resolve(workItemText(path, "queue path", 4096));
    if (options === null || typeof options !== "object" || Array.isArray(options) ||
        Object.keys(options).some((key) => !["verifyEvidence", "verificationTimeoutMs", "lock"].includes(key))) fail("invalid options");
    if (options.verifyEvidence !== undefined && typeof options.verifyEvidence !== "function") fail("invalid evidence verifier");
    if (options.lock !== undefined && (options.lock === null || typeof options.lock !== "object" || Array.isArray(options.lock) ||
        Object.keys(options.lock).some((key) => key !== "timeoutMs" && key !== "retryMs"))) fail("invalid lock options");
    this.verifyEvidence = options.verifyEvidence;
    this.verificationTimeoutMs = duration(options.verificationTimeoutMs, 30_000, 300_000);
    this.lockOptions = Object.freeze({ timeoutMs: duration(options.lock?.timeoutMs, 5000, 30_000),
      retryMs: duration(options.lock?.retryMs, 10, 1000) });
  }

  private async checkParent(mayCreate = false): Promise<void> {
    const parent = dirname(this.path);
    const root = parse(parent).root;
    let cursor = root;
    for (const part of parent.slice(root.length).split(sep).filter(Boolean)) {
      cursor = resolve(cursor, part);
      try {
        const entry = await lstat(cursor);
        if (entry.isSymbolicLink() || !entry.isDirectory()) fail("queue parent must be a real directory without links");
      } catch (error) {
        if (mayCreate && code(error) === "ENOENT") break;
        throw error;
      }
    }
    if (mayCreate) {
      await mkdir(parent, { recursive: true });
      await this.checkParent();
    }
  }

  private async read(): Promise<WorkQueue> {
    await this.checkParent();
    const entry = await lstat(this.path);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) fail("queue must be an unlinked regular file");
    const handle = await open(this.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.nlink !== 1 || before.size > MAX_QUEUE_BYTES) fail("queue exceeds 1 MiB size limit or is not a regular file");
      const buffer = Buffer.alloc(before.size + 1);
      let used = 0;
      while (used < buffer.length) {
        const { bytesRead } = await handle.read(buffer, used, buffer.length - used, used);
        if (bytesRead === 0) break;
        used += bytesRead;
      }
      const after = await handle.stat();
      if (used !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) fail("queue changed while reading");
      return validateWorkQueue(JSON.parse(buffer.subarray(0, used).toString("utf8")) as unknown);
    } finally { await handle.close(); }
  }

  private async write(queue: WorkQueue): Promise<void> {
    const body = `${JSON.stringify(validateWorkQueue(queue), null, 2)}\n`;
    if (Buffer.byteLength(body) > MAX_QUEUE_BYTES) fail("queue exceeds 1 MiB size limit");
    await writeFileAtomic(this.path, body, { mode: 0o600 });
  }

  private async locked<T>(operation: () => Promise<T>, create = false): Promise<T> {
    await this.checkParent(create);
    return withExclusiveFileLock(`${this.path}.lock`, operation, this.lockOptions);
  }

  async create(value: WorkQueue): Promise<void> {
    const queue = validateWorkQueue(value);
    if (queue.revision !== 0 || queue.items.some((entry) => entry.status !== "planned")) fail("a new queue must contain only planned work");
    await this.locked(async () => {
      try { await lstat(this.path); } catch (error) {
        if (code(error) !== "ENOENT") throw error;
        await this.write(queue);
        return;
      }
      fail("queue already exists");
    }, true);
  }

  /** Read-only state inspection; statuses here alone are never execution authority. */
  load(): Promise<WorkQueue> { return this.read(); }

  private async verify(record: WorkItemRecord): Promise<void> {
    const resolver = this.verifyEvidence;
    if (resolver === undefined) fail("host evidence verifier is required");
    if (record.claim === undefined) fail("claim is required for evidence verification");
    const records = validateWorkItemEvidence(record.evidence, record.definition, record.claim, record.claim.baseRevision);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new DomainValidationError("work item store: evidence verification timed out"));
        controller.abort();
      }, this.verificationTimeoutMs);
    });
    try {
      await Promise.race([timeout, (async () => {
        for (const entry of records) {
          if (controller.signal.aborted) fail("evidence verification cancelled");
          const recipe = record.definition.acceptance.find((candidate) => candidate.id === entry.recipeId)!;
          const context = freezeWorkItemValue({ item: record.definition, claim: record.claim!, recipe });
          if (await resolver(entry, context, controller.signal) !== true) fail("host evidence verification refused");
        }
      })()]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      controller.abort();
    }
  }

  private async verifyAccepted(queue: WorkQueue): Promise<void> {
    for (const record of queue.items) if (record.status === "accepted") await this.verify(record);
  }

  async next(): Promise<WorkItemDefinition | undefined> {
    const queue = await this.read();
    await this.verifyAccepted(queue);
    return selectNextWorkItem(queue);
  }

  async claimNext(input: { readonly owner: string; readonly baseRevision: string }): Promise<WorkItemClaimResult | undefined> {
    if (input === null || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => key !== "owner" && key !== "baseRevision")) fail("invalid claim input");
    const owner = workItemText(input.owner, "owner", 128);
    const baseRevision = workItemBaseRevision(input.baseRevision);
    return this.locked(async () => {
      const queue = await this.read();
      await this.verifyAccepted(queue);
      const item = selectNextWorkItem(queue);
      if (item === undefined) return undefined;
      const claim = freezeWorkItemValue({ token: randomUUID(), owner, baseRevision, startedAt: new Date().toISOString() });
      await this.replace(queue, { definition: item, status: "running", claim });
      return freezeWorkItemValue({ item, token: claim.token, claim });
    });
  }

  private async replace(queue: WorkQueue, record: WorkItemRecord): Promise<WorkItemRecord> {
    const updated = validateWorkQueue({ ...queue, revision: queue.revision + 1,
      items: queue.items.map((entry) => entry.definition.id === record.definition.id ? record : entry) });
    await this.write(updated);
    return updated.items.find((entry) => entry.definition.id === record.definition.id)!;
  }

  private async transition(
    id: string, token: string, statuses: readonly WorkItemStatus[],
    update: (entry: WorkItemRecord) => Promise<WorkItemRecord>
  ): Promise<WorkItemRecord> {
    workItemText(id, "item id", 64);
    workItemText(token, "claim token", 128);
    return this.locked(async () => {
      const queue = await this.read();
      const entry = queue.items.find((candidate) => candidate.definition.id === id);
      if (entry === undefined || entry.claim?.token !== token || !statuses.includes(entry.status)) fail("stale claim token or invalid transition");
      return this.replace(queue, await update(entry));
    });
  }

  block(id: string, token: string, reason: string): Promise<WorkItemRecord> {
    const blockedReason = workItemText(reason, "blocked reason", 2048);
    return this.transition(id, token, ["running", "ready-for-review"], async (entry) =>
      ({ definition: entry.definition, status: "blocked", claim: entry.claim!, blockedReason }));
  }

  /** Explicit host retry/recovery action; no clock or stale-lock heuristic calls it. */
  release(id: string, token: string): Promise<WorkItemRecord> {
    return this.transition(id, token, ["running", "blocked", "ready-for-review"], async (entry) =>
      ({ definition: entry.definition, status: "planned" }));
  }

  markReady(id: string, token: string, currentBaseRevision: string, evidence: readonly WorkItemEvidence[]): Promise<WorkItemRecord> {
    const baseRevision = workItemBaseRevision(currentBaseRevision);
    const snapshot = structuredClone(evidence);
    return this.transition(id, token, ["running"], async (entry) => {
      const bound = validateWorkItemEvidence(snapshot, entry.definition, entry.claim!, baseRevision);
      const ready: WorkItemRecord = { ...entry, status: "ready-for-review", evidence: bound };
      await this.verify(ready);
      return ready;
    });
  }

  /** Separate host acceptance; persisted ready evidence is resolved afresh. */
  accept(id: string, token: string, currentBaseRevision: string): Promise<WorkItemRecord> {
    const baseRevision = workItemBaseRevision(currentBaseRevision);
    return this.transition(id, token, ["ready-for-review"], async (entry) => {
      validateWorkItemEvidence(entry.evidence, entry.definition, entry.claim!, baseRevision);
      await this.verify(entry);
      return { ...entry, status: "accepted" };
    });
  }
}
