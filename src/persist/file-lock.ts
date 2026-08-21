import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { DomainValidationError } from "../domain/errors.js";

export interface FileLockOptions {
  readonly timeoutMs?: number;
  readonly retryMs?: number;
}

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
      await lock.writeFile(
        JSON.stringify({ ownerToken, pid: process.pid, acquiredAt: new Date().toISOString() }),
        "utf8"
      );
    } catch (error: unknown) {
      const code = error !== null && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code !== "EEXIST") throw error;
      if (Date.now() - startedAt >= timeoutMs) {
        throw new DomainValidationError(`timed out waiting for lock at ${lockPath}`);
      }
      await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  }

  try {
    return await operation();
  } finally {
    await lock.close();
    const current = await readFile(lockPath, "utf8").catch(() => "");
    if (current.includes(`"ownerToken":"${ownerToken}"`)) {
      await rm(lockPath, { force: true });
    }
  }
}
