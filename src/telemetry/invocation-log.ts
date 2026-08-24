import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DomainValidationError } from "../domain/errors.js";
import {
  LOCK_TIMEOUT_CODE,
  withExclusiveFileLock,
  type FileLockOptions
} from "../persist/file-lock.js";
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

/**
 * Validate and append one invocation row under the log's exclusive lock.
 *
 * Fails closed on a malformed record (`validateInvocation`): a row that cannot
 * be read back is worse than a missing one, because calibration and the delete
 * filter both key off its fields. Callers on the live path treat a rejection
 * as a dropped telemetry row, never as a failed run.
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
    .then(async () =>
      withInvocationLogLock(stateRoot, () => appendJsonlLine(path, line, fsync), options)
    );
  appendQueues.set(path, queued);
  try {
    await queued;
  } finally {
    if (appendQueues.get(path) === queued) appendQueues.delete(path);
  }
}

/** One live-path telemetry write. Never rejects: a dropped row is not a failed run. */
export type InvocationSink = (invocation: ModelInvocation) => Promise<void>;

export interface InvocationSinkOptions extends AppendInvocationOptions {
  /** Called once per record the sink gives up on, with why it was dropped. */
  readonly onDrop?: (reason: string) => void;
  /** Tries per record, the first attempt included. Default 3. */
  readonly maxAttempts?: number;
  /** Pause before each retry. Default 50ms. */
  readonly retryBackoffMs?: number;
  /** Sleep seam; tests use it to observe retries and to order the lock release. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Per-log-path queue for sink writes, holding a record's retries together.
 *
 * `appendInvocationRecord` already serializes appends, but a retry re-enters
 * that queue at the back: without a second chain around the whole retry loop,
 * a record that waited out a lock timeout would land after rows issued later.
 */
const sinkQueues = new Map<string, Promise<void>>();

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * True only for `withExclusiveFileLock`'s typed timeout.
 *
 * Deliberately exact: a validation failure is also a `DomainValidationError`,
 * and retrying one would only re-reject three times. An unrecognized error
 * fails closed to "do not retry" — the row drops instead of looping.
 */
function isLockTimeout(error: unknown): boolean {
  return (
    error instanceof DomainValidationError &&
    "code" in error &&
    error.code === LOCK_TIMEOUT_CODE
  );
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A telemetry writer for the live path: bounded retry, then an honest drop.
 *
 * `appendInvocationRecord` rejects when a rewriter (`delete --run`) holds the
 * lock past the timeout, and the live executor cannot fail a run over a
 * telemetry row — so callers used to swallow the rejection and lose every
 * invocation in that window. This sink retries a lock timeout a few times so
 * the common case (a rewrite shorter than the retry budget) still lands, and
 * reports the terminal give-up through `onDrop` so the loss is visible instead
 * of silent. Validation failures are never retried: the record is wrong, and
 * writing it later would not make it right.
 *
 * Readers stay lock-free and `appendInvocationRecord` keeps its signature;
 * this is a wrapper, not a new writer surface.
 */
export function createInvocationSink(
  stateRoot: string,
  options: InvocationSinkOptions = {}
): InvocationSink {
  const {
    onDrop,
    maxAttempts = 3,
    retryBackoffMs = 50,
    sleep = defaultSleep,
    ...appendOptions
  } = options;
  const path = invocationsLogPath(stateRoot);
  const lockPath = invocationLogLockPath(stateRoot);
  const tries = Math.max(1, Math.trunc(maxAttempts));
  // A reporter that throws would turn a dropped telemetry row back into a
  // failed live call, which is the whole thing this sink exists to prevent.
  const report = (reason: string): void => {
    try {
      onDrop?.(reason);
    } catch {
      // nothing left to report it to
    }
  };

  const deliver = async (invocation: ModelInvocation): Promise<void> => {
    for (let attempt = 1; attempt <= tries; attempt += 1) {
      try {
        await appendInvocationRecord(stateRoot, invocation, appendOptions);
        return;
      } catch (error: unknown) {
        if (!isLockTimeout(error)) {
          report(`invocation ${invocation.id} rejected: ${reasonOf(error)}`);
          return;
        }
        if (attempt === tries) {
          report(
            `invocation ${invocation.id} dropped: lock timeout after ${tries} attempts on ${lockPath}`
          );
          return;
        }
        await sleep(retryBackoffMs);
      }
    }
  };

  return (invocation: ModelInvocation): Promise<void> => {
    const previous = sinkQueues.get(path) ?? Promise.resolve();
    const queued = previous.catch(() => undefined).then(() => deliver(invocation));
    sinkQueues.set(path, queued);
    return queued.finally(() => {
      if (sinkQueues.get(path) === queued) sinkQueues.delete(path);
    });
  };
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
