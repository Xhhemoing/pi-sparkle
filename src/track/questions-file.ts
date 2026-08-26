import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunId } from "../domain/ids.js";
import { runtimeRoot } from "../privacy/state-layout.js";

export interface TrackClarificationQuestion {
  readonly id: string;
  readonly question: string;
}

/**
 * What a run's `track-questions.json` says, or why it says nothing.
 *
 * `absent` is the only case that means "this is not a clarification run". A
 * file that is there but will not read is `unreadable`: the run is still
 * waiting on a clarification, and the answers just cannot be shown. The two
 * are kept apart because refusing `answer` depends only on the plane (the file
 * exists), while printing the questions depends on having actually read them.
 */
export type TrackClarificationRead =
  | { readonly kind: "absent" }
  | {
      readonly kind: "read";
      readonly questions: readonly TrackClarificationQuestion[];
      readonly objective?: string;
    }
  | { readonly kind: "unreadable"; readonly reason: string };

export function trackQuestionsPath(stateRoot: string, runId: RunId): string {
  return join(runtimeRoot(stateRoot), "runs", runId, "track-questions.json");
}

function parseQuestions(value: unknown): readonly TrackClarificationQuestion[] {
  if (!Array.isArray(value)) return [];
  const questions: TrackClarificationQuestion[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") continue;
    const { id, question } = entry as { id?: unknown; question?: unknown };
    if (typeof id !== "string" || typeof question !== "string") continue;
    questions.push({ id, question });
  }
  return questions;
}

/**
 * Reads the clarification a `run --track` wait persisted for `runId`.
 *
 * Nothing is reconstructed: the questions are the ones on disk, and a file
 * that is present but damaged reports that rather than an empty question list,
 * so no caller can present "no questions" for a run that has them.
 */
export async function readTrackClarification(
  stateRoot: string,
  runId: RunId
): Promise<TrackClarificationRead> {
  const path = trackQuestionsPath(stateRoot, runId);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return { kind: "absent" };
    const message = error instanceof Error ? error.message : String(error);
    return { kind: "unreadable", reason: message };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: "unreadable", reason: `invalid JSON at ${path}: ${message}` };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { kind: "unreadable", reason: `${path} is not a clarification object` };
  }
  const record = parsed as { questions?: unknown; objective?: unknown };
  const questions = parseQuestions(record.questions);
  const objective = typeof record.objective === "string" ? record.objective : undefined;
  return {
    kind: "read",
    questions,
    ...(objective !== undefined ? { objective } : {})
  };
}

/** True once the run has a clarification file at all, readable or not. */
export function isTrackClarificationWait(read: TrackClarificationRead): boolean {
  return read.kind !== "absent";
}
