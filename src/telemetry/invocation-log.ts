import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DomainValidationError } from "../domain/errors.js";
import { withExclusiveFileLock, type FileLockOptions } from "../persist/file-lock.js";
import { appendJsonlLine, readJsonlObjects, type JsonlRecovery } from "../persist/jsonl.js";
import { runtimeRoot } from "../privacy/state-layout.js";
import { validateInvocation, type ModelInvocation } from "./model-invocation.js";

/**
 * The one writer surface for the shared `runtime/invocations.jsonl`.
 *
 * The log is global (one file per state root, rows from every run), so it has
 * two very different writers: the live executor appends a row per model call,
 * and `delete --run` filter-rewrites the whole file to drop one run's rows.
 * A read-filter-write rewrite is not atomic against an append — an append that
 * lands after the rewrite's read but before its `writeFile` is silently
 * clobbered — so both writers go through the same cooperative lock
 * (`invocations.jsonl.lock`) via this module. Anything that appends to or
 * rewrites the log outside `appendInvocationRecord` /
 * `withInvocationLogLock` reopens that race.
 *
 * Readers are deliberately lock-free: `loadInvocationsFromStateRoot` skips
 * rows it cannot parse, so a torn tail costs a calibration sample rather than
 * blocking a live run behind a writer's lock.
 */

export const INVOCATIONS_LOG = "invocations.jsonl";

export function invocationsLogPath(stateRoot: string): string {
  return join(runtimeRoot(stateRoot), INVOCATIONS_LOG);
}

/** Cooperative lock guarding every write to the shared log. */
export function invocationLogLockPath(stateRoot: string): string {
  return `${invocationsLogPath(stateRoot)}.lock`;
}

export interface AppendInvocationOptions extends FileLockOptions {
  /** fsync the log after the append. Off by default: telemetry is not evidence. */
  readonly fsync?: boolean;
}

/**
 * Run `operation` while holding the log's exclusive lock. Rewriters (the
 * privacy delete cascade) use this so a live append cannot interleave with a
 * read-filter-write cycle.
 */
export async function withInvocationLogLock<T>(
  stateRoot: string,
  operation: () => Promise<T>,
  options: FileLockOptions = {}
): Promise<T> {
  return withExclusiveFileLock(invocationLogLockPath(stateRoot), operation, options);
}

/**
 * In-process append queue, keyed by log path.
 *
 * The file lock alone is correct but polls: N concurrent appends in one
 * process would each spin on `EEXIST` until their turn, and a busy fan-out
 * could burn the lock timeout waiting on its own siblings. Chaining appends
 * per path means the process asks for the lock once at a time and queued
 * callers wait in JS, which also preserves call order within the process.
 */
const appendQueues = new Map<string, Promise<void>>();

function isLockTimeout(error: unknown): error is DomainValidationError {
  return (
    error instanceof DomainValidationError && error.message.includes("timed out waiting for lock")
  );
}

/**
 * Validate and append one invocation row under the log's exclusive lock.
 *
 * Fails closed on a malformed record (`validateInvocation`): a row that cannot
 * be read back is worse than a missing one, because calibration and the delete
 * filter both key off its fields. Callers on the live path treat a rejection
 * as a dropped telemetry row, never as a failed run.
 *
 * Lock timeouts get one immediate retry with the same options. Keeping the
 * same timeout bounds telemetry waiting to at most two acquisition windows;
 * a second timeout still rejects for the live caller to drop.
 */
export async function appendInvocationRecord(
  stateRoot: string,
  invocation: ModelInvocation,
  options: AppendInvocationOptions = {}
): Promise<void> {
  validateInvocation(invocation);
  const path = invocationsLogPath(stateRoot);
  const line = JSON.stringify(invocation);
  const fsync = options.fsync ?? false;
  const previous = appendQueues.get(path) ?? Promise.resolve();
  const queued = previous
    .catch(() => undefined)
    .then(async () => {
      const append = (): Promise<void> =>
        withInvocationLogLock(stateRoot, () => appendJsonlLine(path, line, fsync), options);
      try {
        await append();
      } catch (error: unknown) {
        if (!isLockTimeout(error)) throw error;
        await append();
      }
    });
  appendQueues.set(path, queued);
  try {
    await queued;
  } finally {
    if (appendQueues.get(path) === queued) appendQueues.delete(path);
  }
}

export interface InvocationLogRead {
  readonly path: string;
  /** Parsed rows, unvalidated: a row that is not an invocation is still a row. */
  readonly values: readonly unknown[];
  /** Set when a crash-truncated final line was recovered rather than parsed. */
  readonly recovery: JsonlRecovery;
}

/**
 * Read every row of the log, failing closed on a corrupt middle line.
 *
 * This is the writer-side read: a rewriter that cannot parse a row cannot
 * prove whose row it is, so it must refuse rather than guess. `refusal`
 * completes the error message with what the caller is declining to do. Rows
 * are returned unvalidated so a rewrite preserves records it does not
 * understand; a truncated final line is reported via `recovery` and is not a
 * value.
 */
export async function readInvocationRecords(
  stateRoot: string,
  refusal = "refusing to use it"
): Promise<InvocationLogRead> {
  const path = invocationsLogPath(stateRoot);
  const { values, recovery } = await readJsonlObjects(
    path,
    (line) =>
      new DomainValidationError(`corrupt invocation jsonl at line ${line} of ${path}; ${refusal}`)
  );
  return { path, values, recovery };
}

/**
 * Replace the log with `rows`. Callers must already hold the lock
 * (`withInvocationLogLock`) — this is the write half of a read-filter-write
 * rewrite, and running it unlocked is exactly the race the lock exists for.
 */
export async function writeInvocationRecords(
  stateRoot: string,
  rows: readonly unknown[]
): Promise<void> {
  const path = invocationsLogPath(stateRoot);
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body === "" ? "" : `${body}\n`, "utf8");
}
