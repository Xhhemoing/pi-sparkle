import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { redactFeedback } from "../../../src/feedback/redaction.js";
import type { FeedbackRecord } from "../../../src/feedback/types.js";
import {
  configurePreferencePersistence,
  deleteObservation,
  listObservations,
  recordObservation,
  resetPreferenceStore
} from "../../../src/preferences/store.js";
import { exportAuthorizedPreferences, exportForDataset } from "../../../src/preferences/export.js";
import type { PreferenceObservation } from "../../../src/preferences/types.js";
import { createEpisodeId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";
const SECRET = "sk-live-9f8e7d6c5b4a";
const OVERSIZED = "x".repeat(500);

function feedback(): FeedbackRecord {
  return {
    id: "fb-redact-1",
    episodeId: createEpisodeId(UUID),
    kind: "human",
    rubricVersion: "1",
    score: 80,
    evidenceRefs: [],
    redacted: false,
    createdAt: parseIsoTimestamp("2026-08-21T08:00:00.000Z"),
    body: `review notes token=${SECRET} and ${OVERSIZED}`,
    summary: `summary leaking ${SECRET}`
  };
}

function observation(id: string): PreferenceObservation {
  return {
    id,
    scope: "task-family",
    scopeKey: "payments",
    key: "prefer-tests-first",
    value: true,
    evidenceEpisodeId: createEpisodeId(UUID),
    weight: 1,
    createdAt: parseIsoTimestamp("2026-08-21T08:00:00.000Z"),
    explicit: false,
    recurrenceCount: 2
  };
}

test("redaction to dataset export keeps secrets out and tombstones id-only", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-redaction-"));
  try {
    configurePreferencePersistence(join(stateRoot, "prefs.json"));
    resetPreferenceStore();

    // 1. A feedback record carrying a seeded secret and an oversized body.
    const decision = redactFeedback(feedback(), {
      redactPII: true,
      maxBodyChars: 200,
      forbiddenSubstrings: [SECRET]
    });
    assert.ok(!decision.feedback.body?.includes(SECRET));
    assert.ok(!decision.feedback.summary?.includes(SECRET));
    assert.equal(decision.feedback.body, undefined, "oversized body must be dropped");
    assert.equal(decision.feedback.redacted, true);
    assert.ok(decision.decision.referenceOnly);
    assert.ok(decision.decision.classes.includes("secret"));
    assert.ok(decision.decision.classes.includes("oversized"));

    // 2. The observation derived from it lands in the store.
    recordObservation(observation("obs-to-delete"));
    recordObservation(observation("obs-to-keep"));
    assert.equal(listObservations().length, 2);

    // 3. Deletion tombstones the source; dataset export lists the tombstone
    //    id but never carries payloads of the deleted observation.
    assert.equal(deleteObservation("obs-to-delete"), true);
    const dataset = JSON.parse(exportForDataset());
    // Dataset export drops the deleted observation entirely but always
    // propagates its tombstone id so downstream datasets can drop it too.
    assert.equal(dataset.observations.length, 1);
    assert.equal(dataset.observations[0].key, "prefer-tests-first");
    assert.ok(dataset.tombstones.includes("obs-to-delete"));

    // 4. Authorized export omits tombstones unless explicitly requested.
    const strict = JSON.parse(exportAuthorizedPreferences().data);
    assert.ok(strict.tombstones === undefined);
    const withTombstones = JSON.parse(
      exportAuthorizedPreferences({ includeTombstones: true }).data
    );
    assert.ok(withTombstones.tombstones.includes("obs-to-delete"));
  } finally {
    resetPreferenceStore();
    await rm(stateRoot, { recursive: true, force: true });
  }
});
