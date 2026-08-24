import { dirname, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { adaptationRoot } from "../privacy/state-layout.js";
import { isRedactionClass, REDACTION_CLASSES } from "./types.js";
import type { FeedbackRecord, RedactionClass } from "./types.js";
import { redactFeedback, type RedactionPolicy } from "./redaction.js";
import { withExclusiveFileLock, type FileLockOptions } from "../persist/file-lock.js";
import { appendJsonlLine, readJsonlObjects } from "../persist/jsonl.js";
import { DomainValidationError } from "../domain/errors.js";

export function feedbackLogPath(stateRoot: string): string {
  return join(adaptationRoot(stateRoot), "feedback", "records.jsonl");
}

/**
 * Cooperative lock guarding every write to the feedback log.
 *
 * The log has two writers with incompatible shapes: the auto-adapt loop
 * appends one row at a time, and the episode-deletion cascade
 * (`privacy/deletion.ts`) read-filter-rewrites the whole file to strip free
 * text. An append that lands between the cascade's read and its write is
 * silently clobbered; an append that lands after the write puts user text back
 * on disk under an id the cascade just tombstoned — hidden from `readFeedback`
 * by the tombstone filter, but present in the bytes, which is exactly what the
 * cascade promises not to leave behind. Both writers therefore go through
 * `records.jsonl.lock`, the treatment `invocations.jsonl.lock` already gives
 * the shared invocation log. Anything that appends to or rewrites this log
 * outside `appendFeedback` / `withFeedbackLogLock` reopens that race.
 *
 * Readers are deliberately lock-free: they fail closed on a corrupt line
 * rather than needing to exclude a live writer.
 */
export function feedbackLogLockPath(stateRoot: string): string {
  return `${feedbackLogPath(stateRoot)}.lock`;
}

/**
 * Run `operation` while holding the feedback log's exclusive lock. The
 * deletion cascade uses this so a live append cannot interleave with its
 * read-filter-write cycle.
 */
export async function withFeedbackLogLock<T>(
  stateRoot: string,
  operation: () => Promise<T>,
  options: FileLockOptions = {}
): Promise<T> {
  return withExclusiveFileLock(feedbackLogLockPath(stateRoot), operation, options);
}

/**
 * In-process append queue, keyed by log path.
 *
 * The file lock alone is correct but polls: N concurrent appends in one
 * process would each spin on `EEXIST` until their turn, and a busy auto-adapt
 * batch could burn the lock timeout waiting on its own siblings. Chaining
 * appends per path means the process asks for the lock once at a time and
 * queued callers wait in JS, which also preserves call order within the
 * process.
 */
const appendQueues = new Map<string, Promise<void>>();

/** Sidecar listing deleted feedback ids; payloads of these ids never reload. */
export function feedbackTombstonesPath(stateRoot: string): string {
  return join(adaptationRoot(stateRoot), "feedback", "tombstones.json");
}

export async function readFeedbackTombstoneIds(stateRoot: string): Promise<Set<string>> {
  const raw = await readFile(feedbackTombstonesPath(stateRoot), "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "[]";
      throw error;
    }
  );
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === "string")) {
    throw new DomainValidationError("malformed feedback tombstones.json: expected a string array");
  }
  return new Set(parsed as string[]);
}

/**
 * The policy every record on disk went through. Exported so a caller (and the
 * store's own tests) can reproduce the decision for a record instead of
 * guessing at what the persisted class list should have been.
 */
export const FEEDBACK_REDACTION_POLICY = {
  redactPII: true,
  maxBodyChars: 400,
  forbiddenSubstrings: ["sk-", "api_key", "API_KEY", "BEGIN PRIVATE"]
} as const satisfies RedactionPolicy;

/**
 * Redact, then persist the redacted record *with* the classes the decision
 * reported. Storing the classes is what makes the log auditable after the
 * fact: `redacted: true` only says the pass ran, while the class list says
 * whether anything was actually found and removed.
 *
 * The append happens under the log's exclusive lock, so it lands either wholly
 * before or wholly after a deletion cascade's rewrite, never inside it.
 *
 * `options` tunes only that lock acquisition (timeout, retry cadence); the
 * defaults are `withExclusiveFileLock`'s. A caller that cannot afford to
 * reject when a rewriter holds the lock wants `appendFeedbackWithRetry`.
 */
export async function appendFeedback(
  stateRoot: string,
  record: FeedbackRecord,
  options: FileLockOptions = {}
): Promise<FeedbackRecord> {
  const { feedback } = redactFeedback(record, FEEDBACK_REDACTION_POLICY);
  const path = feedbackLogPath(stateRoot);
  const line = JSON.stringify(feedback);
  const previous = appendQueues.get(path) ?? Promise.resolve();
  const queued = previous
    .catch(() => undefined)
    .then(async () => withFeedbackLogLock(stateRoot, () => appendJsonlLine(path, line, false), options));
  appendQueues.set(path, queued);
  try {
    await queued;
  } finally {
    if (appendQueues.get(path) === queued) appendQueues.delete(path);
  }
  return feedback;
}

