import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { createEpisodeId, createRunId, type EpisodeId, type RunId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { appendFeedback, readFeedback, readFeedbackRecordsRaw } from "../../../src/feedback/store.js";
import {
  FREE_TEXT_FEEDBACK_FIELDS,
  cascadeFeedbackTombstones,
  deleteEpisodeRecords,
  deleteRunRecords
} from "../../../src/privacy/deletion.js";
import { catalogObservedPath } from "../../../src/routing/catalog-observed.js";
import {
  invocationsLogPath,
  loadInvocationsFromStateRoot
} from "../../../src/routing/cost-calibration.js";

let uuidCounter = 0;
const UUID = (): string => `abcdef01-2345-6789-abcd-${String(uuidCounter++).padStart(12, "0")}`;

async function withStateRoot(run: (stateRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-deletion-"));
  try {
    await run(stateRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
}

function invocationRow(runId: RunId, id: string): Record<string, unknown> {
  return {
    id,
    taskId: "tsk_del",
    runId,
    agentInstanceId: "agt_del",
    config: { provider: "fake", model: "cheap", modelVersion: "cheap-v1", parameterHash: "abc" },
    responseHash: "def",
    tokensIn: 1000,
    tokensOut: 500,
    latencyMs: 200,
    occurredAt: "2026-08-24T00:00:00.000Z",
    callOutcome: "ok"
  };
}

async function writeInvocationLog(stateRoot: string, lines: readonly string[]): Promise<string> {
  const path = invocationsLogPath(stateRoot);
  await mkdir(join(stateRoot, "runtime"), { recursive: true });
  await writeFile(path, lines.join(""), "utf8");
  return path;
}

async function seedFeedback(
  stateRoot: string,
  episodeId: EpisodeId,
  id: string,
  free: { body?: string; summary?: string }
): Promise<void> {
  await appendFeedback(stateRoot, {
    id,
    episodeId,
    kind: "human",
    rubricVersion: "1",
    score: 70,
    evidenceRefs: [],
    redacted: false,
    createdAt: parseIsoTimestamp("2026-08-24T00:00:00.000Z"),
    ...(free.body !== undefined ? { body: free.body } : {}),
    ...(free.summary !== undefined ? { summary: free.summary } : {})
  });
}

test("the episode cascade strips every declared free-text feedback field", async () => {
  await withStateRoot(async (stateRoot) => {
    const episodeId = createEpisodeId(UUID);
    await seedFeedback(stateRoot, episodeId, "fb-both", {
      body: "raw user body text",
      summary: "user: I keep failing to log in with alice@example.com"
    });

    const cascaded = await cascadeFeedbackTombstones(stateRoot, episodeId);
    assert.deepEqual(cascaded, ["fb-both"]);

    // No free-text field may survive on the record shell...
    const [record] = await readFeedbackRecordsRaw(stateRoot);
    assert.ok(record);
    for (const field of FREE_TEXT_FEEDBACK_FIELDS) {
      assert.equal(record[field], undefined, `${field} must be stripped`);
    }
    // ...and none may survive as raw bytes in the log either.
    const raw = await readFile(
      join(stateRoot, "adaptation", "feedback", "records.jsonl"),
      "utf8"
    );
    assert.doesNotMatch(raw, /raw user body text/);
    assert.doesNotMatch(raw, /alice@example\.com/);
    assert.doesNotMatch(raw, /"summary"/);
    // The audit shell survives so the deletion itself stays inspectable.
    assert.equal(record.id, "fb-both");
    assert.equal(record.score, 70);
  });
});

test("a summary-only record is cascaded even with no body present", async () => {
  await withStateRoot(async (stateRoot) => {
    const episodeId = createEpisodeId(UUID);
    await seedFeedback(stateRoot, episodeId, "fb-summary-only", {
      summary: "peer: the migration script drops the audit table"
    });
    await deleteEpisodeRecords(stateRoot, episodeId);

    const [record] = await readFeedbackRecordsRaw(stateRoot);
    assert.ok(record);
    assert.equal(record.summary, undefined);
    assert.deepEqual(await readFeedback(stateRoot), []);
  });
});

test("a second cascade cannot resurrect a stripped summary", async () => {
  await withStateRoot(async (stateRoot) => {
    const episodeId = createEpisodeId(UUID);
    await seedFeedback(stateRoot, episodeId, "fb-idempotent", {
      body: "body text",
      summary: "summary text"
    });
    await deleteEpisodeRecords(stateRoot, episodeId);
    const again = await deleteEpisodeRecords(stateRoot, episodeId);
    assert.deepEqual(again.cascadedFeedbackTombstones, ["fb-idempotent"]);

    const raw = await readFile(join(stateRoot, "adaptation", "feedback", "records.jsonl"), "utf8");
    assert.doesNotMatch(raw, /summary text/);
    assert.doesNotMatch(raw, /body text/);
  });
});

test("delete --episode removes the episode's cooperative lock", async () => {
  await withStateRoot(async (stateRoot) => {
    const episodeId = createEpisodeId(UUID);
    const episodesDir = join(stateRoot, "runtime", "episodes");
    await mkdir(episodesDir, { recursive: true });
    await writeFile(join(episodesDir, `${episodeId}.jsonl`), "{}\n", "utf8");
    const lockPath = join(episodesDir, `${episodeId}.lock`);
    await writeFile(lockPath, JSON.stringify({ ownerToken: "t", pid: 1 }), "utf8");

    const result = await deleteEpisodeRecords(stateRoot, episodeId);
    assert.equal(existsSync(lockPath), false, "episode lock must not outlive the episode");
    assert.ok(result.removedPaths.includes(lockPath));
    assert.equal(result.droppedInvocations, 0);
  });
});

test("delete --run drops only that run's rows from the shared invocation log", async () => {
  await withStateRoot(async (stateRoot) => {
    const doomed = createRunId(UUID);
    const keeper = createRunId(UUID);
    const path = await writeInvocationLog(stateRoot, [
      `${JSON.stringify(invocationRow(doomed, "inv_a"))}\n`,
      `${JSON.stringify(invocationRow(keeper, "inv_b"))}\n`,
      `${JSON.stringify(invocationRow(doomed, "inv_c"))}\n`
    ]);

    const result = await deleteRunRecords(stateRoot, doomed);
    assert.equal(result.droppedInvocations, 2);
    assert.ok(result.removedPaths.some((line) => line.startsWith(path)));

    const remaining = await loadInvocationsFromStateRoot(stateRoot);
    assert.deepEqual(
      remaining.map((inv) => inv.id),
      ["inv_b"]
    );
    assert.doesNotMatch(await readFile(path, "utf8"), new RegExp(doomed));
  });
});

test("delete --run leaves the invocation log untouched when the run has no rows", async () => {
  await withStateRoot(async (stateRoot) => {
    const keeper = createRunId(UUID);
    const path = await writeInvocationLog(stateRoot, [
      `${JSON.stringify(invocationRow(keeper, "inv_b"))}\n`
    ]);
    const before = await readFile(path, "utf8");

    const result = await deleteRunRecords(stateRoot, createRunId(UUID));
    assert.equal(result.droppedInvocations, 0);
    assert.deepEqual(result.removedPaths, []);
    assert.equal(await readFile(path, "utf8"), before);
  });
});

test("a corrupt middle line fails the run delete closed, before anything is unlinked", async () => {
  await withStateRoot(async (stateRoot) => {
    const doomed = createRunId(UUID);
    await writeInvocationLog(stateRoot, [
      `${JSON.stringify(invocationRow(doomed, "inv_a"))}\n`,
      "{ this is not json\n",
      `${JSON.stringify(invocationRow(doomed, "inv_c"))}\n`
    ]);
    const runDir = join(stateRoot, "runtime", "runs", doomed);
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, "events.jsonl"), "{}\n", "utf8");

    await assert.rejects(
      () => deleteRunRecords(stateRoot, doomed),
      (error: unknown) => {
        assert.ok(error instanceof DomainValidationError);
        assert.match(error.message, /corrupt invocation jsonl at line 2/);
        return true;
      }
    );
    assert.equal(existsSync(runDir), true, "a failed delete must not half-delete the run");
  });
});

test("a crash-truncated final line is dropped by the rewrite instead of being kept", async () => {
  await withStateRoot(async (stateRoot) => {
    const doomed = createRunId(UUID);
    const keeper = createRunId(UUID);
    const path = await writeInvocationLog(stateRoot, [
      `${JSON.stringify(invocationRow(doomed, "inv_a"))}\n`,
      `${JSON.stringify(invocationRow(keeper, "inv_b"))}\n`,
      '{"id":"inv_partial","runId":"run_'
    ]);

    const result = await deleteRunRecords(stateRoot, doomed);
    assert.equal(result.droppedInvocations, 1);
    const rewritten = await readFile(path, "utf8");
    assert.doesNotMatch(rewritten, /inv_partial/);
    assert.match(rewritten, /inv_b/);
  });
});

test("run delete invalidates the derived observed snapshot only when rows were dropped", async () => {
  await withStateRoot(async (stateRoot) => {
    const doomed = createRunId(UUID);
    const observed = catalogObservedPath(stateRoot);
    await mkdir(join(stateRoot, "runtime", "routing"), { recursive: true });
    await writeFile(observed, JSON.stringify({ versions: {} }), "utf8");

    // No rows for this run: a delete must not touch an unrelated aggregate.
    await deleteRunRecords(stateRoot, doomed);
    assert.equal(existsSync(observed), true);

    await writeInvocationLog(stateRoot, [`${JSON.stringify(invocationRow(doomed, "inv_a"))}\n`]);
    const result = await deleteRunRecords(stateRoot, doomed);
    assert.equal(existsSync(observed), false, "stale p50 aggregate must not survive the delete");
    assert.ok(result.removedPaths.includes(observed));
  });
});
