import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  appendFeedback,
  feedbackLogLockPath,
  feedbackLogPath,
  FEEDBACK_REDACTION_POLICY,
  readFeedback,
  readFeedbackRecordsRaw,
  withFeedbackLogLock,
  writeFeedbackRecords
} from "../../../src/feedback/store.js";
import { redactFeedback } from "../../../src/feedback/redaction.js";
import type { FeedbackRecord } from "../../../src/feedback/types.js";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { createEpisodeId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

function feedback(overrides: Partial<FeedbackRecord> = {}): FeedbackRecord {
  return {
    id: "fb-store-1",
    episodeId: createEpisodeId(UUID),
    kind: "human",
    rubricVersion: "1",
    score: 80,
    evidenceRefs: [],
    redacted: false,
    createdAt: parseIsoTimestamp("2026-08-24T09:00:00.000Z"),
    ...overrides
  };
}

async function withStateRoot(run: (stateRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-feedback-store-"));
  try {
    await run(stateRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
}

/**
 * Rows are written by hand where the point is what a *foreign* writer put on
 * disk — an older version of this code, a future one, or a rewrite that got the
 * invariants wrong. Going through appendFeedback would only test the shapes
 * this version already produces.
 */
async function writeRawRows(stateRoot: string, rows: readonly unknown[]): Promise<void> {
  const path = feedbackLogPath(stateRoot);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function readRawLines(stateRoot: string): Promise<Record<string, unknown>[]> {
  const raw = await readFile(feedbackLogPath(stateRoot), "utf8");
  return raw
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

test("appendFeedback persists the classes the redaction decision reported", async () => {
  await withStateRoot(async (stateRoot) => {
    const record = feedback({
      body: "reporter john.doe@example.com used sk-proj-abcdefghijklmnop1234567890",
      summary: "escalated from /home/john/.ssh/id_rsa"
    });
    const expected = redactFeedback(record, FEEDBACK_REDACTION_POLICY).decision.classes;
    assert.deepEqual(expected, ["secret", "pii", "path"]);

    const stored = await appendFeedback(stateRoot, record);
    assert.deepEqual(stored.redactionClasses, expected);

    const [line] = await readRawLines(stateRoot);
    assert.deepEqual(line?.redactionClasses, expected, "classes must reach disk, not just the return value");
    assert.equal(line?.redacted, true);
  });
});

test("classes round-trip through the log in canonical order", async () => {
  await withStateRoot(async (stateRoot) => {
    await appendFeedback(
      stateRoot,
      feedback({ id: "fb-a", body: "clean note" })
    );
    await appendFeedback(
      stateRoot,
      feedback({ id: "fb-b", body: "key sk-proj-abcdefghijklmnop1234567890" })
    );

    const reloaded = await readFeedback(stateRoot);
    assert.deepEqual(
      reloaded.map((record) => [record.id, record.redactionClasses]),
      [
        ["fb-a", ["pii"]],
        ["fb-b", ["secret", "pii"]]
      ]
    );
    // The deletion engine's unfiltered reader sees the same thing.
    const raw = await readFeedbackRecordsRaw(stateRoot);
    assert.deepEqual(raw.map((record) => record.redactionClasses), [["pii"], ["secret", "pii"]]);
  });
});

test("a PII pass that matched nothing is distinguishable from a secret match", async () => {
  await withStateRoot(async (stateRoot) => {
    const clean = await appendFeedback(stateRoot, feedback({ id: "fb-clean", body: "all good" }));
    const dirty = await appendFeedback(
      stateRoot,
      feedback({ id: "fb-dirty", body: "key sk-proj-abcdefghijklmnop1234567890" })
    );

    // `redacted` cannot tell these apart: the store's policy sets it as soon as
    // the PII pass runs. The class list can.
    assert.equal(clean.redacted, true);
    assert.equal(dirty.redacted, true);
    assert.equal(clean.redactionClasses?.includes("secret"), false);
    assert.equal(dirty.redactionClasses?.includes("secret"), true);

    // Same distinction after a reload, including for a foreign row that
    // recorded "the pass ran and matched nothing" as an empty list.
    await writeRawRows(stateRoot, [
      ...(await readRawLines(stateRoot)),
      { ...feedback({ id: "fb-empty" }), redacted: true, redactionClasses: [] }
    ]);
    const byId = new Map((await readFeedback(stateRoot)).map((record) => [record.id, record]));
    assert.deepEqual(byId.get("fb-empty")?.redactionClasses, []);
    assert.equal(byId.get("fb-empty")?.redacted, true);
    assert.equal(byId.get("fb-empty")?.redactionClasses?.includes("secret"), false);
    assert.equal(byId.get("fb-dirty")?.redactionClasses?.includes("secret"), true);
  });
});

test("rows written before the field existed still load, and stay 'unknown'", async () => {
  await withStateRoot(async (stateRoot) => {
    const legacy = {
      id: "fb-legacy",
      episodeId: createEpisodeId(UUID),
      kind: "human",
      rubricVersion: "1",
      score: 71,
      evidenceRefs: [],
      redacted: true,
      createdAt: "2026-08-20T09:00:00.000Z",
      body: "old note that was already redacted",
      summary: "old summary"
    };
    await writeRawRows(stateRoot, [legacy]);

    const [record] = await readFeedback(stateRoot);
    assert.ok(record);
    assert.equal(record.id, "fb-legacy");
    assert.equal(record.body, "old note that was already redacted");
    assert.equal(record.summary, "old summary");
    // Absent is not the same claim as "[]": an old row cannot tell us whether
    // anything matched, and the reader must not invent an answer.
    assert.equal(record.redactionClasses, undefined);
    assert.equal("redactionClasses" in record, false);
  });
});

test("an unknown class string fails the read closed", async () => {
  await withStateRoot(async (stateRoot) => {
    await writeRawRows(stateRoot, [
      { ...feedback({ id: "fb-ok", body: "fine" }), redacted: true, redactionClasses: ["pii"] },
      { ...feedback({ id: "fb-bad" }), redacted: true, redactionClasses: ["secret", "credit-card"] }
    ]);

    await assert.rejects(
      () => readFeedback(stateRoot),
      (error: unknown) =>
        error instanceof DomainValidationError &&
        error.message.includes("fb-bad") &&
        error.message.includes("credit-card")
    );
    // The whole read fails, rather than the good rows being served alongside a
    // record whose redaction state we cannot interpret.
    await assert.rejects(() => readFeedbackRecordsRaw(stateRoot), DomainValidationError);
  });
});

test("a malformed classes field fails the read closed too", async () => {
  await withStateRoot(async (stateRoot) => {
    await writeRawRows(stateRoot, [
      { ...feedback({ id: "fb-string" }), redacted: true, redactionClasses: "secret" }
    ]);
    await assert.rejects(() => readFeedback(stateRoot), DomainValidationError);

    await writeRawRows(stateRoot, [
      { ...feedback({ id: "fb-number" }), redacted: true, redactionClasses: [1] }
    ]);
    await assert.rejects(() => readFeedback(stateRoot), DomainValidationError);
  });
});

test("a row claiming the body was dropped never hands one back", async () => {
  await withStateRoot(async (stateRoot) => {
    await writeRawRows(stateRoot, [
      {
        ...feedback({ id: "fb-resurrected" }),
        redacted: true,
        redactionClasses: ["pii", "oversized"],
        body: "the oversized body someone wrote back onto the row",
        summary: "summary survives: oversized only ever drops the body"
      }
    ]);

    for (const record of [
      (await readFeedback(stateRoot))[0],
      (await readFeedbackRecordsRaw(stateRoot))[0]
    ]) {
      assert.ok(record);
      assert.equal(record.body, undefined);
      assert.equal(record.summary, "summary survives: oversized only ever drops the body");
      assert.deepEqual(record.redactionClasses, ["pii", "oversized"]);
    }
  });
});

test("an oversized body is dropped on append and cannot come back on re-append", async () => {
  await withStateRoot(async (stateRoot) => {
    const stored = await appendFeedback(
      stateRoot,
      feedback({ id: "fb-big", body: "x".repeat(500), summary: "kept" })
    );
    assert.equal(stored.body, undefined);
    assert.deepEqual(stored.redactionClasses, ["pii", "oversized"]);

    const [line] = await readRawLines(stateRoot);
    assert.equal("body" in (line ?? {}), false, "the dropped body must not be on disk");

    const [reloaded] = await readFeedback(stateRoot);
    assert.ok(reloaded);
    const reappended = await appendFeedback(stateRoot, reloaded);
    assert.equal(reappended.body, undefined);
    assert.deepEqual(reappended.redactionClasses, ["pii", "oversized"]);
  });
});

test("the write lock sits beside the log it guards", () => {
  const stateRoot = join(tmpdir(), "pi-sparkle-feedback-path-check");
  assert.equal(feedbackLogLockPath(stateRoot), `${feedbackLogPath(stateRoot)}.lock`);
  assert.match(feedbackLogLockPath(stateRoot), /records\.jsonl\.lock$/);
});

test("an append waits for the log lock instead of writing under another writer", async () => {
  await withStateRoot(async (stateRoot) => {
    let pending: Promise<FeedbackRecord> | undefined;

    await withFeedbackLogLock(stateRoot, async () => {
      pending = appendFeedback(stateRoot, feedback({ id: "fb-queued", body: "note" }));
      await sleep(80);
      assert.equal(
        existsSync(feedbackLogPath(stateRoot)),
        false,
        "the append must not touch the log while another writer holds the lock"
      );
    });

    assert.ok(pending !== undefined);
    await pending;
    assert.deepEqual((await readRawLines(stateRoot)).map((line) => line.id), ["fb-queued"]);
    assert.equal(existsSync(feedbackLogLockPath(stateRoot)), false, "lock is released");
  });
});

test("concurrent appends from one process all land, whole and in call order", async () => {
  await withStateRoot(async (stateRoot) => {
    const ids = Array.from({ length: 12 }, (_, index) => `fb-concurrent-${index}`);
    await Promise.all(ids.map((id) => appendFeedback(stateRoot, feedback({ id, body: "note" }))));

    assert.deepEqual(
      (await readRawLines(stateRoot)).map((line) => line.id),
      ids,
      "every row lands exactly once, in the order the appends were issued"
    );
  });
});

/**
 * The shape of the deletion cascade's rewrite — read, filter, write — with an
 * append issued right inside that window. Unlocked, the write erased the
 * appended row; locked, the append is still queued when the rewrite finishes.
 */
test("a rewrite under the lock cannot clobber a concurrent append", async () => {
  await withStateRoot(async (stateRoot) => {
    await appendFeedback(stateRoot, feedback({ id: "fb-kept", body: "keep me" }));
    await appendFeedback(stateRoot, feedback({ id: "fb-dropped", body: "drop me" }));
    let pending: Promise<FeedbackRecord> | undefined;

    await withFeedbackLogLock(stateRoot, async () => {
      const records = await readFeedbackRecordsRaw(stateRoot);
      pending = appendFeedback(stateRoot, feedback({ id: "fb-live", body: "live note" }));
      await sleep(50);
      await writeFeedbackRecords(
        stateRoot,
        records.filter((record) => record.id !== "fb-dropped")
      );
    });

    assert.ok(pending !== undefined);
    await pending;
    const rows = await readRawLines(stateRoot);
    assert.deepEqual(rows.map((row) => row.id), ["fb-kept", "fb-live"]);
    // Whole, not merely present: a torn line would not have survived JSON.parse
    // in readRawLines, and the payload has to be the one that was appended.
    assert.equal(rows[1]?.body, "live note");
  });
});

test("the writer-side read names the corrupt line and what it is refusing to do", async () => {
  await withStateRoot(async (stateRoot) => {
    const path = feedbackLogPath(stateRoot);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      `${JSON.stringify(feedback({ id: "fb-ok" }))}\n{ not json\n${JSON.stringify(feedback({ id: "fb-late" }))}\n`,
      "utf8"
    );

    await assert.rejects(
      () => readFeedbackRecordsRaw(stateRoot, "refusing to rewrite it for a delete"),
      (error: unknown) => {
        assert.ok(error instanceof DomainValidationError);
        assert.equal(
          error.message,
          `corrupt feedback jsonl at line 2 of ${path}; refusing to rewrite it for a delete`
        );
        return true;
      }
    );
    // readFeedback keeps failing closed too, with its own default refusal.
    await assert.rejects(() => readFeedback(stateRoot), DomainValidationError);
  });
});

test("unrecognised extra fields survive a read, so a forward row is not truncated", async () => {
  await withStateRoot(async (stateRoot) => {
    // The deletion cascade reads records and writes them back whole; dropping
    // fields we do not know about would silently rewrite a newer log.
    await writeRawRows(stateRoot, [
      {
        ...feedback({ id: "fb-forward", body: "note" }),
        redacted: true,
        redactionClasses: ["pii"],
        futureField: { keep: "me" }
      }
    ]);
    const [record] = await readFeedback(stateRoot);
    assert.ok(record);
    assert.deepEqual((record as unknown as Record<string, unknown>).futureField, { keep: "me" });
  });
});