export interface FeedbackAppendRetryOptions extends FileLockOptions {
  /** Called once per record the retry gives up on, with why it was dropped. */
  readonly onDrop?: (reason: string) => void;
  /** Tries per record, the first attempt included. Default 3. */
  readonly maxAttempts?: number;
  /** Pause before each retry. Default 50ms. */
  readonly retryBackoffMs?: number;
  /** Sleep seam; tests use it to observe retries and to order the lock release. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Either the row reached the log, or it did not and says so. There is no third
 * state: a caller cannot mistake a drop for a write by ignoring a return value.
 */
export type FeedbackAppendOutcome =
  | { readonly status: "persisted"; readonly record: FeedbackRecord }
  | { readonly status: "dropped"; readonly reason: string };

/**
 * Per-log-path queue holding one record's retries together.
 *
 * `appendFeedback` already serializes appends, but a retry re-enters that
 * queue at the back: without a second chain around the whole retry loop, a
 * record that waited out a lock timeout would land after rows issued later.
 */
const retryQueues = new Map<string, Promise<void>>();

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * True only for `withExclusiveFileLock`'s timeout on *this* log's lock.
 *
 * Deliberately exact, and the same string coupling `telemetry/invocation-log.ts`
 * discloses: a redaction or row-validation failure is also a
 * `DomainValidationError`, and retrying one would only re-reject. An
 * unrecognized message fails closed to "not a lock timeout", so the error
 * propagates instead of looping. Matching the message rather than the error
 * class keeps this scoped to *this* lock; a typed discriminator carrying the
 * lock path would replace this classifier and the invocation log's together.
 */
function isLockTimeout(error: unknown, lockPath: string): boolean {
  return (
    error instanceof DomainValidationError &&
    error.message === `timed out waiting for lock at ${lockPath}`
  );
}

/**
 * Append one record, retrying a lock timeout a bounded number of times, then
 * reporting an honest drop instead of rejecting.
 *
 * The drop window this closes: the episode-deletion cascade holds the feedback
 * log's lock for a whole read-filter-write cycle, and a cascade longer than
 * the 5 s lock timeout turns a plain `appendFeedback` into a rejection. For
 * the post-run auto-adapt persist that rejection is the wrong shape — the run
 * already happened, the signal is already diagnosed, and failing the whole
 * adaptation over "someone else was writing" loses more than the row does.
 *
 * Retry classification mirrors `createInvocationSink`: lock timeouts are
 * retried, everything else is not. The terminal disposition deliberately does
 * *not* mirror it. The invocation sink swallows every failure because it sits
 * on the live executor path; this is a persist path off the live path, so only
 * the contention outcome degrades to a drop. A redaction/validation failure or
 * a real I/O error (`EACCES`, `ENOSPC`, a log path that is a directory) still
 * rejects: those mean the record or the state root is broken, and an operator
 * needs to hear that once, loudly, rather than watch persisted counts diverge
 * quietly on every run.
 */
export async function appendFeedbackWithRetry(
  stateRoot: string,
  record: FeedbackRecord,
  options: FeedbackAppendRetryOptions = {}
): Promise<FeedbackAppendOutcome> {
  const {
    onDrop,
    maxAttempts = 3,
    retryBackoffMs = 50,
    sleep = defaultSleep,
    ...lockOptions
  } = options;
  const path = feedbackLogPath(stateRoot);
  const lockPath = feedbackLogLockPath(stateRoot);
  const tries = Math.max(1, Math.trunc(maxAttempts));

  const deliver = async (): Promise<FeedbackAppendOutcome> => {
    let attempt = 1;
    for (;;) {
      try {
        return { status: "persisted", record: await appendFeedback(stateRoot, record, lockOptions) };
      } catch (error: unknown) {
        if (!isLockTimeout(error, lockPath)) throw error;
        if (attempt >= tries) {
          const reason = `feedback ${record.id} dropped: lock timeout after ${tries} attempts on ${lockPath}`;
          // A reporter that throws would turn a disclosed drop back into the
          // rejection this function exists to avoid.
          try {
            onDrop?.(reason);
          } catch {
            // nothing left to report it to
          }
          return { status: "dropped", reason };
        }
        attempt += 1;
        await sleep(retryBackoffMs);
      }
    }
  };

  const previous = retryQueues.get(path) ?? Promise.resolve();
  const outcome = previous.then(deliver);
  const chained = outcome.then(
    () => undefined,
    () => undefined
  );
  retryQueues.set(path, chained);
  try {
    return await outcome;
  } finally {
    if (retryQueues.get(path) === chained) retryQueues.delete(path);
  }
}

/**
 * Unfiltered record access for the deletion engine (privacy/deletion.ts).
 * Same corruption contract as readFeedback: a bad line fails closed.
 *
 * `refusal` completes the error message with what the caller is declining to
 * do, so a corrupt log reads as a named refusal rather than an anonymous parse
 * failure the caller might be tempted to swallow.
 */
export async function readFeedbackRecordsRaw(
  stateRoot: string,
  refusal = "refusing to use it"
): Promise<FeedbackRecord[]> {
  const path = feedbackLogPath(stateRoot);
  const { values } = await readJsonlObjects(path, (line) => {
    return new DomainValidationError(`corrupt feedback jsonl at line ${line} of ${path}; ${refusal}`);
  });
  return loadFeedbackRows(values);
}

/**
 * Rewrite the whole feedback log (used by the episode-deletion cascade).
 * Callers must already hold the lock (`withFeedbackLogLock`) — this is the
 * write half of a read-filter-write rewrite, and running it unlocked is
 * exactly the race the lock exists for.
 */
export async function writeFeedbackRecords(
  stateRoot: string,
  records: readonly FeedbackRecord[]
): Promise<void> {
  const path = feedbackLogPath(stateRoot);
  await mkdir(dirname(path), { recursive: true });
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  await writeFile(path, body === "" ? "" : `${body}\n`, "utf8");
}

export async function readFeedback(stateRoot: string): Promise<readonly FeedbackRecord[]> {
  const { values } = await readJsonlObjects(feedbackLogPath(stateRoot), (line) => {
    return new DomainValidationError(`corrupt feedback jsonl at line ${line}`);
  });
  // First-layer tombstone filter: even if a payload lingers on disk after an
  // episode-deletion cascade, it is never surfaced through this API.
  const tombstones = await readFeedbackTombstoneIds(stateRoot);
  return loadFeedbackRows(values).filter((record) => !tombstones.has(record.id));
}

function loadFeedbackRows(values: readonly unknown[]): FeedbackRecord[] {
  const records: FeedbackRecord[] = [];
  for (const value of values) {
    const record = loadFeedbackRow(value);
    if (record !== undefined) records.push(record);
  }
  return records;
}

/**
 * Rows are validated on the way out, not trusted.
 *
 * A row that is not feedback-shaped is skipped, as it always was. A row whose
 * `redactionClasses` is not a list of known classes fails the whole read
 * closed: an unrecognised class means we cannot tell what was removed from
 * that record, and guessing would be the wrong direction for a privacy field.
 * A row whose class list says the body was dropped never gets to hand a body
 * back, whoever wrote it — the class list is the authority on what is gone,
 * so a reader (or an export built on one) cannot resurrect stripped text by
 * appending a contradictory row.
 *
 * Unknown *other* properties are preserved: a forward-version row must survive
 * the episode-deletion rewrite, which reads and writes these records whole.
 */
function loadFeedbackRow(value: unknown): FeedbackRecord | undefined {
  if (!isFeedbackRecord(value)) return undefined;
  const classes = parseRedactionClasses(value);
  if (classes === undefined) return value;
  const record = { ...value, redactionClasses: classes };
  if (classes.includes("oversized") && record.body !== undefined) {
    return { ...record, body: undefined };
  }
  return record;
}

/** `undefined` means the row predates the field, which stays a valid row. */
function parseRedactionClasses(record: FeedbackRecord): readonly RedactionClass[] | undefined {
  const raw: unknown = record.redactionClasses;
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    throw new DomainValidationError(
      `feedback record ${record.id}: redactionClasses must be an array of redaction classes`
    );
  }
  const found = new Set<RedactionClass>();
  for (const entry of raw as readonly unknown[]) {
    if (!isRedactionClass(entry)) {
      throw new DomainValidationError(
        `feedback record ${record.id}: unknown redaction class ${describeClass(entry)}`
      );
    }
    found.add(entry);
  }
  return REDACTION_CLASSES.filter((entry) => found.has(entry));
}

/** Bounded: the offending value goes into an error message that gets logged. */
function describeClass(entry: unknown): string {
  return typeof entry === "string" ? JSON.stringify(entry.slice(0, 32)) : typeof entry;
}

function isFeedbackRecord(value: unknown): value is FeedbackRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as FeedbackRecord;
  return (
    typeof record.id === "string" &&
    typeof record.episodeId === "string" &&
    typeof record.kind === "string" &&
    typeof record.score === "number"
  );
}
