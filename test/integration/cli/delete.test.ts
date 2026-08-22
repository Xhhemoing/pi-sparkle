import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deleteCommand } from "../../../src/cli/main.js";
import type { CliIo } from "../../../src/cli/main.js";
import { appendFeedback, feedbackLogPath, readFeedbackRecordsRaw } from "../../../src/feedback/store.js";
import { EpisodeStore } from "../../../src/run/episode-store.js";
import { EpisodeEventStore } from "../../../src/episode/store.js";
import {
  createEpisodeId,
  createProjectId,
  createRunId,
  type EpisodeId
} from "../../../src/domain/ids.js";
import type { ProjectEpisode } from "../../../src/domain/episode.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { deleteRunRecords } from "../../../src/privacy/deletion.js";
import { feedbackTombstonesPath as fbTombPathStore } from "../../../src/feedback/store.js";

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
  // Feedback bound to this episode (with user-text body) and one for another episode.
  await appendFeedback(stateRoot, {
    id: "fb-own",
    episodeId,
    kind: "human",
    rubricVersion: "1",
    score: 80,
    evidenceRefs: [],
    redacted: false,
    createdAt: parseIsoTimestamp("2026-08-22T00:00:00.000Z"),
    body: "user said something sensitive here"
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
    body: "unrelated feedback stays intact"
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

    // The bound feedback is tombstoned and its free-text body is stripped.
    const tombstones = JSON.parse(await readFile(fbTombPathStore(stateRoot), "utf8"));
    assert.ok((tombstones as string[]).includes("fb-own"));
    const records = await readFeedbackRecordsRaw(stateRoot);
    const own = records.find((r) => r.id === "fb-own");
    assert.ok(own);
    assert.equal(own.body, undefined, "body must be stripped");
    // Unrelated feedback keeps its payload and is not tombstoned.
    const other = records.find((r) => r.id === "fb-other");
    assert.ok(other);
    assert.equal(other.body, "unrelated feedback stays intact");
    assert.ok(!(tombstones as string[]).includes("fb-other"));
    assert.match(io.out.join(""), /tombstoned feedback: fb-own/);
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
