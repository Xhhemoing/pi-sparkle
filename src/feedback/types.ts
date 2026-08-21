import type { EpisodeId, RunId, TaskId, EvidenceId } from "../domain/ids.js";
import type { IsoTimestamp } from "../domain/timestamp.js";

export type FeedbackKind = "human" | "peer" | "judge" | "deterministic";

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
  readonly createdAt: IsoTimestamp;
  readonly body?: string | undefined;
  readonly summary?: string | undefined;
}

export interface EvaluationResult {
  readonly feedback: FeedbackRecord;
  readonly summary: string;
}
