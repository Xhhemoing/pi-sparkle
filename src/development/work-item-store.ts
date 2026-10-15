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
export interface WorkItemOperationOptions {
  readonly signal?: AbortSignal;
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
function snapshotInput<T extends object>(value: T, fields: readonly string[]): Readonly<T> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
      Reflect.ownKeys(value).some((key) => typeof key !== "string" || !fields.includes(key)) ||
      Object.values(Object.getOwnPropertyDescriptors(value)).some((property) => property.get !== undefined || property.set !== undefined)) {
    fail("invalid operation input or accessor");
  }
  return Object.freeze({ ...value });
}
function operationSignal(value: unknown): AbortSignal | undefined {
  if (value !== undefined && !(value instanceof AbortSignal)) fail("operation signal must be an AbortSignal");
  return value;
}
function checkCancellation(signal?: AbortSignal): void {
  if (signal?.aborted) fail("operation cancelled");
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

  private async locked<T>(operation: () => Promise<T>, create = false, signal?: AbortSignal): Promise<T> {
    checkCancellation(signal);
    await this.checkParent(create);
    checkCancellation(signal);
    return withExclusiveFileLock(`${this.path}.lock`, async () => {
      // Lock contention is cooperative; a cancelled waiter must not mutate
      // after it eventually acquires the lock. Do not check after publication.
      checkCancellation(signal);
      return operation();
    }, this.lockOptions);
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

  private async verify(record: WorkItemRecord, signal?: AbortSignal): Promise<void> {
    checkCancellation(signal);
    const resolver = this.verifyEvidence;
    if (resolver === undefined) fail("host evidence verifier is required");
    if (record.claim === undefined) fail("claim is required for evidence verification");
    const records = validateWorkItemEvidence(record.evidence, record.definition, record.claim, record.claim.baseRevision);
    const controller = new AbortController();
    const combinedSignal = signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal]);
    let timeoutError: DomainValidationError | undefined;
    let rejectTimeout: ((reason: DomainValidationError) => void) | undefined;
    // Preserve legacy no-signal timeout behavior. Signal-aware operations must
    // await the active resolver's cleanup instead of detaching while it runs.
    const timeout = signal === undefined ? new Promise<never>((_resolve, reject) => { rejectTimeout = reject; }) : undefined;
    const timer = setTimeout(() => {
      timeoutError = new DomainValidationError("work item store: evidence verification timed out");
      controller.abort();
      rejectTimeout?.(timeoutError);
    }, this.verificationTimeoutMs);
    const checkStopped = (): void => {
      if (timeoutError !== undefined) throw timeoutError;
      checkCancellation(combinedSignal);
    };
    try {
      const verification = (async () => {
        for (const entry of records) {
          checkStopped();
          const recipe = record.definition.acceptance.find((candidate) => candidate.id === entry.recipeId)!;
          const context = freezeWorkItemValue({ item: record.definition, claim: record.claim!, recipe });
          let accepted: boolean;
          try { accepted = await resolver(entry, context, combinedSignal); }
          catch (error) { checkStopped(); throw error; }
          checkStopped();
          if (accepted !== true) fail("host evidence verification refused");
        }
      })();
      if (timeout === undefined) await verification;
      else await Promise.race([timeout, verification]);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  private async verifyAccepted(queue: WorkQueue, signal?: AbortSignal): Promise<void> {
    checkCancellation(signal);
    for (const record of queue.items) if (record.status === "accepted") await this.verify(record, signal);
    checkCancellation(signal);
  }

  async next(input: WorkItemOperationOptions = {}): Promise<WorkItemDefinition | undefined> {
    const options = snapshotInput(input, ["signal"]);
    const signal = operationSignal(options.signal);
    checkCancellation(signal);
    const queue = await this.read();
    await this.verifyAccepted(queue, signal);
    return selectNextWorkItem(queue);
  }

  async claimNext(input: { readonly owner: string; readonly baseRevision: string; readonly signal?: AbortSignal }): Promise<WorkItemClaimResult | undefined> {
    const options = snapshotInput(input, ["owner", "baseRevision", "signal"]);
    const owner = workItemText(options.owner, "owner", 128);
    const baseRevision = workItemBaseRevision(options.baseRevision);
    const signal = operationSignal(options.signal);
    return this.locked(async () => {
      const queue = await this.read();
      await this.verifyAccepted(queue, signal);
      const item = selectNextWorkItem(queue);
      if (item === undefined) return undefined;
      const claim = freezeWorkItemValue({ token: randomUUID(), owner, baseRevision, startedAt: new Date().toISOString() });
      checkCancellation(signal);
      await this.replace(queue, { definition: item, status: "running", claim });
      // Once publication begins, return the committed token even if aborted.
      // The controller owns subsequent fenced cleanup; never lose ownership.
      return freezeWorkItemValue({ item, token: claim.token, claim });
    }, false, signal);
  }

  private async replace(queue: WorkQueue, record: WorkItemRecord): Promise<WorkItemRecord> {
    const updated = validateWorkQueue({ ...queue, revision: queue.revision + 1,
      items: queue.items.map((entry) => entry.definition.id === record.definition.id ? record : entry) });
    await this.write(updated);
    return updated.items.find((entry) => entry.definition.id === record.definition.id)!;
  }

  private async transition(
    id: string, token: string, statuses: readonly WorkItemStatus[],
    update: (entry: WorkItemRecord) => Promise<WorkItemRecord>, signal?: AbortSignal
  ): Promise<WorkItemRecord> {
    workItemText(id, "item id", 64);
    workItemText(token, "claim token", 128);
    return this.locked(async () => {
      const queue = await this.read();
      checkCancellation(signal);
      const entry = queue.items.find((candidate) => candidate.definition.id === id);
      if (entry === undefined || entry.claim?.token !== token || !statuses.includes(entry.status)) fail("stale claim token or invalid transition");
      const updated = await update(entry);
      checkCancellation(signal);
      return this.replace(queue, updated);
    }, false, signal);
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

  markReady(id: string, token: string, currentBaseRevision: string, evidence: readonly WorkItemEvidence[], signal?: AbortSignal): Promise<WorkItemRecord> {
    const callerSignal = operationSignal(signal);
    const baseRevision = workItemBaseRevision(currentBaseRevision);
    const snapshot = structuredClone(evidence);
    return this.transition(id, token, ["running"], async (entry) => {
      const bound = validateWorkItemEvidence(snapshot, entry.definition, entry.claim!, baseRevision);
      const ready: WorkItemRecord = { ...entry, status: "ready-for-review", evidence: bound };
      await this.verify(ready, callerSignal);
      return ready;
    }, callerSignal);
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
