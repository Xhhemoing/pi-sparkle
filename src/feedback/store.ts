import { dirname, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { adaptationRoot } from "../privacy/state-layout.js";
import type { FeedbackRecord } from "./types.js";
import { redactFeedback } from "./redaction.js";
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

const REDACTION = {
  redactPII: true,
  maxBodyChars: 400,
  forbiddenSubstrings: ["sk-", "api_key", "API_KEY", "BEGIN PRIVATE"]
} as const;

export async function appendFeedback(stateRoot: string, record: FeedbackRecord): Promise<FeedbackRecord> {
  const redacted = redactFeedback(record, REDACTION).feedback;
  await appendJsonlLine(feedbackLogPath(stateRoot), JSON.stringify(redacted), false);
  return redacted;
}

/**
 * Unfiltered record access for the deletion engine (privacy/deletion.ts).
 * Same corruption contract as readFeedback: a bad line fails closed.
 */
export async function readFeedbackRecordsRaw(stateRoot: string): Promise<FeedbackRecord[]> {
  const { values } = await readJsonlObjects(feedbackLogPath(stateRoot), (line) => {
    return new DomainValidationError(`corrupt feedback jsonl at line ${line}`);
  });
  return values.filter(isFeedbackRecord);
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
  return values.filter(isFeedbackRecord).filter((record) => !tombstones.has(record.id));
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
