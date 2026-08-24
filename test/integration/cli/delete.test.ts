import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deleteCommand } from "../../../src/cli/main.js";
import type { CliIo } from "../../../src/cli/main.js";
import {
  appendFeedback,
  feedbackLogPath,
  readFeedback,
  readFeedbackRecordsRaw
} from "../../../src/feedback/store.js";
import { invocationsLogPath } from "../../../src/routing/cost-calibration.js";
import { EpisodeStore } from "../../../src/run/episode-store.js";
import { EpisodeEventStore } from "../../../src/episode/store.js";
import {
  createEpisodeId,
  createProjectId,
  createRunId,
  type EpisodeId,
  type RunId
} from "../../../src/domain/ids.js";
import type { ProjectEpisode } from "../../../src/domain/episode.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { deleteRunRecords, verifyRunRecordsRemoved } from "../../../src/privacy/deletion.js";
import { withExclusiveFileLock } from "../../../src/persist/file-lock.js";
import { feedbackTombstonesPath as fbTombPathStore } from "../../../src/feedback/store.js";
import { EventStore, runLockPath } from "../../../src/run/event-store.js";
import type { Event } from "../../../src/run/events.js";
import { createEventId } from "../../../src/domain/ids.js";

// Distinct ids per call: each fixture episode/feedback must be unique.
let uuidCounter = 0;
const UUID = () => `01234567-89ab-cdef-0123-${String(uuidCounter++).padStart(12, "0")}`;

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (text) => out.push(text), stderr: (text) => err.push(text) },
    out,
    err
  };
}

