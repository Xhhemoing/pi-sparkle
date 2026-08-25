import type { RunId } from "../domain/ids.js";
import type { ProjectEpisode } from "../domain/episode.js";

export interface ClosureDecision {
  readonly canClose: boolean;
  readonly reason: string;
  readonly requiredEvidence: string[];
}

export function decideClosure(episode: ProjectEpisode, _latestRunIds: readonly RunId[]): ClosureDecision {
  if (episode.status !== "OPEN" && episode.status !== "WAITING_FOR_USER") {
    return { canClose: false, reason: "already-closed", requiredEvidence: [] };
  }
  const acceptanceEvidence = (
    episode as ProjectEpisode & {
      readonly acceptanceEvidence?: readonly {
        readonly criterionId: string;
        readonly evidenceId: string;
        readonly result: "PASSED" | "FAILED" | "UNOBSERVED";
      }[];
    }
  ).acceptanceEvidence;
  const missing = episode.acceptance
    .filter((criterion) => {
      const structuredMatch = acceptanceEvidence?.some(
        (evidence) =>
          evidence.criterionId === criterion.id &&
          evidence.result === "PASSED" &&
          episode.evidenceRefs.includes(evidence.evidenceId as ProjectEpisode["evidenceRefs"][number])
      );
      const legacyMatch = episode.evidenceRefs.some((ref) => String(ref) === `evd_${criterion.id}`);
      return structuredMatch !== true && !legacyMatch;
    })
    .map((criterion) => criterion.id);
  if (missing.length > 0) {
    return { canClose: false, reason: "acceptance-incomplete", requiredEvidence: missing };
  }
  return { canClose: true, reason: "all-criteria-met", requiredEvidence: [] };
}
