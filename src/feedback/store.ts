import { dirname, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { adaptationRoot } from "../privacy/state-layout.js";
import { isRedactionClass, REDACTION_CLASSES } from "./types.js";
import type { FeedbackRecord, RedactionClass } from "./types.js";
import { redactFeedback, type RedactionPolicy } from "./redaction.js";
import { appendJsonlLine, readJsonlObjects } from "../persist/jsonl.js";
import { DomainValidationError } from "../domain/errors.js";

export function feedbackLogPath(stateRoot: string): string {
  return join(adaptationRoot(stateRoot), "feedback", "records.jsonl");
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
 * Redact, then persist the redacted record *with* the classes the decision
 * reported. Storing the classes is what makes the log auditable after the
 * fact: `redacted: true` only says the pass ran, while the class list says
 * whether anything was actually found and removed.
 */
export async function appendFeedback(stateRoot: string, record: FeedbackRecord): Promise<FeedbackRecord> {
  const { feedback } = redactFeedback(record, FEEDBACK_REDACTION_POLICY);
  await appendJsonlLine(feedbackLogPath(stateRoot), JSON.stringify(feedback), false);
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

/** Rewrite the whole feedback log (used by the episode-deletion cascade). */
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
