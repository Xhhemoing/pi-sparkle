import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

export interface AtomicWriteOptions {
  /** Injection seam so the rename fallback can be exercised portably. Defaults to fs.rename. */
  readonly rename?: (source: string, destination: string) => Promise<void>;
  /** Injection seam for the temp-name suffix. Defaults to a random UUID. */
  readonly uniqueSuffix?: () => string;
}

/** The `writeFileAtomicSync` mirror of `AtomicWriteOptions`; the seams are synchronous. */
export interface AtomicWriteSyncOptions {
  /** Injection seam so the rename fallback can be exercised portably. Defaults to fs.renameSync. */
  readonly rename?: (source: string, destination: string) => void;
  /** Injection seam for the temp-name suffix. Defaults to a random UUID. */
  readonly uniqueSuffix?: () => string;
}

/** Rename failures a same-directory replace can still recover from (Windows, and hardened mounts). */
const RENAME_FALLBACK_CODES = new Set(["EPERM", "EEXIST", "EACCES"]);

const MAX_TEMP_NAME_ATTEMPTS = 3;

function errorCode(error: unknown): unknown {
  return error !== null && typeof error === "object" && "code" in error ? error.code : undefined;
}

function tempName(path: string, uniqueSuffix: () => string): string {
  return `${path}.${process.pid}.${uniqueSuffix()}.tmp`;
}

async function openUniqueTemp(
  path: string,
  uniqueSuffix: () => string
): Promise<{ tempPath: string; handle: Awaited<ReturnType<typeof open>> }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_TEMP_NAME_ATTEMPTS; attempt += 1) {
    const tempPath = tempName(path, uniqueSuffix);
    try {
      // "wx" never truncates: a temp left behind by a crashed writer is refused, not adopted.
      return { tempPath, handle: await open(tempPath, "wx") };
    } catch (error: unknown) {
      if (errorCode(error) !== "EEXIST") throw error;
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * Publishes `contents` at `path` by writing a uniquely named temp file in the same directory,
 * fsyncing it, and renaming it over the destination. Concurrent writers therefore never share a
 * temp inode, so a reader observes either the previous file or one writer's complete payload.
 * Callers own serialization: the bytes handed in are the bytes published.
 */
export async function writeFileAtomic(
  path: string,
  contents: string,
  options: AtomicWriteOptions = {}
): Promise<void> {
  const renameFile = options.rename ?? rename;
  const uniqueSuffix = options.uniqueSuffix ?? randomUUID;
  await mkdir(dirname(path), { recursive: true });

  const { tempPath, handle } = await openUniqueTemp(path, uniqueSuffix);
  let published = false;
  try {
    try {
      await handle.writeFile(contents, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await renameFile(tempPath, path);
    } catch (error: unknown) {
      if (!RENAME_FALLBACK_CODES.has(String(errorCode(error)))) throw error;
      await rm(path, { force: true });
      await renameFile(tempPath, path);
    }
    published = true;
  } finally {
    if (!published) await rm(tempPath, { force: true }).catch(() => undefined);
  }
}

function openUniqueTempSync(
  path: string,
  uniqueSuffix: () => string
): { tempPath: string; fd: number } {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_TEMP_NAME_ATTEMPTS; attempt += 1) {
    const tempPath = tempName(path, uniqueSuffix);
    try {
      return { tempPath, fd: openSync(tempPath, "wx") };
    } catch (error: unknown) {
      if (errorCode(error) !== "EEXIST") throw error;
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * `writeFileAtomic` for callers whose own API is synchronous and therefore cannot await it —
 * the preference store, whose `recordPreference`/`deleteObservation` persist inline. Same
 * publish protocol (unique temp, `"wx"`, fsync, rename with the unlink fallback) and the same
 * guarantee: a reader sees the previous file or this call's whole payload, never a splice.
 * Prefer the async writer wherever the call site can await.
 */
export function writeFileAtomicSync(
  path: string,
  contents: string,
  options: AtomicWriteSyncOptions = {}
): void {
  const renameFile = options.rename ?? renameSync;
  const uniqueSuffix = options.uniqueSuffix ?? randomUUID;
  mkdirSync(dirname(path), { recursive: true });

  const { tempPath, fd } = openUniqueTempSync(path, uniqueSuffix);
  let published = false;
  try {
    try {
      writeFileSync(fd, contents, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      renameFile(tempPath, path);
    } catch (error: unknown) {
      if (!RENAME_FALLBACK_CODES.has(String(errorCode(error)))) throw error;
      rmSync(path, { force: true });
      renameFile(tempPath, path);
    }
    published = true;
  } finally {
    if (!published) {
      try {
        rmSync(tempPath, { force: true });
      } catch {
        // Best-effort cleanup of this call's own temp; the original failure is what matters.
      }
    }
  }
}
