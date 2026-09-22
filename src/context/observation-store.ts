import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { DomainValidationError } from "../domain/errors.js";
import type { RunId } from "../domain/ids.js";
import { withExclusiveFileLock } from "../persist/file-lock.js";
import { runtimeRoot } from "../privacy/state-layout.js";

/** Per-observation object cap (8 MiB). */
export const OBSERVATION_MAX_OBJECT_BYTES = 8 * 1024 * 1024;
/** Per-run observation archive cap (64 MiB). */
export const OBSERVATION_MAX_RUN_ARCHIVE_BYTES = 64 * 1024 * 1024;
/** Recall page payload cap (16 KiB). */
export const OBSERVATION_MAX_RECALL_BYTES = 16_384;
/** Recall page line cap. */
export const OBSERVATION_MAX_RECALL_LINES = 400;

const V2_ID = /^obs_v2_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface ObservationRef {
  readonly id: string;
  readonly byteLength: number;
}

export interface ObservationPage {
  readonly text: string;
  readonly nextOffset: number;
  readonly eof: boolean;
}

export function observationsDir(stateRoot: string, runId: RunId): string {
  return join(runtimeRoot(stateRoot), "runs", runId, "observations");
}

/**
 * Dedicated lock for observation archive mutation/recall. Deliberately NOT
 * `runLockPath`: the coordinator holds the run lifecycle lock for the whole
 * run, and workers archive observations *during* the run — sharing that lock
 * would make every live `put` time out (live wiring, 2026-09-20).
 */
export function observationLockPath(stateRoot: string, runId: RunId): string {
  return join(observationsDir(stateRoot, runId), ".lock");
}

export function observationObjectsDir(stateRoot: string, runId: RunId): string {
  return join(observationsDir(stateRoot, runId), "objects");
}

export function observationObjectPath(stateRoot: string, runId: RunId, id: string): string {
  if (!V2_ID.test(id)) throw new DomainValidationError("observation object id must be a v2 opaque id");
  return join(observationObjectsDir(stateRoot, runId), `${id}.txt`);
}

function errorCode(error: unknown): string | undefined {
  return error !== null && typeof error === "object" && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

async function ensureOwnerDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    await chmod(path, 0o700).catch(() => undefined);
  }
}

/**
 * Refuse symlinks (and non-regular files) at `path`. Missing is fine.
 * Returns the lstat when the path exists.
 */
async function assertRegularOrMissing(
  path: string,
  label: string
): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  let st: Awaited<ReturnType<typeof lstat>>;
  try {
    st = await lstat(path);
  } catch (error: unknown) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
  if (st.isSymbolicLink()) {
    throw new DomainValidationError(`${label} refuses symlinks: ${path}`);
  }
  if (!st.isFile() && !st.isDirectory()) {
    throw new DomainValidationError(`${label} requires a regular file or directory: ${path}`);
  }
  return st;
}

async function archiveByteSize(objectsDir: string): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(objectsDir);
  } catch (error: unknown) {
    if (errorCode(error) === "ENOENT") return 0;
    throw error;
  }
  let total = 0;
  for (const name of entries) {
    if (!name.endsWith(".txt")) continue;
    const path = join(objectsDir, name);
    const st = await assertRegularOrMissing(path, "observation archive");
    if (st === undefined || !st.isFile()) continue;
    total += Number(st.size);
  }
  return total;
}

/**
 * Publish `bytes` at `path` with mode 0600 via temp+rename. Callers hold the
 * run lock and own serialization. On EEXIST the caller verifies reuse.
 */
async function writeObjectAtomic(path: string, bytes: Buffer): Promise<"created" | "exists"> {
  await ensureOwnerDir(dirname(path));
  const existing = await assertRegularOrMissing(path, "observation object");
  if (existing !== undefined) {
    if (!existing.isFile()) {
      throw new DomainValidationError(`observation object is not a regular file: ${path}`);
    }
    return "exists";
  }

  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let published = false;
  try {
    const handle = await open(tempPath, "wx", 0o600);
    try {
      if (process.platform !== "win32") await handle.chmod(0o600);
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(tempPath, path);
      published = true;
      return "created";
    } catch (error: unknown) {
      if (errorCode(error) === "EEXIST") {
        published = false;
        return "exists";
      }
      throw error;
    }
  } finally {
    if (!published) await rm(tempPath, { force: true }).catch(() => undefined);
  }
}

function isSafeNonNegInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Advance `offset` forward to the next UTF-8 character boundary within `buf`. */
function alignUtf8Offset(buf: Buffer, offset: number): number {
  if (offset <= 0) return 0;
  if (offset >= buf.length) return buf.length;
  let i = offset;
  // Continuation bytes are 10xxxxxx. Walk forward until a lead byte or end.
  while (i < buf.length && (buf[i]! & 0xc0) === 0x80) i += 1;
  return i;
}

/**
 * Run-scoped observation archive. Object ids are opaque locators, not integrity proofs.
 */
export class ObservationStore {
  readonly stateRoot: string;
  readonly runId: RunId;

  constructor(stateRoot: string, runId: RunId) {
    this.stateRoot = stateRoot;
    this.runId = runId;
  }

  async put(text: string): Promise<ObservationRef> {
    if (typeof text !== "string") {
      throw new DomainValidationError("observation put requires a UTF-8 string");
    }
    const bytes = Buffer.from(text, "utf8");
    if (bytes.byteLength > OBSERVATION_MAX_OBJECT_BYTES) {
      throw new DomainValidationError(
        `observation object exceeds the 8 MiB per-observation cap (${bytes.byteLength} bytes)`
      );
    }

    return withExclusiveFileLock(observationLockPath(this.stateRoot, this.runId), async () => {
      const objectsDir = observationObjectsDir(this.stateRoot, this.runId);
      await ensureOwnerDir(observationsDir(this.stateRoot, this.runId));
      await ensureOwnerDir(objectsDir);

      // Refuse a symlinked objects directory (or observations parent).
      const obsSt = await assertRegularOrMissing(
        observationsDir(this.stateRoot, this.runId),
        "observation archive"
      );
      if (obsSt !== undefined && !obsSt.isDirectory()) {
        throw new DomainValidationError("observation archive path is not a directory");
      }
      const objDirSt = await assertRegularOrMissing(objectsDir, "observation objects");
      if (objDirSt !== undefined && !objDirSt.isDirectory()) {
        throw new DomainValidationError("observation objects path is not a directory");
      }

      const existingId = await this.findExact(objectsDir, bytes);
      const id = existingId ?? `obs_v2_${randomUUID()}`;
      const path = observationObjectPath(this.stateRoot, this.runId, id);
      // Preflight quota for a *new* object. Exact-byte reuse must not re-count.
      if (existingId === undefined) {
        const used = await archiveByteSize(objectsDir);
        if (used + bytes.byteLength > OBSERVATION_MAX_RUN_ARCHIVE_BYTES) {
          throw new DomainValidationError(
            `observation archive would exceed the 64 MiB per-run quota (used ${used} + ${bytes.byteLength} bytes)`
          );
        }
      }

      const outcome = await writeObjectAtomic(path, bytes);
      if (outcome === "exists") await this.assertExistingMatches(path, bytes);
      if (process.platform !== "win32") await chmod(path, 0o600).catch(() => undefined);
      return { id, byteLength: bytes.byteLength };
    });
  }

