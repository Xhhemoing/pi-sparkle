import assert from "node:assert/strict";
import { test } from "node:test";
import { applyRedaction, redactFeedback } from "../../../src/feedback/redaction.js";
import type { FeedbackRecord } from "../../../src/feedback/types.js";
import { createEpisodeId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

function feedback(overrides: Partial<FeedbackRecord> = {}): FeedbackRecord {
  return {
    id: "fb-1",
    episodeId: createEpisodeId(UUID),
    kind: "human",
    rubricVersion: "1",
    score: 80,
    evidenceRefs: [],
    redacted: false,
    createdAt: parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
    ...overrides
  };
}

test("seeded secret substring is stripped from body and summary", () => {
  const secret = "sk-seeded-secret-value";
  const result = redactFeedback(
    feedback({
      body: `token=${secret} trailing`,
      summary: `leak ${secret}`
    }),
    { redactPII: false, forbiddenSubstrings: [secret] }
  );
  assert.equal(result.feedback.body?.includes(secret), false);
  assert.equal(result.feedback.summary?.includes(secret), false);
  assert.equal(result.feedback.body, "token= trailing");
  assert.equal(result.feedback.summary, "leak ");
  assert.equal(result.feedback.redacted, true);
  assert.ok(result.decision.classes.includes("secret"));
});

test("oversized body becomes reference-only and is omitted", () => {
  const result = redactFeedback(feedback({ body: "abcdefghij" }), {
    redactPII: false,
    maxBodyChars: 4
  });
  assert.equal(result.feedback.body, undefined);
  assert.equal(result.decision.referenceOnly, true);
  assert.equal(result.feedback.redacted, true);
  assert.ok(result.decision.classes.includes("oversized"));
  assert.deepEqual(result.decision.droppedFields, ["body"]);
});

test("applyRedaction still sets redacted true when redactPII is enabled", () => {
  const original = feedback();
  const redacted = applyRedaction(original, { redactPII: true });
  assert.equal(redacted.redacted, true);
  assert.equal(applyRedaction(original, { redactPII: false }).redacted, false);
});
