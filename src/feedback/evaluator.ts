import type { FeedbackRecord, EvaluationResult } from "./types.js";

export function evaluate(feedback: FeedbackRecord): EvaluationResult {
  return {
    feedback,
    summary: `score=${feedback.score} kind=${feedback.kind}`
  };
}