  async recall(ref: ObservationRef, offset: number = 0): Promise<ObservationPage> {
    this.validateRef(ref);
    if (!isSafeNonNegInt(offset)) {
      throw new DomainValidationError("observation recall offset must be a non-negative safe integer");
    }

    return withExclusiveFileLock(observationLockPath(this.stateRoot, this.runId), async () => {
      const path = observationObjectPath(this.stateRoot, this.runId, ref.id);
      const st = await assertRegularOrMissing(path, "observation object");
      if (st === undefined) {
        throw new DomainValidationError(`observation object not found for ${ref.id}`);
      }
      if (!st.isFile()) {
        throw new DomainValidationError(`observation object is not a regular file: ${path}`);
      }
      const bytes = await readFile(path);
      if (bytes.byteLength !== ref.byteLength) {
        throw new DomainValidationError(
          `observation byteLength mismatch for ${ref.id}: stored ${bytes.byteLength}, ref ${ref.byteLength}`
        );
      }

      const start = alignUtf8Offset(bytes, offset);
      if (start >= bytes.byteLength) {
        return { text: "", nextOffset: bytes.byteLength, eof: true };
      }

      let end = Math.min(bytes.byteLength, start + OBSERVATION_MAX_RECALL_BYTES);
      end = alignUtf8End(bytes, start, end);

      // Cap by line count without splitting the final included line's bytes.
      const slice = bytes.subarray(start, end);
      const limited = limitByLines(slice, OBSERVATION_MAX_RECALL_LINES);
      const text = limited.toString("utf8");
      const nextOffset = start + limited.byteLength;
      return {
        text,
        nextOffset,
        eof: nextOffset >= bytes.byteLength
      };
    });
  }

  private validateRef(ref: ObservationRef): void {
    if (typeof ref !== "object" || ref === null) {
      throw new DomainValidationError("observation ref is required");
    }
    if (typeof ref.id !== "string" || !V2_ID.test(ref.id)) {
      throw new DomainValidationError("observation ref id must be a v2 opaque id; legacy ids are refused");
    }
    if (!isSafeNonNegInt(ref.byteLength)) {
      throw new DomainValidationError("observation ref byteLength must be a non-negative safe integer");
    }
  }

  private async findExact(objectsDir: string, bytes: Buffer): Promise<string | undefined> {
    let names: string[];
    try { names = await readdir(objectsDir); } catch (error: unknown) {
      if (errorCode(error) === "ENOENT") return undefined;
      throw error;
    }
    for (const name of names) {
      if (!name.endsWith(".txt")) continue;
      const id = name.slice(0, -4);
      if (!V2_ID.test(id)) continue;
      const path = join(objectsDir, name);
      const st = await assertRegularOrMissing(path, "observation object");
      if (st === undefined || !st.isFile() || st.size !== bytes.byteLength) continue;
      if ((await readFile(path)).equals(bytes)) return id;
    }
    return undefined;
  }

  private async assertExistingMatches(path: string, bytes: Buffer): Promise<void> {
    const st = await assertRegularOrMissing(path, "observation object");
    if (st === undefined || !st.isFile()) {
      throw new DomainValidationError(`observation object missing after EEXIST: ${path}`);
    }
    const existing = await readFile(path);
    if (!existing.equals(bytes)) {
      throw new DomainValidationError(`observation object content mismatch at ${path}: refuse to reuse`);
    }
  }
}

/** Walk end backward so we do not end mid-codepoint. */
function alignUtf8End(buf: Buffer, start: number, end: number): number {
  if (end >= buf.length) return buf.length;
  if (end <= start) return start;
  let i = end;
  while (i > start && (buf[i]! & 0xc0) === 0x80) i -= 1;
  // If we landed on a multi-byte lead that cannot finish before end, drop it.
  if (i > start) {
    const lead = buf[i]!;
    const need =
      lead < 0x80 ? 1 : lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : lead < 0xf8 ? 4 : 1;
    if (i + need > end) return i;
  }
  return end;
}

function limitByLines(slice: Buffer, maxLines: number): Buffer {
  if (maxLines <= 0) return Buffer.alloc(0);
  let lines = 0;
  let last = slice.byteLength;
  for (let i = 0; i < slice.byteLength; i += 1) {
    if (slice[i] === 0x0a) {
      lines += 1;
      if (lines >= maxLines) {
        last = i + 1;
        break;
      }
    }
  }
  // If fewer than maxLines newlines, keep the whole slice (final partial line ok).
  if (lines < maxLines) return slice;
  return slice.subarray(0, last);
}

