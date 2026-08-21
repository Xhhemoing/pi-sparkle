import assert from "node:assert/strict";
import { test } from "node:test";
import { applyRedaction, redactFeedback } from "../../../src/feedback/redaction.js";
import type { FeedbackRecord } from "../../../src/feedback/types.js";
import { materializeWithoutTombstones, tombstoneIds } from "../../../src/privacy/deletion.js";
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

test("seeded secret substring is stripped", () => {
  const secret = "sk-seeded-secret-value";
  const { feedback: redacted, decision } = redactFeedback(feedback({ body: `keep ${secret} please` }), {
    redactPII: false,
    forbiddenSubstrings: [secret]
  });
  assert.equal(redacted.body, "keep  please");
  assert.ok(decision.classes.includes("secret"));
});

test("oversized body is reference-only", () => {
  const { feedback: redacted, decision } = redactFeedback(feedback({ body: "too-long-body" }), {
    redactPII: false,
    maxBodyChars: 3
  });
  assert.equal(redacted.body, undefined);
  assert.equal(decision.referenceOnly, true);
  assert.ok(decision.droppedFields.includes("body"));
});

test("tombstones exclude ids from materialized views", () => {
  const tombstones = tombstoneIds(["gone", "also"]);
  const visible = materializeWithoutTombstones(
    [{ id: "keep" }, { id: "gone" }, { id: "also" }, { id: "stay" }],
    tombstones
  );
  assert.deepEqual(
    visible.map((item) => item.id),
    ["keep", "stay"]
  );
});

test("applyRedaction still sets redacted true when redactPII", () => {
  const redacted = applyRedaction(feedback(), { redactPII: true });
  assert.equal(redacted.redacted, true);
});
