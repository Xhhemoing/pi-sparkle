import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { DomainValidationError } from "../domain/errors.js";

export interface FileLockOptions {
  readonly timeoutMs?: number;
  readonly retryMs?: number;
}

function errorCode(error: unknown): unknown {
  return error !== null && typeof error === "object" && "code" in error ? error.code : undefined;
}

function isOwnedBy(raw: string, ownerToken: string): boolean {
  try {
    const value = JSON.parse(raw) as unknown;
    return (
      value !== null &&
      typeof value === "object" &&
      "ownerToken" in value &&
      value.ownerToken === ownerToken
    );
  } catch {
    return false;
  }
}

/**
 * Acquires a cooperative lock and waits until timeout when a lock file already exists.
 * Locks are not stolen from stale-looking PIDs: PID reuse and shared filesystems make
 * liveness checks insufficient proof that the recorded owner cannot still be active.
 */
export async function withExclusiveFileLock<T>(
  lockPath: string,
  operation: () => Promise<T>,
  options: FileLockOptions = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const retryMs = options.retryMs ?? 10;
  const startedAt = Date.now();
  const ownerToken = randomUUID();
  await mkdir(dirname(lockPath), { recursive: true });

  let lock: Awaited<ReturnType<typeof open>> | undefined;
  while (lock === undefined) {
    try {
      lock = await open(lockPath, "wx");
    } catch (error: unknown) {
      if (errorCode(error) !== "EEXIST") throw error;
      if (Date.now() - startedAt >= timeoutMs) {
        throw new DomainValidationError(`timed out waiting for lock at ${lockPath}`);
      }
      await new Promise((resolve) => setTimeout(resolve, retryMs));
      continue;
    }

    try {
      await lock.writeFile(
        JSON.stringify({ ownerToken, pid: process.pid, acquiredAt: new Date().toISOString() }),
        "utf8"
      );
    } catch (error: unknown) {
      await lock.close().catch(() => undefined);
      await rm(lockPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  try {
    return await operation();
  } finally {
    await lock.close();
    const current = await readFile(lockPath, "utf8").catch(() => "");
    if (isOwnedBy(current, ownerToken)) {
      await rm(lockPath, { force: true });
    }
  }
}
