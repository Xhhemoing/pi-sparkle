import type { RunId } from "../domain/ids.js";
import type { ProjectEpisode } from "../domain/episode.js";
import { nowIso } from "../domain/timestamp.js";

export interface ClosureDecision {
  readonly canClose: boolean;
  readonly reason: string;
  readonly requiredEvidence: string[];
}

export function decideClosure(episode: ProjectEpisode, _latestRunIds: readonly RunId[]): ClosureDecision {
  if (episode.status !== "OPEN") {
    return { canClose: false, reason: "already-closed", requiredEvidence: [] };
  }
  const missing = episode.acceptance
    .filter((criterion) => !episode.evidenceRefs.some((ref) => String(ref).includes(criterion.id)))
    .map((criterion) => criterion.id);
  if (missing.length > 0) {
    return { canClose: false, reason: "acceptance-incomplete", requiredEvidence: missing };
  }
  return { canClose: true, reason: "all-criteria-met", requiredEvidence: [] };
}

export function closeEpisode(episode: ProjectEpisode, status: "COMPLETED" | "FAILED" | "ABANDONED"): ProjectEpisode {
  return {
    ...episode,
    status,
    closedAt: nowIso(),
    runIds: [...episode.runIds]
  };
}
