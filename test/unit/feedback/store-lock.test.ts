import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { createEpisodeId, type EpisodeId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import {
  appendFeedback,
  feedbackLogLockPath,
  feedbackLogPath,
  feedbackTombstonesPath,
  readFeedbackRecordsRaw,
  withFeedbackLogLock,
  writeFeedbackRecords
} from "../../../src/feedback/store.js";
import type { FeedbackRecord } from "../../../src/feedback/types.js";
import { cascadeFeedbackTombstones } from "../../../src/privacy/deletion.js";

let uuidCounter = 0;
const UUID = (): string => `abcdef01-2345-6789-abcd-${String(uuidCounter++).padStart(12, "0")}`;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function withStateRoot(run: (stateRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-feedback-lock-"));
  try {
    await run(stateRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
}

function feedback(id: string, overrides: Partial<FeedbackRecord> = {}): FeedbackRecord {
  return {
    id,
    episodeId: createEpisodeId(UUID),
    kind: "human",
    rubricVersion: "1",
    score: 70,
    evidenceRefs: [],
    redacted: false,
    createdAt: parseIsoTimestamp("2026-08-24T09:00:00.000Z"),
    ...overrides
  };
}

async function readLines(stateRoot: string): Promise<string[]> {
  const raw = await readFile(feedbackLogPath(stateRoot), "utf8").catch(() => "");
  return raw.split("\n").filter((line) => line !== "");
}

async function idsOnDisk(stateRoot: string): Promise<string[]> {
  return (await readLines(stateRoot)).map((line) => (JSON.parse(line) as { id: string }).id);
}

test("the feedback lock sits next to the log it guards", () => {
  const stateRoot = join(tmpdir(), "pi-sparkle-feedback-lock-path");
  assert.equal(
    feedbackLogPath(stateRoot),
    join(stateRoot, "adaptation", "feedback", "records.jsonl")
  );
  assert.equal(feedbackLogLockPath(stateRoot), `${feedbackLogPath(stateRoot)}.lock`);
});

test("concurrent appends from one process all land, whole and in call order", async () => {
  await withStateRoot(async (stateRoot) => {
    const records = Array.from({ length: 12 }, (_unused, index) => feedback(`fb-${index}`));
    await Promise.all(records.map((record) => appendFeedback(stateRoot, record)));

    assert.deepEqual(
      await idsOnDisk(stateRoot),
      records.map((record) => record.id),
      "every row lands exactly once, in the order the appends were issued"
    );
    assert.equal(existsSync(feedbackLogLockPath(stateRoot)), false, "lock is released");
  });
});

test("an append waits for the log lock instead of writing under another writer", async () => {
  await withStateRoot(async (stateRoot) => {
    let pending: Promise<FeedbackRecord> | undefined;

    await withFeedbackLogLock(stateRoot, async () => {
      pending = appendFeedback(stateRoot, feedback("fb-waiting"));
      await sleep(80);
      assert.equal(
        existsSync(feedbackLogPath(stateRoot)),
        false,
        "the append must not touch the log while another writer holds the lock"
      );
    });

    assert.ok(pending !== undefined);
    await pending;
    assert.deepEqual(await idsOnDisk(stateRoot), ["fb-waiting"]);
    assert.equal(existsSync(feedbackLogLockPath(stateRoot)), false, "lock is released");
  });
});

test("an append that cannot take the lock times out instead of writing unlocked", async () => {
  await withStateRoot(async (stateRoot) => {
    let outcome: unknown;

    await withFeedbackLogLock(stateRoot, async () => {
      outcome = await appendFeedback(stateRoot, feedback("fb-timeout"), {
        timeoutMs: 40,
        retryMs: 5
      }).then(
        () => "resolved",
        (error: unknown) => error
      );
    });

    assert.ok(outcome instanceof DomainValidationError, "a lock timeout must reject the append");
    assert.match(outcome.message, /timed out waiting for lock/);
    assert.equal(existsSync(feedbackLogPath(stateRoot)), false, "no unlocked fallback write");
  });
});

test("a rewrite under the lock cannot clobber a concurrent append", async () => {
  await withStateRoot(async (stateRoot) => {
    const doomed = createEpisodeId(UUID);
    await appendFeedback(stateRoot, feedback("fb-keep"));
    await appendFeedback(stateRoot, feedback("fb-drop", { episodeId: doomed }));

    let pending: Promise<FeedbackRecord> | undefined;

    // The shape of the delete cascade's rewrite: read, filter, write — with an
    // append issued right inside that window. Unlocked, the write would erase
    // the appended row; locked, the append is still queued when the rewrite
    // finishes.
    await withFeedbackLogLock(stateRoot, async () => {
      const records = await readFeedbackRecordsRaw(stateRoot);
      pending = appendFeedback(stateRoot, feedback("fb-live"));
      await sleep(50);
      await writeFeedbackRecords(
        stateRoot,
        records.filter((record) => record.episodeId !== doomed)
      );
    });

    assert.ok(pending !== undefined);
    await pending;
    assert.deepEqual(await idsOnDisk(stateRoot), ["fb-keep", "fb-live"]);
  });
});

test("the delete cascade strips free text and still holds the lock while doing it", async () => {
  await withStateRoot(async (stateRoot) => {
    const doomed: EpisodeId = createEpisodeId(UUID);
    await appendFeedback(stateRoot, feedback("fb-other", { body: "unrelated note" }));
    await appendFeedback(
      stateRoot,
      feedback("fb-doomed", {
        episodeId: doomed,
        body: "raw user body text",
        summary: "derived user summary"
      })
    );

    let cascading: Promise<string[]> | undefined;
    const before = await readFile(feedbackLogPath(stateRoot), "utf8");

    await withFeedbackLogLock(stateRoot, async () => {
      cascading = cascadeFeedbackTombstones(stateRoot, doomed);
      await sleep(80);
      assert.equal(
        await readFile(feedbackLogPath(stateRoot), "utf8"),
        before,
        "the cascade must not rewrite the log while another writer holds the lock"
      );
      assert.equal(
        existsSync(feedbackTombstonesPath(stateRoot)),
        false,
        "nor publish tombstones from outside the lock"
      );
    });

    assert.ok(cascading !== undefined);
    assert.deepEqual(await cascading, ["fb-doomed"]);

    const records = await readFeedbackRecordsRaw(stateRoot);
    const stripped = records.find((record) => record.id === "fb-doomed");
    assert.ok(stripped);
    assert.equal(stripped.body, undefined);
    assert.equal(stripped.summary, undefined);
    const raw = await readFile(feedbackLogPath(stateRoot), "utf8");
    assert.doesNotMatch(raw, /raw user body text/);
    assert.doesNotMatch(raw, /derived user summary/);
    assert.match(raw, /unrelated note/);
    assert.deepEqual(
      JSON.parse(await readFile(feedbackTombstonesPath(stateRoot), "utf8")) as unknown,
      ["fb-doomed"]
    );
    assert.equal(existsSync(feedbackLogLockPath(stateRoot)), false, "lock is released");
  });
});

test("an append issued during a cascade survives the rewrite", async () => {
  await withStateRoot(async (stateRoot) => {
    const doomed = createEpisodeId(UUID);
    await appendFeedback(
      stateRoot,
      feedback("fb-doomed", { episodeId: doomed, body: "doomed body text" })
    );

    // Both writers race for the same lock: whichever order they serialize in,
    // the appended row must still be on disk and the doomed body must not.
    const [cascaded] = await Promise.all([
      cascadeFeedbackTombstones(stateRoot, doomed),
      appendFeedback(stateRoot, feedback("fb-live", { body: "live note" }))
    ]);

    assert.deepEqual(cascaded, ["fb-doomed"]);
    const ids = await idsOnDisk(stateRoot);
    assert.ok(ids.includes("fb-live"), "the concurrent append must not be clobbered");
    assert.ok(ids.includes("fb-doomed"), "the audit shell survives the strip");
    assert.doesNotMatch(await readFile(feedbackLogPath(stateRoot), "utf8"), /doomed body text/);
  });
});
