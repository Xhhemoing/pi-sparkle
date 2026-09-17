import { createHash } from "node:crypto";
import { access, chmod, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunId } from "../domain/ids.js";
import { DomainValidationError } from "../domain/errors.js";
import { writeFileAtomic } from "../persist/atomic-file.js";
import { withExclusiveFileLock } from "../persist/file-lock.js";
import { runtimeRoot } from "../privacy/state-layout.js";
import { EventStore, runLockPath } from "../run/event-store.js";

const SHA256_HEX = /^[0-9a-f]{64}$/;
const ARTIFACT_SCHEMA = "loop-artifact-v1" as const;

/**
 * Run-scoped closed-loop artifacts. Covered by `deleteRunRecords` via the
 * whole `runtime/runs/<runId>/` subtree removal (same cascade as observations).
 */
export function loopArtifactsDir(stateRoot: string, runId: RunId): string {
  return join(runtimeRoot(stateRoot), "runs", runId, "loop-artifacts");
}

export function loopArtifactPath(stateRoot: string, runId: RunId, sha256: string): string {
  return join(loopArtifactsDir(stateRoot, runId), `${sha256}.json`);
}

export function runDirectoryPath(stateRoot: string, runId: RunId): string {
  return join(runtimeRoot(stateRoot), "runs", runId);
}

export function runEventsPath(stateRoot: string, runId: RunId): string {
  return join(runDirectoryPath(stateRoot, runId), "events.jsonl");
}

export interface LoopArtifactRef {
  readonly id: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly path: string;
  readonly schemaVersion: typeof ARTIFACT_SCHEMA;
}

export interface SaveLoopArtifactInput {
  readonly stateRoot: string;
  readonly runId: RunId;
  readonly body: unknown;
}

function sha256OfText(text: string): { hex: string; bytes: Buffer } {
  const bytes = Buffer.from(text, "utf8");
  const hex = createHash("sha256").update(bytes).digest("hex");
  return { hex, bytes };
}

/**
 * Durable run identity is a valid initialized event log, not merely an
 * existing `events.jsonl` file. Empty, corrupt, mid-corrupt, or
 * identity-mismatched logs are refused; a torn final line stays tolerated by
 * the existing EventStore recovery policy. Called under the run lock; the
 * EventStore read takes no lock (no nested same-lock acquisition).
 */
export async function assertRunPresent(stateRoot: string, runId: RunId): Promise<void> {
  try {
    await access(runEventsPath(stateRoot, runId));
  } catch {
    throw new DomainValidationError(
      `loop artifact refused: run directory missing for ${runId} (deleted or never created)`
    );
  }
  let events;
  try {
    ({ events } = await new EventStore(stateRoot, runId).readAll());
  } catch (err) {
    throw new DomainValidationError(
      `loop artifact refused: run event log for ${runId} is not a valid durable run: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  if (events.length === 0) {
    throw new DomainValidationError(
      `loop artifact refused: run event log for ${runId} is empty (never initialized; no RUN_CREATED)`
    );
  }
  if (events.some((event) => event.runId !== runId)) {
    throw new DomainValidationError(
      `loop artifact refused: run event log identity mismatch for ${runId}`
    );
  }
  if (!events.some((event) => event.type === "RUN_CREATED")) {
    throw new DomainValidationError(
      `loop artifact refused: run event log for ${runId} has no RUN_CREATED initialization`
    );
  }
}

/**
 * Persist a closed-loop artifact under the run subtree while holding the run
 * lock (same cooperative lock as ObservationStore / deleteRunRecords).
 */
export async function saveLoopArtifact(input: SaveLoopArtifactInput): Promise<LoopArtifactRef> {
  return withExclusiveFileLock(runLockPath(input.stateRoot, input.runId), async () => {
    await assertRunPresent(input.stateRoot, input.runId);
    const envelope = {
      schemaVersion: ARTIFACT_SCHEMA,
      runId: input.runId,
      body: input.body
    };
    const text = `${JSON.stringify(envelope, null, 2)}\n`;
    const { hex, bytes } = sha256OfText(text);
    if (!SHA256_HEX.test(hex)) {
      throw new DomainValidationError("loop artifact hash must be 64 lowercase hex chars");
    }
    const dir = loopArtifactsDir(input.stateRoot, input.runId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") {
      await chmod(dir, 0o700).catch(() => undefined);
    }
    const path = loopArtifactPath(input.stateRoot, input.runId, hex);
    await writeFileAtomic(path, text, { mode: 0o600 });
    return {
      id: `loop_${hex}`,
      sha256: hex,
      byteLength: bytes.byteLength,
      path,
      schemaVersion: ARTIFACT_SCHEMA
    };
  });
}

/**
 * Read a loop artifact and verify on-disk bytes still match the content
 * address and schema. Tampered JSON that still parses is rejected.
 */
export async function readLoopArtifact(
  stateRoot: string,
  runId: RunId,
  sha256: string
): Promise<unknown> {
  if (!SHA256_HEX.test(sha256)) {
    throw new DomainValidationError("loop artifact sha256 must be 64 lowercase hex chars");
  }
  return withExclusiveFileLock(runLockPath(stateRoot, runId), async () => {
    await assertRunPresent(stateRoot, runId);
    const path = loopArtifactPath(stateRoot, runId, sha256);
    const bytes = await readFile(path);
    const hex = createHash("sha256").update(bytes).digest("hex");
    if (hex !== sha256) {
      throw new DomainValidationError(
        "loop artifact content hash mismatch (tamper or wrong id)"
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString("utf8")) as unknown;
    } catch {
      throw new DomainValidationError("loop artifact JSON parse failed");
    }
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      !("schemaVersion" in parsed) ||
      (parsed as { schemaVersion?: unknown }).schemaVersion !== ARTIFACT_SCHEMA ||
      !("body" in parsed) ||
      !("runId" in parsed) ||
      (parsed as { runId?: unknown }).runId !== runId
    ) {
      throw new DomainValidationError("loop artifact schema/ref invalid");
    }
    return (parsed as { body: unknown }).body;
  });
}
