import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir } from "node:fs/promises";
import { basename, dirname, parse, resolve, sep } from "node:path";
import { canonicalizeStableJson, parseStableJsonBytes } from "../domain/canonical-json.js";
import { DomainValidationError } from "../domain/errors.js";
import { writeFileAtomic } from "../persist/atomic-file.js";
import { withExclusiveFileLock, type FileLockOptions } from "../persist/file-lock.js";

export interface GithubDelivery {
  readonly deliveryId: string;
  readonly locator: { readonly owner: string; readonly repository: string; readonly number: number };
  readonly event: { readonly name: "issues" | "pull_request"; readonly action: string };
}
export interface GithubReceipt extends GithubDelivery {
  readonly id: string;
  readonly receivedAt: number;
  readonly expiresAt: number;
}
export interface GithubReceiptResult { readonly receipt: GithubReceipt; readonly duplicate: boolean }
export interface GithubReceiptStoreOptions {
  readonly maxRows?: number;
  readonly maxSnapshotBytes?: number;
  readonly maxEnvelopeBytes?: number;
  readonly retentionMs?: number;
  readonly now?: () => number;
  readonly lock?: FileLockOptions;
}
const DEFAULT_ROWS = 512;
const DEFAULT_BYTES = 1_048_576;
const DEFAULT_ENVELOPE = 4096;
const DEFAULT_RETENTION = 7 * 24 * 60 * 60 * 1000;
function fail(reason: string): never { throw new DomainValidationError(`GitHub receipt: ${reason}`); }
function code(error: unknown): unknown { return (error as NodeJS.ErrnoException | null)?.code; }
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).some((key) => typeof key !== "string" || !keys.includes(key)) ||
      Object.values(Object.getOwnPropertyDescriptors(value)).some((entry) => !entry.enumerable || entry.get !== undefined || entry.set !== undefined)) fail("invalid object fields or accessors");
  return value as Record<string, unknown>;
}
function bounded(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value) > maximum || Array.from(value).some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)) fail(`invalid ${label}`);
  return value;
}
function limit(value: unknown, fallback: number, maximum: number): number {
  const result = value ?? fallback;
  if (typeof result !== "number" || !Number.isSafeInteger(result) || result < 1 || result > maximum) fail("limit out of bounds");
  return result;
}
/** Only this explicit envelope is retained, never webhook payloads or credentials. */
export function snapshotGithubDelivery(value: unknown, maxBytes = DEFAULT_ENVELOPE): GithubDelivery {
  const input = object(value, ["deliveryId", "locator", "event"]);
  const locator = object(input.locator, ["owner", "repository", "number"]);
  const event = object(input.event, ["name", "action"]);
  const owner = bounded(locator.owner, "owner", 100).toLowerCase();
  const repository = bounded(locator.repository, "repository", 100).toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(owner) || !/^[a-z0-9_.-]+$/.test(repository) || repository === "." || repository === "..") fail("invalid repository locator");
  if (typeof locator.number !== "number" || !Number.isSafeInteger(locator.number) || locator.number < 1) fail("invalid issue number");
  if (event.name !== "issues" && event.name !== "pull_request") fail("invalid event name");
  const action = bounded(event.action, "event action", 64);
  if (!/^[a-z_]+$/.test(action)) fail("invalid event action");
  const result = Object.freeze({ deliveryId: bounded(input.deliveryId, "delivery ID", 200),
    locator: Object.freeze({ owner, repository, number: locator.number }), event: Object.freeze({ name: event.name, action }) });
  if (Buffer.byteLength(canonicalizeStableJson(result)) > maxBytes) fail("envelope exceeds byte limit");
  return result;
}

