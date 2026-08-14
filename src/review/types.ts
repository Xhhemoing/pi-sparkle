import type { EpisodeId, TaskId, RunId } from "../domain/ids.js";
import type { IsoTimestamp } from "../domain/timestamp.js";

export type ReviewRole = "actor" | "critic" | "judge";

export interface ReviewObservation {
  readonly id: string;
  readonly episodeId: EpisodeId;
  readonly taskId?: TaskId;
  readonly runId?: RunId;
  readonly role: ReviewRole;
  readonly rubricId: string;
  readonly score: number;
  readonly comment: string;
  readonly createdAt: IsoTimestamp;
}

export interface PairwiseComparison {
  readonly id: string;
  readonly episodeId: EpisodeId;
  readonly aId: string;
  readonly bId: string;
  readonly winner: "a" | "b" | "tie";
  readonly rationale: string;
  readonly createdAt: IsoTimestamp;
}
