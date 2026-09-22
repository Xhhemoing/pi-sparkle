import { randomUUID } from "node:crypto";
import { access, chmod, lstat, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunId } from "../domain/ids.js";
import { DomainValidationError } from "../domain/errors.js";
import { writeFileAtomic } from "../persist/atomic-file.js";
import { withExclusiveFileLock } from "../persist/file-lock.js";
import { runtimeRoot } from "../privacy/state-layout.js";
import { EventStore, runLockPath } from "../run/event-store.js";
import type { Event } from "../run/events.js";

const ARTIFACT_SCHEMA = "loop-artifact-v2" as const;
const OPAQUE_ID = /^art_v2_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LEGACY_HEX_ID = /^[0-9a-f]{64}$/;

/**
 * Run-scoped closed-loop artifacts. Covered by `deleteRunRecords` via the
 * whole `runtime/runs/<runId>/` subtree removal (same cascade as observations).
 * The filename is an opaque locator, not a content digest.
 */
export function loopArtifactsDir(stateRoot: string, runId: RunId): string {
  return join(runtimeRoot(stateRoot), "runs", runId, "loop-artifacts");
}

export function loopArtifactPath(stateRoot: string, runId: RunId, id: string): string {
  assertOpaqueArtifactId(id);
  return join(loopArtifactsDir(stateRoot, runId), `${id}.json`);
}

export function runDirectoryPath(stateRoot: string, runId: RunId): string {
  return join(runtimeRoot(stateRoot), "runs", runId);
}

export function runEventsPath(stateRoot: string, runId: RunId): string {
  return join(runDirectoryPath(stateRoot, runId), "events.jsonl");
}

export interface LoopArtifactRef {
  readonly id: string;
  readonly byteLength: number;
  readonly path: string;
  readonly schemaVersion: typeof ARTIFACT_SCHEMA;
}

export interface SaveLoopArtifactInput {
  readonly stateRoot: string;
  readonly runId: RunId;
  readonly body: unknown;
  /** Test/injection seam. Production callers omit it and receive a random id. */
  readonly id?: string;
}

function assertOpaqueArtifactId(id: string): void {
  if (LEGACY_HEX_ID.test(id)) {
    throw new DomainValidationError(
      "loop artifact legacy 64-hex id refused; lookup requires an opaque art_v2 id"
    );
  }
  if (!OPAQUE_ID.test(id)) {
    throw new DomainValidationError("loop artifact id must be an opaque art_v2 id");
  }
}

function errorCode(error: unknown): string | undefined {
  return error !== null && typeof error === "object" && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

/** Refuse a symlink at `path` before any write. Missing paths are allowed. */
async function assertNotSymlink(path: string): Promise<void> {
  try {
    const st = await lstat(path);
    if (st.isSymbolicLink()) {
      throw new DomainValidationError(`loop artifact refuses symlinks: ${path}`);
    }
  } catch (error: unknown) {
    if (error instanceof DomainValidationError) throw error;
    if (errorCode(error) === "ENOENT") return;
    throw error;
  }
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
  const creations = events.filter((event): event is Extract<Event, { type: "RUN_CREATED" }> => event.type === "RUN_CREATED");
  if (creations.length === 0) {
    throw new DomainValidationError(
      `loop artifact refused: run event log for ${runId} has no RUN_CREATED initialization`
    );
  }
  // Durable identity is the run id inside the creation payload, not merely the
  // envelope: a log whose envelopes all match but whose RUN_CREATED payload
  // names a different run must not authorize work for ${runId}.
  if (creations.some((event) => event.payload.run.id !== runId)) {
    throw new DomainValidationError(
      `loop artifact refused: RUN_CREATED payload names a different run than ${runId}`
    );
  }
}

/**
 * Persist a closed-loop artifact under the run subtree while holding the run
 * lock (same cooperative lock as ObservationStore / deleteRunRecords).
 * The id is an opaque locator. Nothing here hashes the payload.
 */
export async function saveLoopArtifact(input: SaveLoopArtifactInput): Promise<LoopArtifactRef> {
  const id = input.id ?? `art_v2_${randomUUID()}`;
  assertOpaqueArtifactId(id);
  const path = loopArtifactPath(input.stateRoot, input.runId, id);
  return withExclusiveFileLock(runLockPath(input.stateRoot, input.runId), async () => {
    await assertRunPresent(input.stateRoot, input.runId);
    await assertNotSymlink(loopArtifactsDir(input.stateRoot, input.runId));
    await assertNotSymlink(path);
    const dir = loopArtifactsDir(input.stateRoot, input.runId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") {
      await chmod(dir, 0o700).catch(() => undefined);
    }
    await assertNotSymlink(path);
    const envelope = {
      schemaVersion: ARTIFACT_SCHEMA,
      runId: input.runId,
      id,
      body: input.body
    };
    const bare = Buffer.byteLength(`${JSON.stringify({ ...envelope, byteLength: 0 }, null, 2)}\n`, "utf8");
    const width = String(bare).length;
    const byteLength = bare + width - 1;
    if (String(byteLength).length !== width) {
      throw new DomainValidationError("loop artifact byteLength could not be recorded stably");
    }
    const text = `${JSON.stringify({ ...envelope, byteLength }, null, 2)}\n`;
    if (Buffer.byteLength(text, "utf8") !== byteLength) {
      throw new DomainValidationError("loop artifact byteLength could not be recorded stably");
    }
    await writeFileAtomic(path, text, { mode: 0o600 });
    return {
      id,
      byteLength,
      path,
      schemaVersion: ARTIFACT_SCHEMA
    };
  });
}

/**
 * Read a loop artifact by opaque id. Schema and a recorded byte length are
 * checked; the bytes are not cryptographically verified, so an equal-length
 * replacement is not detected.
 */
export async function readLoopArtifact(
  stateRoot: string,
  runId: RunId,
  id: string
): Promise<unknown> {
  assertOpaqueArtifactId(id);
  return withExclusiveFileLock(runLockPath(stateRoot, runId), async () => {
    await assertRunPresent(stateRoot, runId);
    const path = loopArtifactPath(stateRoot, runId, id);
    const bytes = await readFile(path);
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
      (parsed as { runId?: unknown }).runId !== runId ||
      !("id" in parsed) ||
      (parsed as { id?: unknown }).id !== id
    ) {
      throw new DomainValidationError("loop artifact schema/ref invalid");
    }
    const recorded = (parsed as { byteLength?: unknown }).byteLength;
    if (recorded !== undefined) {
      if (typeof recorded !== "number" || !Number.isSafeInteger(recorded) || recorded < 0) {
        throw new DomainValidationError("loop artifact byteLength is invalid");
      }
      if (recorded !== bytes.byteLength) {
        throw new DomainValidationError(
          `loop artifact byteLength mismatch: stored ${bytes.byteLength}, recorded ${recorded}`
        );
      }
    }
    return (parsed as { body: unknown }).body;
  });
}
