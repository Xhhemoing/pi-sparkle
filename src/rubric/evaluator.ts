import type { Rubric } from "./types.js";

export interface RubricScore {
  readonly criterionId: string;
  readonly score: number; // 0-100
  readonly evidence: string;
}

export interface RubricEvaluation {
  readonly rubricId: string;
  readonly scores: readonly RubricScore[];
  readonly total: number;
  readonly timestamp: string;
}

export function evaluateWithRubric(
  rubric: Rubric,
  evidence: Record<string, string>
): RubricEvaluation {
  const scores: RubricScore[] = rubric.criteria.map((c) => ({
    criterionId: c.id,
    score: evidence[c.id] ? 80 : 40,
    evidence: evidence[c.id] || "missing",
  }));
  const avg = scores.length > 0
    ? scores.reduce((sum, s) => sum + s.score, 0) / scores.length
    : 0;
  return {
    rubricId: rubric.id,
    scores,
    total: Math.max(0, Math.min(100, Math.round(avg))),
    timestamp: new Date().toISOString(),
  };
}