/** Finite transport retention with cooperative host locking; never business idempotency. */
export class GithubReceiptStore {
  readonly path: string;
  private readonly maxRows: number;
  private readonly maxSnapshotBytes: number;
  private readonly maxEnvelopeBytes: number;
  private readonly retentionMs: number;
  private readonly now: () => number;
  private readonly lock: FileLockOptions;
  constructor(path: string, options: GithubReceiptStoreOptions = {}) {
    if (typeof path !== "string" || path.trim() === "" || path.length > 4096) fail("invalid snapshot path");
    this.path = resolve(path);
    object(options, ["maxRows", "maxSnapshotBytes", "maxEnvelopeBytes", "retentionMs", "now", "lock"]);
    this.maxRows = limit(options.maxRows, DEFAULT_ROWS, DEFAULT_ROWS);
    this.maxSnapshotBytes = limit(options.maxSnapshotBytes, DEFAULT_BYTES, DEFAULT_BYTES);
    this.maxEnvelopeBytes = limit(options.maxEnvelopeBytes, DEFAULT_ENVELOPE, DEFAULT_ENVELOPE);
    this.retentionMs = limit(options.retentionMs, DEFAULT_RETENTION, DEFAULT_RETENTION);
    if (options.now !== undefined && typeof options.now !== "function") fail("invalid clock");
    this.now = options.now ?? Date.now;
    if (options.lock !== undefined) object(options.lock, ["timeoutMs", "retryMs"]);
    this.lock = Object.freeze({ timeoutMs: limit(options.lock?.timeoutMs, 5000, 30_000), retryMs: limit(options.lock?.retryMs, 10, 1000) });
  }
  private async checkParent(create = false): Promise<void> {
    const parent = dirname(this.path); const root = parse(parent).root; let cursor = root;
    for (const part of parent.slice(root.length).split(sep).filter(Boolean)) {
      cursor = resolve(cursor, part);
      try { const entry = await lstat(cursor); if (entry.isSymbolicLink() || !entry.isDirectory()) fail("parent must be a real directory without links"); }
      catch (error) { if (create && code(error) === "ENOENT") break; throw error; }
    }
    if (create) { await mkdir(parent, { recursive: true, mode: 0o700 }); await this.checkParent(); }
  }
  private async locked<T>(operation: () => Promise<T>): Promise<T> {
    await this.checkParent(true);
    return withExclusiveFileLock(`${this.path}.lock`, operation, this.lock);
  }
  private validate(value: unknown): readonly GithubReceipt[] {
    const snapshot = object(value, ["version", "rows"]);
    if (snapshot.version !== 1 || !Array.isArray(snapshot.rows) || snapshot.rows.length > this.maxRows) fail("invalid snapshot rows/version");
    const deliveries = new Set<string>(); const ids = new Set<string>();
    return Object.freeze(snapshot.rows.map((value: unknown) => {
      const row = object(value, ["id", "deliveryId", "locator", "event", "receivedAt", "expiresAt"]);
      const envelope = snapshotGithubDelivery({ deliveryId: row.deliveryId, locator: row.locator, event: row.event }, this.maxEnvelopeBytes);
      if (canonicalizeStableJson(envelope.locator) !== canonicalizeStableJson(row.locator)) fail("noncanonical locator");
      if (typeof row.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(row.id)) fail("invalid receipt ID");
      if (typeof row.receivedAt !== "number" || !Number.isSafeInteger(row.receivedAt) || row.receivedAt < 0 ||
          typeof row.expiresAt !== "number" || !Number.isSafeInteger(row.expiresAt) || row.expiresAt <= row.receivedAt ||
          row.expiresAt - row.receivedAt > DEFAULT_RETENTION) fail("invalid receipt timestamps");
      if (deliveries.has(envelope.deliveryId) || ids.has(row.id)) fail("duplicate snapshot identity");
      deliveries.add(envelope.deliveryId); ids.add(row.id);
      return Object.freeze({ ...envelope, id: row.id, receivedAt: row.receivedAt, expiresAt: row.expiresAt });
    }));
  }
  private async read(): Promise<readonly GithubReceipt[]> {
    await this.checkParent();
    let entry;
    try { entry = await lstat(this.path); }
    catch (error) {
      if (code(error) !== "ENOENT") throw error;
      if ((await readdir(dirname(this.path))).some((name) => name.startsWith(`${basename(this.path)}.`) && name !== `${basename(this.path)}.lock`)) fail("missing snapshot beside publication remnants");
      return Object.freeze([]);
    }
    if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) fail("snapshot must be a regular file without links");
    const handle = await open(this.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.nlink !== 1 || before.size > this.maxSnapshotBytes) fail("snapshot exceeds byte limit or is not a regular file");
      const bytes = Buffer.alloc(before.size + 1); let used = 0;
      while (used < bytes.length) { const read = await handle.read(bytes, used, bytes.length - used, used); if (read.bytesRead === 0) break; used += read.bytesRead; }
      const after = await handle.stat();
      if (used !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || after.nlink !== 1) fail("snapshot changed while reading");
      return this.validate(parseStableJsonBytes(bytes.subarray(0, used)));
    } finally { await handle.close(); }
  }
  /** Returns retained transport metadata; does not imply any fetch succeeded. */
  load(): Promise<readonly GithubReceipt[]> { return this.locked(() => this.read()); }
  async receive(input: GithubDelivery): Promise<GithubReceiptResult> {
    const envelope = snapshotGithubDelivery(input, this.maxEnvelopeBytes);
    return this.locked(async () => {
      const rows = await this.read(); const now = this.now();
      if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(now + this.retentionMs)) fail("invalid clock value");
      const live = rows.filter((row) => row.expiresAt > now);
      const existing = live.find((row) => row.deliveryId === envelope.deliveryId);
      if (existing !== undefined && canonicalizeStableJson({ deliveryId: existing.deliveryId, locator: existing.locator, event: existing.event }) !== canonicalizeStableJson(envelope)) fail("delivery content conflict");
      if (existing === undefined && live.length >= this.maxRows) fail("unexpired receipt capacity exhausted");
      const receipt = existing ?? Object.freeze({ ...envelope, id: randomUUID(), receivedAt: now, expiresAt: now + this.retentionMs });
      if (existing === undefined || live.length !== rows.length) {
        const next = existing === undefined ? [...live, receipt] : live;
        const bytes = canonicalizeStableJson({ version: 1, rows: next });
        if (Buffer.byteLength(bytes) > this.maxSnapshotBytes) fail("snapshot exceeds byte limit");
        await writeFileAtomic(this.path, bytes, { mode: 0o600 });
      }
      return Object.freeze({ receipt, duplicate: existing !== undefined });
    });
  }
}
