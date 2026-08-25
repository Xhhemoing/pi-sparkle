import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../persist/atomic-file.js";
import { withExclusiveFileLock, type FileLockOptions } from "../persist/file-lock.js";
import { runtimeRoot } from "../privacy/state-layout.js";
import { DomainValidationError } from "../domain/errors.js";
import type { RunId } from "../domain/ids.js";
import { isRecord } from "../domain/record.js";
import { isIsoTimestamp, nowIso, type IsoTimestamp } from "../domain/timestamp.js";
import { runLockPath } from "./event-store.js";

export interface PauseToken {
  readonly paused: boolean;
  readonly requestedAt?: IsoTimestamp;
  readonly reason?: string;
}

export interface PauseController {
  requestPause(runId: RunId, reason?: string): Promise<PauseToken>;
  clearPause(runId: RunId): Promise<void>;
  token(runId: RunId): Promise<PauseToken>;
}

function pausePath(stateRoot: string, runId: RunId): string {
  return join(runtimeRoot(stateRoot), "runs", runId, "pause.json");
}

function parsePauseToken(raw: string): PauseToken {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DomainValidationError("malformed pause.json: not valid JSON");
  }
  if (!isRecord(parsed) || parsed.paused !== true) {
    throw new DomainValidationError("malformed pause.json: paused must be true");
  }
  if (!isIsoTimestamp(parsed.requestedAt)) {
    throw new DomainValidationError("malformed pause.json: requestedAt must be a valid IsoTimestamp");
  }
  if (parsed.reason !== undefined && (typeof parsed.reason !== "string" || parsed.reason.trim() === "")) {
    throw new DomainValidationError("malformed pause.json: reason must be a non-empty string");
  }
  return {
    paused: true,
    requestedAt: parsed.requestedAt,
    ...(parsed.reason !== undefined ? { reason: parsed.reason } : {})
  };
}

/**
 * Removes a run's pause token and reports whether *this* call is the one that
 * removed it.
 *
 * Narrow on purpose. `PauseController.clearPause` keeps returning `void`, so
 * the controller's embedders and test doubles are untouched; only a caller
 * whose output claims work — the CLI's `pause --clear` — needs the result. It
 * comes from the unlink rather than from reading the token first: the clear is
 * deliberately unlocked, so a `paused` flag observed before the unlink is a
 * guess about a file a concurrent `pause` may have written or removed since.
 * A token that will not parse is still a token, and unlinking it is still a
 * clear.
 */
export async function unlinkPauseToken(
  stateRoot: string,
  runId: RunId
): Promise<{ readonly removed: boolean }> {
  const removed = await unlink(pausePath(stateRoot, runId)).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  );
  return { removed };
}

/**
 * `lockOptions` bounds the run-scoped cooperative lock `requestPause` takes
 * (`runLockPath`), so a pause request and a `delete --run` of the same run
 * cannot interleave: writing `pause.json` creates the run directory, which
 * would otherwise put a subtree the delete just removed straight back.
 * `token()` reads without the lock — the file is published by rename.
 */
export function createFilePauseController(
  stateRoot: string,
  now: () => IsoTimestamp = nowIso,
  lockOptions: FileLockOptions = {}
): PauseController {
  return {
    async requestPause(runId, reason) {
      if (reason !== undefined && reason.trim() === "") {
        throw new DomainValidationError("pause reason must be a non-empty string");
      }
      const token: PauseToken = {
        paused: true,
        requestedAt: now(),
        ...(reason !== undefined ? { reason } : {})
      };
      await withExclusiveFileLock(
        runLockPath(stateRoot, runId),
        () => writeFileAtomic(pausePath(stateRoot, runId), `${JSON.stringify(token, null, 2)}\n`),
        lockOptions
      );
      return token;
    },
    // Unlocked on purpose: an unlink cannot recreate the run directory, so
    // clearing a pause has nothing for a `delete --run` to lose a race with.
    // Taking the lock here would only make a clear create `runtime/runs/`.
    async clearPause(runId) {
      await unlinkPauseToken(stateRoot, runId);
    },
    async token(runId) {
      const raw = await readFile(pausePath(stateRoot, runId), "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (raw === undefined) return { paused: false };
      return parsePauseToken(raw);
    }
  };
}
