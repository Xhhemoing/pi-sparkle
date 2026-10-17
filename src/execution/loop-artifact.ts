import { randomUUID } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { access, chmod, lstat, mkdir, open, readFile } from "node:fs/promises";
import { dirname, join, parse, resolve, sep } from "node:path";
import { parseRunId, type RunId } from "../domain/ids.js";
import { DomainValidationError } from "../domain/errors.js";
import { writeFileAtomic } from "../persist/atomic-file.js";
import { withExclusiveFileLock } from "../persist/file-lock.js";
import { runtimeRoot } from "../persist/state-layout.js";
import { EventStore, runLockPath, type EventLogReadLimits } from "../run/event-store.js";
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

/** Opt-in read bounds; omitted options preserve the legacy reader contract. */
export interface LoopArtifactReadOptions {
  readonly maxBytes: number;
  readonly eventLogLimits: EventLogReadLimits;
}

function readOptionsObject(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new DomainValidationError("loop artifact read options must be ordinary objects");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== fields.length || fields.some((field) =>
    descriptors[field] === undefined || !("value" in descriptors[field]))) {
    throw new DomainValidationError("loop artifact read options require ordinary values for every limit");
  }
  const result: Record<string, unknown> = {};
  for (const field of fields) result[field] = descriptors[field]!.value;
  return result;
}

function positiveReadLimit(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new DomainValidationError(`loop artifact ${name} limit must be a positive safe integer`);
  }
  return value;
}

function snapshotEventLimits(input: EventLogReadLimits): EventLogReadLimits {
  const values = readOptionsObject(input, ["maxBytes", "maxRecords"]);
  return Object.freeze({ maxBytes: positiveReadLimit(values.maxBytes, "event maxBytes"),
    maxRecords: positiveReadLimit(values.maxRecords, "event maxRecords") });
}

function snapshotReadOptions(input: LoopArtifactReadOptions): LoopArtifactReadOptions {
  const values = readOptionsObject(input, ["maxBytes", "eventLogLimits"]);
  return Object.freeze({ maxBytes: positiveReadLimit(values.maxBytes, "maxBytes"),
    eventLogLimits: snapshotEventLimits(values.eventLogLimits as EventLogReadLimits) });
}

interface PathObservation {
  readonly path: string;
  readonly stat: BigIntStats;
}
interface BoundedPathObservation extends PathObservation {
  readonly parents: readonly PathObservation[];
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode && left.nlink === right.nlink;
}
function sameFile(left: BigIntStats, right: BigIntStats): boolean {
  return sameIdentity(left, right) && left.size === right.size
    && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

async function inspectBoundedPath(file: string, maxBytes: number): Promise<BoundedPathObservation> {
  const absolute = resolve(file);
  const parent = dirname(absolute);
  let cursor = parse(parent).root;
  const parents: PathObservation[] = [];
  for (const component of parent.slice(cursor.length).split(sep).filter(Boolean)) {
    cursor = join(cursor, component);
    const stat = await lstat(cursor, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new DomainValidationError("bounded loop artifact parent must be a nonlinked directory");
    }
    parents.push({ path: cursor, stat });
  }
  const stat = await lstat(absolute, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) {
    throw new DomainValidationError("bounded loop artifact and event log must be nonlinked regular files");
  }
  if (stat.size > BigInt(maxBytes)) throw new DomainValidationError("bounded loop artifact read exceeds byte limit");
  return { path: absolute, stat, parents };
}

async function assertStableBoundedPath(observation: BoundedPathObservation): Promise<void> {
  for (const parent of observation.parents) {
    if (!sameIdentity(parent.stat, await lstat(parent.path, { bigint: true }))) {
      throw new DomainValidationError("bounded loop artifact parent identity changed during read");
    }
  }
  if (!sameFile(observation.stat, await lstat(observation.path, { bigint: true }))) {
    throw new DomainValidationError("bounded loop artifact path changed during read");
  }
}

async function readBoundedArtifact(file: string, maxBytes: number): Promise<Buffer> {
  const observation = await inspectBoundedPath(file, maxBytes);
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !sameFile(observation.stat, before)) {
      throw new DomainValidationError("bounded loop artifact identity changed before read");
    }
    if (before.size > BigInt(maxBytes)) throw new DomainValidationError("bounded loop artifact read exceeds byte limit");
    // The opened descriptor fixes both identity and allocation size. Concurrent
    // growth cannot cause readFile-style unbounded allocation; one probe byte
    // detects growth while the before/after metadata detects other changes.
    const bytes = Buffer.alloc(Number(before.size));
    let used = 0;
    while (used < bytes.length) {
      const { bytesRead } = await handle.read(bytes, used, bytes.length - used, used);
      if (bytesRead === 0) throw new DomainValidationError("bounded loop artifact changed or truncated during read");
      used += bytesRead;
    }
    const extra = Buffer.alloc(1);
    if ((await handle.read(extra, 0, 1, used)).bytesRead !== 0
      || !sameFile(before, await handle.stat({ bigint: true }))) {
      throw new DomainValidationError("bounded loop artifact changed during read");
    }
    await assertStableBoundedPath(observation);
    return bytes;
  } finally { await handle.close(); }
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
export async function assertRunPresent(stateRoot: string, runId: RunId, eventLogLimits?: EventLogReadLimits): Promise<void> {
  const limits = eventLogLimits === undefined ? undefined : snapshotEventLimits(eventLogLimits);
  if (limits !== undefined) parseRunId(runId);
  try {
    await access(runEventsPath(stateRoot, runId));
  } catch {
    throw new DomainValidationError(
      `loop artifact refused: run directory missing for ${runId} (deleted or never created)`
    );
  }
  let events;
  try {
    const observation = limits === undefined ? undefined : await inspectBoundedPath(runEventsPath(stateRoot, runId), limits.maxBytes);
    ({ events } = await new EventStore(stateRoot, runId).readAll(limits));
    if (observation !== undefined) await assertStableBoundedPath(observation);
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
  id: string,
  options?: LoopArtifactReadOptions
): Promise<unknown> {
  assertOpaqueArtifactId(id);
  const bounds = options === undefined ? undefined : snapshotReadOptions(options);
  if (bounds !== undefined) {
    parseRunId(runId);
    // Inspect before lock creation as well as under the lock. Missing or linked
    // storage is refused without creating a new run-directory hierarchy.
    await inspectBoundedPath(runEventsPath(stateRoot, runId), bounds.eventLogLimits.maxBytes);
    await inspectBoundedPath(loopArtifactPath(stateRoot, runId, id), bounds.maxBytes);
  }
  return withExclusiveFileLock(runLockPath(stateRoot, runId), async () => {
    await assertRunPresent(stateRoot, runId, bounds?.eventLogLimits);
    const path = loopArtifactPath(stateRoot, runId, id);
    const bytes = bounds === undefined ? await readFile(path) : await readBoundedArtifact(path, bounds.maxBytes);
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
