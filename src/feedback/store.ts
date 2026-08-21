import { join } from "node:path";
import type { FeedbackRecord } from "./types.js";
import { redactFeedback } from "./redaction.js";
import { appendJsonlLine, readJsonlObjects } from "../persist/jsonl.js";
import { DomainValidationError } from "../domain/errors.js";

export function feedbackLogPath(stateRoot: string): string {
  return join(stateRoot, "feedback", "records.jsonl");
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

export async function readFeedback(stateRoot: string): Promise<readonly FeedbackRecord[]> {
  const { values } = await readJsonlObjects(feedbackLogPath(stateRoot), (line) => {
    return new DomainValidationError(`corrupt feedback jsonl at line ${line}`);
  });
  return values.filter(isFeedbackRecord);
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