async function withStateRoot(run: (stateRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-delete-"));
  try {
    await run(stateRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
}

interface Seed {
  episodeId: EpisodeId;
}

function invocationLine(runId: RunId, id: string): string {
  return `${JSON.stringify({
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
  })}\n`;
}

function episodeFixture(episodeId: EpisodeId): ProjectEpisode {
  return {
    id: episodeId,
    projectId: createProjectId(UUID),
    objective: "fixture objective",
    contractVersion: 1,
    runIds: [],
    startedAt: parseIsoTimestamp("2026-08-22T00:00:00.000Z"),
    status: "COMPLETED",
    acceptance: [],
    evidenceRefs: []
  };
}

async function seedEpisodeWithFeedback(stateRoot: string): Promise<Seed> {
  const episodeId = createEpisodeId(UUID);
  // Both durable episode shapes exist under runtime/episodes/.
  await new EpisodeStore(stateRoot, episodeId).append(episodeFixture(episodeId));
  await new EpisodeEventStore(stateRoot, episodeId).append({
    type: "EPISODE_OPENED",
    episode: episodeFixture(episodeId),
    occurredAt: parseIsoTimestamp("2026-08-22T00:00:00.000Z")
  });
  // Feedback bound to this episode (both user-text fields populated) and one
  // for another episode. `summary` is what the auto-adapt loop fills with
  // derived user text, so the cascade has to reach it too.
  await appendFeedback(stateRoot, {
    id: "fb-own",
    episodeId,
    kind: "human",
    rubricVersion: "1",
    score: 80,
    evidenceRefs: [],
    redacted: false,
    createdAt: parseIsoTimestamp("2026-08-22T00:00:00.000Z"),
    body: "user said something sensitive here",
    summary: "user: my recovery phrase is written on the whiteboard"
  });
  const otherEpisode = createEpisodeId(UUID);
  await appendFeedback(stateRoot, {
    id: "fb-other",
    episodeId: otherEpisode,
    kind: "human",
    rubricVersion: "1",
    score: 60,
    evidenceRefs: [],
    redacted: false,
    createdAt: parseIsoTimestamp("2026-08-22T00:00:01.000Z"),
    body: "unrelated feedback stays intact",
    summary: "unrelated summary stays intact"
  });
  return { episodeId };
}

test("delete --episode removes both episode shapes and cascades feedback tombstones", async () => {
  await withStateRoot(async (stateRoot) => {
    const seed = await seedEpisodeWithFeedback(stateRoot);
    const io = capture();
    const code = await deleteCommand(
      ["--episode", seed.episodeId, "--state-root", stateRoot],
      io.io
    );
    assert.equal(code, 0, io.err.join(""));

    assert.equal(existsSync(join(stateRoot, "runtime", "episodes", `${seed.episodeId}.jsonl`)), false);
    assert.equal(
      existsSync(join(stateRoot, "runtime", "episodes", `${seed.episodeId}.events.jsonl`)),
      false
    );

    // The bound feedback is tombstoned and both free-text fields are stripped.
    const tombstones = JSON.parse(await readFile(fbTombPathStore(stateRoot), "utf8"));
    assert.ok((tombstones as string[]).includes("fb-own"));
    const records = await readFeedbackRecordsRaw(stateRoot);
    const own = records.find((r) => r.id === "fb-own");
    assert.ok(own);
    assert.equal(own.body, undefined, "body must be stripped");
    assert.equal(own.summary, undefined, "summary must be stripped");
    // Unrelated feedback keeps its payload and is not tombstoned.
    const other = records.find((r) => r.id === "fb-other");
    assert.ok(other);
    assert.equal(other.body, "unrelated feedback stays intact");
    assert.equal(other.summary, "unrelated summary stays intact");
    assert.ok(!(tombstones as string[]).includes("fb-other"));
    assert.match(io.out.join(""), /tombstoned feedback: fb-own/);
  });
});

test("deleted episode text cannot be resurrected from disk or through the read API", async () => {
  await withStateRoot(async (stateRoot) => {
    const seed = await seedEpisodeWithFeedback(stateRoot);
    const io = capture();
    assert.equal(
      await deleteCommand(["--episode", seed.episodeId, "--state-root", stateRoot], io.io),
      0,
      io.err.join("")
    );

    // Raw bytes: the stripped fields are gone from the log, not merely hidden.
    const raw = await readFile(feedbackLogPath(stateRoot), "utf8");
    assert.doesNotMatch(raw, /recovery phrase/);
    assert.doesNotMatch(raw, /something sensitive/);
    // The unrelated record proves the rewrite was surgical, not a truncation.
    assert.match(raw, /unrelated summary stays intact/);

    // Read API: the tombstone filter also hides the whole record.
    const visible = await readFeedback(stateRoot);
    assert.deepEqual(
      visible.map((record) => record.id),
      ["fb-other"]
    );

    // A repeat delete re-asserts the tombstone and still finds nothing to leak.
    const second = capture();
    assert.equal(
      await deleteCommand(["--episode", seed.episodeId, "--state-root", stateRoot], second.io),
      0,
      second.err.join("")
    );
    assert.doesNotMatch(await readFile(feedbackLogPath(stateRoot), "utf8"), /recovery phrase/);
  });
});

function runEvent(runId: RunId, type: Event["type"], payload: unknown): Event {
  return {
    id: createEventId(UUID),
    schemaVersion: 1,
    occurredAt: parseIsoTimestamp("2026-08-22T00:00:00.000Z"),
    runId,
    type,
    actor: "delete-cli-test",
    payload
  } as Event;
}

/**
 * A run attached to the episode whose append-only event log embeds the whole
 * episode snapshot — the copy `delete --episode` refuses to rewrite.
 */
async function attachRunHoldingEpisodeText(
  stateRoot: string,
  episodeId: EpisodeId
): Promise<RunId> {
  const runId = createRunId(UUID);
  const store = new EventStore(stateRoot, runId);
  await store.append(runEvent(runId, "EPISODE_OPENED", { episode: episodeFixture(episodeId) }));
  await store.append(
    runEvent(runId, "RUN_ATTACHED", {
      episodeId,
      runId,
      attachedAt: parseIsoTimestamp("2026-08-22T00:00:00.000Z")
    })
  );
  return runId;
}

test("delete --episode tells the operator which runs still hold a copy of the text", async () => {
  await withStateRoot(async (stateRoot) => {
    const seed = await seedEpisodeWithFeedback(stateRoot);
    const runId = await attachRunHoldingEpisodeText(stateRoot, seed.episodeId);
    const logPath = join(stateRoot, "runtime", "runs", runId, "events.jsonl");
    const before = await readFile(logPath, "utf8");

    const io = capture();
    assert.equal(
      await deleteCommand(["--episode", seed.episodeId, "--state-root", stateRoot], io.io),
      0,
      io.err.join("")
    );

    const out = io.out.join("");
    assert.match(out, new RegExp(`residual episode text: run ${runId}`));
    assert.match(out, new RegExp(`delete --run ${runId}`), "the notice must name the remedy");
    // Disclosed, not rewritten: the event log is byte-identical.
    assert.equal(await readFile(logPath, "utf8"), before);
    assert.match(before, /fixture objective/);
  });
});

test("delete --episode prints no residual line when no run holds the text", async () => {
  await withStateRoot(async (stateRoot) => {
    const seed = await seedEpisodeWithFeedback(stateRoot);
    const io = capture();
    assert.equal(
      await deleteCommand(["--episode", seed.episodeId, "--state-root", stateRoot], io.io),
      0,
      io.err.join("")
    );
    assert.doesNotMatch(io.out.join(""), /residual episode text/);
  });
});

test("residual copies are disclosed even when the episode itself has nothing left to delete", async () => {
  await withStateRoot(async (stateRoot) => {
    // No episode records, no bound feedback: the delete finds nothing and
    // fails closed, but the operator still has to learn about the copy.
    const episodeId = createEpisodeId(UUID);
    const runId = await attachRunHoldingEpisodeText(stateRoot, episodeId);

    const io = capture();
    assert.equal(await deleteCommand(["--episode", episodeId, "--state-root", stateRoot], io.io), 1);
    assert.match(io.err.join(""), /nothing found/);
    assert.match(io.out.join(""), new RegExp(`residual episode text: run ${runId}`));
  });
});

test("delete --run removes the whole runtime run subtree", async () => {
  await withStateRoot(async (stateRoot) => {
    const runId = createRunId(UUID);
    const runDir = join(stateRoot, "runtime", "runs", runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, "events.jsonl"), "{}\n", "utf8");
    await writeFile(join(runDir, "checkpoint.json"), "{}", "utf8");
    await writeFile(join(runDir, "pause.json"), "{}", "utf8");

    const io = capture();
    const code = await deleteCommand(["--run", runId, "--state-root", stateRoot], io.io);
    assert.equal(code, 0, io.err.join(""));
    assert.equal(existsSync(runDir), false);
  });
});

/**
 * `delete --run` prints "removed: <runDir>" only for a removal it verified.
 * Nothing on the run plane locks against a live writer, so the second half of
 * this test is the operator-visible consequence the CLI now has to live with:
 * an executor that outlives the delete recreates the run directory on its
 * next append, and the remedy is to stop it and delete again.
 */
test("delete --run proves the subtree is gone, and re-deletes a run that wrote again", async () => {
  await withStateRoot(async (stateRoot) => {
    const runId = createRunId(UUID);
    const store = new EventStore(stateRoot, runId);
    const append = async (summary: string): Promise<void> =>
      store.append(
        runEvent(runId, "AGENT_EVENT", {
          agentInstanceId: "agt_00000000-0000-4000-8000-00000000000a",
          kind: "TEXT_DELTA",
          summary
        })
      );
    await append("work before the delete");
    const runDir = join(stateRoot, "runtime", "runs", runId);

    const first = capture();
    assert.equal(
      await deleteCommand(["--run", runId, "--state-root", stateRoot], first.io),
      0,
      first.err.join("")
    );
    assert.match(first.out.join(""), new RegExp(`removed: .*${runId}`));
    assert.equal(existsSync(runDir), false);
    // The exit code the operator saw is backed by a check, not an assumption.
    await verifyRunRecordsRemoved(stateRoot, runId);

    await append("work after the delete");
    assert.equal(existsSync(runDir), true, "a live appender recreates the deleted directory");
    const second = capture();
    assert.equal(
      await deleteCommand(["--run", runId, "--state-root", stateRoot], second.io),
      0,
      second.err.join("")
    );
    assert.equal(existsSync(runDir), false);
    await verifyRunRecordsRemoved(stateRoot, runId);
  });
});

/**
 * The operator-visible half of the run lock: `delete --run` does not delete
 * around a live holder, it waits for it. Nothing in the CLI changed for this —
 * the wait happens inside `deleteRunRecords` — so what this pins is that the
 * command still exits 0 and reports the removal after the holder let go, and
 * that it leaves no lock file behind for the next operator to puzzle over.
 */
test("delete --run waits for whoever holds the run lock, then reports the removal", async () => {
  await withStateRoot(async (stateRoot) => {
    const runId = createRunId(UUID);
    const runDir = join(stateRoot, "runtime", "runs", runId);
    await new EventStore(stateRoot, runId).append(
      runEvent(runId, "AGENT_EVENT", {
        agentInstanceId: "agt_00000000-0000-4000-8000-00000000000b",
        kind: "TEXT_DELTA",
        summary: "work before the delete"
      })
    );

    const io = capture();
    let pending: Promise<number> | undefined;
    await withExclusiveFileLock(runLockPath(stateRoot, runId), async () => {
      pending = deleteCommand(["--run", runId, "--state-root", stateRoot], io.io);
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.equal(existsSync(runDir), true, "the delete must wait, not delete around the holder");
    });

    assert.ok(pending !== undefined);
    assert.equal(await pending, 0, io.err.join(""));
    assert.match(io.out.join(""), new RegExp(`removed: .*${runId}`));
    assert.equal(existsSync(runDir), false);
    await verifyRunRecordsRemoved(stateRoot, runId);
    assert.equal(
      existsSync(runLockPath(stateRoot, runId)),
      false,
      "a completed delete leaves no run lock behind"
    );
    assert.doesNotMatch(io.out.join(""), /\.lock/, "the lock is not a record the delete removed");
  });
});

test("delete --run reaches the shared invocation log and reports what it dropped", async () => {
  await withStateRoot(async (stateRoot) => {
    const doomed = createRunId(UUID);
    const keeper = createRunId(UUID);
    const logPath = invocationsLogPath(stateRoot);
    await mkdir(join(stateRoot, "runtime"), { recursive: true });
    await writeFile(
      logPath,
      [invocationLine(doomed, "inv_doomed"), invocationLine(keeper, "inv_keeper")].join(""),
      "utf8"
    );
    // A run with no subtree of its own still has rows to remove: the log is
    // global, so "nothing found" must not be reported for it.
    const io = capture();
    assert.equal(await deleteCommand(["--run", doomed, "--state-root", stateRoot], io.io), 0, io.err.join(""));

    const rewritten = await readFile(logPath, "utf8");
    assert.doesNotMatch(rewritten, new RegExp(doomed));
    assert.match(rewritten, new RegExp(keeper));
    assert.match(io.out.join(""), /invocations\.jsonl \(1 invocation row\(s\)\)/);
  });
});

test("delete fails closed on missing flags and unknown targets; engine is idempotent", async () => {
  await withStateRoot(async (stateRoot) => {
    // No target flag.
    const noFlag = capture();
    assert.equal(await deleteCommand(["--state-root", stateRoot], noFlag.io), 1);
    assert.match(noFlag.err.join(""), /exactly one of --run|--episode/);

    // Unknown id: nothing found must not look like success.
    const unknown = capture();
    assert.equal(
      await deleteCommand(["--run", "run_doesnotexist", "--state-root", stateRoot], unknown.io),
      1
    );
    assert.match(unknown.err.join(""), /nothing found/);

    // Engine-level idempotency: a second delete of the same run is a no-op.
    const runId = createRunId(UUID);
    await mkdir(join(stateRoot, "runtime", "runs", runId), { recursive: true });
    const first = await deleteRunRecords(stateRoot, runId);
    assert.equal(first.removedPaths.length, 1);
    const second = await deleteRunRecords(stateRoot, runId);
    assert.deepEqual(second.removedPaths, []);
  });
});

test("feedback log path lives in the adaptation plane (Q1 layout)", async () => {
  await withStateRoot(async (stateRoot) => {
    assert.match(feedbackLogPath(stateRoot), /adaptation[\\/]feedback[\\/]records\.jsonl$/);
    assert.match(fbTombPathStore(stateRoot), /adaptation[\\/]feedback[\\/]tombstones\.json$/);
  });
});
