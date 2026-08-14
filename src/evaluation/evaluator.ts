import type {
  CriterionScore,
  EvaluationOutcome,
  EvaluationRecord,
  EvaluatorIdentity,
  EvaluatorKind,
  Finding,
} from "./types.js";
import type { Rubric, RubricCriterion } from "../rubric/types.js";
import { createEventId } from "../domain/ids.js";
import { nowIso } from "../domain/timestamp.js";
import type { EpisodeId, RunId, TaskId } from "../domain/ids.js";

export interface EvaluationInput {
  readonly episodeId: EpisodeId;
  readonly taskId?: TaskId;
  readonly runId?: RunId;
  readonly evaluator: EvaluatorIdentity;
  readonly rubric: Rubric;
  readonly evidence: Record<string, string>;
  readonly findings?: Finding[];
}

export interface EvaluationResult {
  readonly record: EvaluationRecord;
  readonly outcome: EvaluationOutcome;
}

export function createEvaluationRecord(input: EvaluationInput): EvaluationRecord {
  const scores: CriterionScore[] = input.rubric.criteria.map((criterion) => {
    const hasEvidence = Boolean(input.evidence[criterion.id]);
    let outcome: EvaluationOutcome;

    if (hasEvidence) {
      outcome = "PASS";
    } else if (input.evaluator.kind === "deterministic") {
      outcome = "FAIL";
    } else {
      outcome = "UNOBSERVED";
    }

    return {
      criterionId: criterion.id,
      outcome,
      evidenceRef: hasEvidence ? input.evidence[criterion.id] : undefined,
      confidence: input.evaluator.kind === "inferential" ? 0.6 : undefined,
      reason: hasEvidence ? undefined : "no evidence provided",
    };
  });

  const hasAnyFail = scores.some((s) => s.outcome === "FAIL");
  const hasAnyPass = scores.some((s) => s.outcome === "PASS");
  const allUnobserved = scores.every((s) => s.outcome === "UNOBSERVED");

  let overall: EvaluationOutcome;
  if (hasAnyFail) {
    overall = "FAIL";
  } else if (allUnobserved) {
    overall = "UNOBSERVED";
  } else if (hasAnyPass) {
    overall = "PASS";
  } else {
    overall = "ABSTAIN";
  }

  return {
    id: createEventId(),
    episodeId: input.episodeId,
    taskId: input.taskId,
    runId: input.runId,
    evaluator: input.evaluator,
    rubricId: input.rubric.id,
    rubricVersion: input.rubric.version,
    scores,
    findings: input.findings ?? [],
    overall,
    createdAt: nowIso(),
  };
}

export function canEvaluatorScoreCriterion(
  evaluatorKind: EvaluatorKind,
  criterion: RubricCriterion
): boolean {
  if (evaluatorKind === "deterministic") {
    return criterion.observableCheck.length > 0;
  }
  return true;
}

export function validateEvaluatorScope(
  evaluator: EvaluatorIdentity,
  rubric: Rubric
): { valid: boolean; reason?: string } {
  if (evaluator.rubricVersion !== String(rubric.version)) {
    return {
      valid: false,
      reason: `rubric version mismatch: evaluator expects ${evaluator.rubricVersion}, rubric is ${rubric.version}`,
    };
  }
  return { valid: true };
}
