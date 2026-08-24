import { dirname, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { adaptationRoot } from "../privacy/state-layout.js";
import { isRedactionClass, REDACTION_CLASSES } from "./types.js";
import type { FeedbackRecord, RedactionClass } from "./types.js";
import { redactFeedback, type RedactionPolicy } from "./redaction.js";
import { withExclusiveFileLock, type FileLockOptions } from "../persist/file-lock.js";
import { appendJsonlLine, readJsonlObjects } from "../persist/jsonl.js";
import { DomainValidationError } from "../domain/errors.js";

/**
 * The one writer surface for `adaptation/feedback/records.jsonl`.
 *
 * The log has two writers that do incompatible things to the same file: the
 * auto-adapt loop appends a row per feedback item, and the episode-delete
 * cascade (`cascadeFeedbackTombstones`) filter-rewrites the whole file to strip
 * free text. A read-filter-write rewrite is not atomic against an append — an
 * append that lands after the rewrite's read but before its `writeFile` is
 * silently clobbered, which for this file means a deleted episode's body can
 * survive the delete — so both writers go through the same cooperative lock
 * (`records.jsonl.lock`) via `withFeedbackLogLock`. The lock also covers the
 * `tombstones.json` sidecar the cascade writes: a tombstone published outside
 * the lock would reopen the same window for the id list.
 *
 * The lock is not re-entrant. `appendFeedback` takes it; `writeFeedbackRecords`
 * deliberately does not, because it is the write half of a read-filter-write
 * whose caller is already holding the lock.
 *
 * A lock timeout throws `DomainValidationError` (from `withExclusiveFileLock`)
 * rather than falling back to an unlocked write. That is fail-closed in both
 * directions: a delete that cannot serialize refuses instead of racing a live
 * append, and an append that cannot serialize is a dropped feedback row, which
 * the auto-adapt caller can absorb.
 *
 * Readers stay lock-free, the same honesty as the invocation log: a torn tail
 * costs one adaptation sample rather than blocking a live run behind a writer.
 */

export function feedbackLogPath(stateRoot: string): string {
  return join(adaptationRoot(stateRoot), "feedback", "records.jsonl");
}

/** Cooperative lock guarding every write to the feedback log and its tombstones. */
export function feedbackLogLockPath(stateRoot: string): string {
  return `${feedbackLogPath(stateRoot)}.lock`;
}

/**
 * Run `operation` while holding the feedback log's exclusive lock. The delete
 * cascade uses this to wrap read + rewrite + tombstone write in one critical
 * section; a live append then lands either wholly before or wholly after it.
 */
export async function withFeedbackLogLock<T>(
  stateRoot: string,
  operation: () => Promise<T>,
  options: FileLockOptions = {}
): Promise<T> {
  return withExclusiveFileLock(feedbackLogLockPath(stateRoot), operation, options);
}

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
 * In-process append queue, keyed by log path.
 *
 * The file lock alone is correct but polls: N concurrent appends in one process
 * would each spin on `EEXIST` until their turn, and a busy fan-out could burn
 * the lock timeout waiting on its own siblings. Chaining appends per path means
 * the process asks for the lock once at a time and queued callers wait in JS,
 * which also preserves call order within the process.
 */
const appendQueues = new Map<string, Promise<void>>();

/**
 * Redact, then persist the redacted record *with* the classes the decision
 * reported. Storing the classes is what makes the log auditable after the
 * fact: `redacted: true` only says the pass ran, while the class list says
 * whether anything was actually found and removed.
 *
 * The append happens under the log's exclusive lock, so it cannot land in the
 * window between a delete cascade's read and its rewrite. A lock timeout
 * rejects the append; callers on the live path treat that as a dropped
 * feedback row, never as a failed run.
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

/**
 * Unfiltered record access for the deletion engine (privacy/deletion.ts).
 * Same corruption contract as readFeedback: a bad line fails closed.
 */
export async function readFeedbackRecordsRaw(stateRoot: string): Promise<FeedbackRecord[]> {
  const { values } = await readJsonlObjects(feedbackLogPath(stateRoot), (line) => {
    return new DomainValidationError(`corrupt feedback jsonl at line ${line}`);
  });
  return loadFeedbackRows(values);
}

/**
 * Rewrite the whole feedback log (used by the episode-deletion cascade).
 * Callers must already hold the lock (`withFeedbackLogLock`) — this is the
 * write half of a read-filter-write rewrite, and running it unlocked is
 * exactly the race the lock exists for. It does not take the lock itself
 * because the lock is not re-entrant.
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
