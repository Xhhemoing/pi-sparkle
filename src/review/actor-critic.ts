import type { ReviewObservation, ReviewRole } from "./types.js";
import type { EpisodeId } from "../domain/ids.js";
import { nowIso } from "../domain/timestamp.js";

export function createObservation(
  episodeId: EpisodeId,
  role: ReviewRole,
  rubricId: string,
  score: number,
  comment: string
): ReviewObservation {
  return {
    id: `rev_${Date.now()}`,
    episodeId,
    role,
    rubricId,
    score: Math.max(0, Math.min(100, score)),
    comment,
    createdAt: nowIso(),
  };
}

export function blindPairwise(
  a: ReviewObservation,
  b: ReviewObservation
): "a" | "b" | "tie" {
  if (a.score === b.score) return "tie";
  return a.score > b.score ? "a" : "b";
}
