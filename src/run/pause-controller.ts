import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../persist/atomic-file.js";
import { runtimeRoot } from "../privacy/state-layout.js";
import { DomainValidationError } from "../domain/errors.js";
import type { RunId } from "../domain/ids.js";
import { isRecord } from "../domain/record.js";
import { isIsoTimestamp, nowIso, type IsoTimestamp } from "../domain/timestamp.js";

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

export function createFilePauseController(
  stateRoot: string,
  now: () => IsoTimestamp = nowIso
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
      await writeFileAtomic(pausePath(stateRoot, runId), `${JSON.stringify(token, null, 2)}\n`);
      return token;
    },
    async clearPause(runId) {
      await unlink(pausePath(stateRoot, runId)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
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
