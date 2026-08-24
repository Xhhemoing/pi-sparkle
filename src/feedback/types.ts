import type { EpisodeId, RunId, TaskId, EvidenceId } from "../domain/ids.js";
import type { IsoTimestamp } from "../domain/timestamp.js";

export type FeedbackKind = "human" | "peer" | "judge" | "deterministic";

/**
 * Closed vocabulary for what a redaction pass did to a record, in the order a
 * class list is canonicalized to.
 *
 * It lives here rather than in redaction.ts because it is part of the persisted
 * record shape: the store validates rows against this list, and a class it does
 * not recognise fails the read closed instead of being waved through.
 */
export const REDACTION_CLASSES = [
  "secret",
  "pii",
  "path",
  "prompt-injection",
  "oversized"
] as const;

export type RedactionClass = (typeof REDACTION_CLASSES)[number];

export function isRedactionClass(value: unknown): value is RedactionClass {
  return typeof value === "string" && (REDACTION_CLASSES as readonly string[]).includes(value);
}

export interface FeedbackRecord {
  readonly id: string;
  readonly episodeId: EpisodeId;
  readonly runId?: RunId | undefined;
  readonly taskId?: TaskId | undefined;
  readonly kind: FeedbackKind;
  readonly rubricVersion: string;
  readonly score: number; // 0-100
  readonly evidenceRefs: readonly EvidenceId[];
  readonly redacted: boolean;
  /**
   * What the redaction pass that produced this record actually matched.
   *
   * `redacted` alone is not an answer: under the store's policy it is true as
   * soon as the PII pass runs, matches or not. The class list is what separates
   * the cases, and the three states are distinct on purpose:
   *
   * - `undefined` — unknown. The row predates this field; do not read it as
   *   "nothing matched".
   * - `[]` (or a list without `secret`) — the pass ran and found no secret.
   *   `["pii"]` is the store's shape for "PII pass ran, nothing matched".
   * - contains `secret`/`path`/`oversized` — that class was found and removed.
   *
   * `oversized` additionally means the body was dropped, so a record carrying
   * it must not carry a body; readers enforce that rather than trust the row.
   */
  readonly redactionClasses?: readonly RedactionClass[] | undefined;
  readonly createdAt: IsoTimestamp;
  readonly body?: string | undefined;
  readonly summary?: string | undefined;
}

export interface EvaluationResult {
  readonly feedback: FeedbackRecord;
  readonly summary: string;
}
