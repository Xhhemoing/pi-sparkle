import type { FeedbackRecord } from "./types.js";

export function applyRedaction(feedback: FeedbackRecord, policy: { redactPII: boolean }): FeedbackRecord {
  if (!policy.redactPII) return feedback;
  return { ...feedback, redacted: true };
}
