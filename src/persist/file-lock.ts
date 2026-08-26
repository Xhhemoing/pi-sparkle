import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { DomainValidationError } from "../domain/errors.js";

export interface FileLockOptions {
  readonly timeoutMs?: number;
  readonly retryMs?: number;
}

export const LOCK_TIMEOUT_CODE = "LOCK_TIMEOUT" as const;

export class FileLockTimeoutError extends DomainValidationError {
  readonly code = LOCK_TIMEOUT_CODE;
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
  const parentDir = dirname(lockPath);

  let lock: Awaited<ReturnType<typeof open>> | undefined;
  let contentionRetries = 0;
  while (lock === undefined) {
    try {
      lock = await open(lockPath, "wx", 0o600);
    } catch (error: unknown) {
      const code = errorCode(error);
      if (code === "ENOENT") {
        await mkdir(parentDir, { recursive: true });
        continue;
      }
      if (code !== "EEXIST") throw error;
      const remainingMs = timeoutMs - (Date.now() - startedAt);
      if (remainingMs <= 0) {
        throw new FileLockTimeoutError(`timed out waiting for lock at ${lockPath}`);
      }
      contentionRetries += 1;
      if (contentionRetries === 1) {
        // One I/O turn catches short holds without paying the timer floor.
        // Longer contention uses the caller's configured polling cadence.
        await new Promise<void>((resolve) => setImmediate(resolve));
      } else {
        await new Promise((resolve) => setTimeout(resolve, Math.min(retryMs, remainingMs)));
      }
      continue;
    }

    try {
      if (process.platform !== "win32") await lock.chmod(0o600);
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
