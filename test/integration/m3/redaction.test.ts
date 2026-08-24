import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { redactFeedback } from "../../../src/feedback/redaction.js";
import { appendFeedback, feedbackLogPath, readFeedback } from "../../../src/feedback/store.js";
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
    // The seeded secret is gone from the summary by value, not by label: the
    // `sk-` shape rule fires before the forbidden-substring strip, so the key
    // body cannot survive on its own once the prefix is deleted.
    assert.equal(decision.feedback.summary, "summary leaking [secret]");

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

test("the persisted feedback log never contains the raw values on disk", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-redaction-store-"));
  try {
    const record: FeedbackRecord = {
      ...feedback(),
      id: "fb-store-1",
      body: "reporter john.doe@example.com from 192.168.1.100 used sk-proj-abcdefghijklmnop1234567890",
      summary: "escalation at /home/john/.ssh/id_rsa"
    };
    const stored = await appendFeedback(stateRoot, record);
    assert.equal(stored.redacted, true);

    const onDisk = await readFile(feedbackLogPath(stateRoot), "utf8");
    for (const value of [
      "john.doe@example.com",
      "192.168.1.100",
      "abcdefghijklmnop1234567890",
      "/home/john/.ssh/id_rsa"
    ]) {
      assert.equal(onDisk.includes(value), false, `raw value persisted: ${value}`);
    }
    assert.match(onDisk, /\[email\]/);
    assert.match(onDisk, /\[ipv4\]/);
    assert.match(onDisk, /\[secret\]/);
    assert.match(onDisk, /\[path\]/);

    // The row also records *what* was removed, so an audit of the log does not
    // have to re-derive it: `redacted: true` alone would only say the pass ran.
    assert.deepEqual(JSON.parse(onDisk.trim()).redactionClasses, ["secret", "pii", "path"]);

    const reloaded = await readFeedback(stateRoot);
    assert.equal(reloaded.length, 1);
    assert.equal(reloaded[0]?.body?.includes("john.doe@example.com"), false);
    assert.deepEqual(reloaded[0]?.redactionClasses, ["secret", "pii", "path"]);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});
