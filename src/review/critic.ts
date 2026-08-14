import type { EpisodeId, RunId, TaskId } from "../domain/ids.js";
import type { IsoTimestamp } from "../domain/timestamp.js";
import type { Rubric } from "../rubric/types.js";
import type { EvaluationOutcome } from "../evaluation/types.js";
import { nowIso } from "../domain/timestamp.js";

export interface CriticInput {
  readonly episodeId: EpisodeId;
  readonly taskId?: TaskId;
  readonly runId?: RunId;
  readonly rubric: Rubric;
  readonly evidence: Record<string, string>;
  readonly actorDefense?: string;
}

export interface CriticOutput {
  readonly observationId: string;
  readonly episodeId: EpisodeId;
  readonly scores: Array<{
    criterionId: string;
    outcome: EvaluationOutcome;
    evidenceRef?: string;
  }>;
  readonly overall: EvaluationOutcome;
  readonly comment: string;
  readonly createdAt: IsoTimestamp;
}

export function createCriticObservation(input: CriticInput): CriticOutput {
  if (input.actorDefense) {
    return {
      observationId: `critic_${Date.now()}`,
      episodeId: input.episodeId,
      scores: [],
      overall: "ABSTAIN",
      comment: "critic must not receive actor defense",
      createdAt: nowIso(),
    };
  }

  const scores: Array<{
    criterionId: string;
    outcome: EvaluationOutcome;
    evidenceRef?: string;
  }> = input.rubric.criteria.map((c) => {
    const ev = input.evidence[c.id];
    const score: { criterionId: string; outcome: EvaluationOutcome; evidenceRef?: string } = {
      criterionId: c.id,
      outcome: (ev ? "PASS" : "UNOBSERVED") as EvaluationOutcome,
    };
    if (ev) score.evidenceRef = ev;
    return score;
  });

  const hasPass = scores.some((s) => s.outcome === "PASS");
  const overall: EvaluationOutcome = hasPass ? "PASS" : "UNOBSERVED";

  return {
    observationId: `critic_${Date.now()}`,
    episodeId: input.episodeId,
    scores,
    overall,
    comment: "independent critic review",
    createdAt: nowIso(),
  };
}
