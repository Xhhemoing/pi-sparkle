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
import { DomainValidationError } from "../../../src/domain/errors.js";
import { LOCK_TIMEOUT_CODE, withExclusiveFileLock } from "../../../src/persist/file-lock.js";
import { episodeLockPath } from "../../../src/run/episode-bind.js";
import { feedbackTombstonesPath as fbTombPathStore } from "../../../src/feedback/store.js";
import { EventStore, runLockPath } from "../../../src/run/event-store.js";
import type { Event } from "../../../src/run/events.js";
import { createEventId, createTaskId } from "../../../src/domain/ids.js";
import { validateConfidenceScore } from "../../../src/domain/flowchart.js";
import { startFlowchartRun } from "../../../src/run/flowchart-run.js";
import { createModelRouter } from "../../../src/supervisor/model-router.js";

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
 * The run lifecycle takes the run lock, but a bare `EventStore` driven from
 * outside any lifecycle does not, so the second half of this test is the
 * operator-visible consequence that remains: an appender that outlives the
 * delete recreates the run directory on its next append, and the remedy is to
 * stop it and delete again.
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

/**
 * The same wait, driven by a real run rather than a hand-held lock: the run
 * lifecycle holds the run lock (`withRunLifecycleLock`), so `delete --run`
 * issued while the run is live blocks at the lock and then removes the records
 * once the run has settled. What the operator no longer sees is the old
 * outcome — a delete that removed part of a live run's subtree and then
 * refused with `RUN_RECORDS_SURVIVED`.
 */
test("delete --run issued against a live run waits for the run, then removes it", async () => {
  await withStateRoot(async (stateRoot) => {
    const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-delete-proj-"));
    try {
      const io = capture();
      let pending: Promise<number> | undefined;
      let runDir: string | undefined;
      let probed = false;

      const outcome = await startFlowchartRun(
        {
          stateRoot,
          router: createModelRouter({
            policyVersion: "router-v1",
            models: [
              {
                id: "cheap",
                version: "cheap-v1",
                roles: ["actor", "critic"],
                maxComplexity: "MEDIUM",
                estimatedCostUsd: 0.1,
                estimatedDurationMs: 1_000
              }
            ]
          }),
          now: () => parseIsoTimestamp("2026-08-24T09:00:00.000Z"),
          generateId: UUID,
          pause: {
            async requestPause() {
              return { paused: false };
            },
            async clearPause() {},
            async token(runId: RunId) {
              if (!probed) {
                probed = true;
                runDir = join(stateRoot, "runtime", "runs", runId);
                pending = deleteCommand(["--run", runId, "--state-root", stateRoot], io.io);
                await new Promise((resolve) => setTimeout(resolve, 80));
                assert.equal(existsSync(runDir), true, "a live run's records are not removed under it");
              }
              return { paused: false };
            }
          }
        },
        {
          projectRoot,
          flowchart: {
            id: "delete-live-run",
            nodes: [
              {
                id: "only",
                taskId: createTaskId(() => "only"),
                role: "actor",
                objective: "Do only",
                modelPolicy: { allowedModels: ["cheap"] },
                confidenceThreshold: validateConfidenceScore(0.7),
                approvalRequired: false
              }
            ],
            edges: []
          },
          childResults: {
            only: { outcome: "SUCCESS", confidence: validateConfidenceScore(0.9), evidenceIds: ["evd_only"] }
          }
        }
      );

      assert.equal(outcome.status, "COMPLETED", "the delete did not damage the run it raced");
      assert.ok(pending !== undefined && runDir !== undefined);
      assert.equal(await pending, 0, io.err.join(""));
      assert.match(io.out.join(""), new RegExp(`removed: .*${outcome.runId}`));
      assert.equal(existsSync(runDir), false);
      await verifyRunRecordsRemoved(stateRoot, outcome.runId);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});

/**
 * `--lock-wait-ms` is the operator's answer to the wait above: a delete aimed
 * at a live run waits for the run to finish, and until this flag the bound was
 * `withExclusiveFileLock`'s fixed 5s with no way to say "I would rather wait".
 *
 * Three properties, and the first is the one that matters most: an unflagged
 * delete is byte-identical to the delete that shipped before the flag existed.
 */
test("--lock-wait-ms bounds the delete's wait; omitting it changes nothing", async () => {
  await withStateRoot(async (stateRoot) => {
    const runId = createRunId(UUID);
    const runDir = join(stateRoot, "runtime", "runs", runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, "events.jsonl"), "{}\n", "utf8");

    // An uncontended delete takes the same path with and without the flag, and
    // says the same thing: the flag bounds a wait, it does not change output.
    const flagged = capture();
    assert.equal(
      await deleteCommand(
        ["--run", runId, "--lock-wait-ms", "60000", "--state-root", stateRoot],
        flagged.io
      ),
      0,
      flagged.err.join("")
    );
    assert.deepEqual(flagged.out, [`removed: ${runDir}\n`]);
    assert.deepEqual(flagged.err, []);

    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, "events.jsonl"), "{}\n", "utf8");
    const bare = capture();
    assert.equal(
      await deleteCommand(["--run", runId, "--state-root", stateRoot], bare.io),
      0,
      bare.err.join("")
    );
    assert.deepEqual(bare.out, flagged.out, "the flag is not an output change");
    assert.deepEqual(bare.err, flagged.err);
  });
});

/**
 * The short end of the range: `--lock-wait-ms 0` refuses a held lock at once
 * instead of waiting out a default the operator did not choose. This is the
 * offline witness that the flag reaches `withExclusiveFileLock` at all — the
 * pre-flag command could only produce this refusal by paying 5s of wall time
 * (see `command-error-doctor.test.ts`, which still pays it on purpose to
 * witness the default).
 */
test("--lock-wait-ms 0 refuses a held lock immediately, leaving the run's records", async () => {
  await withStateRoot(async (stateRoot) => {
    const runId = createRunId(UUID);
    const runDir = join(stateRoot, "runtime", "runs", runId);
    await new EventStore(stateRoot, runId).append(
      runEvent(runId, "AGENT_EVENT", {
        agentInstanceId: "agt_00000000-0000-4000-8000-00000000000c",
        kind: "TEXT_DELTA",
        summary: "work the delete must not destroy"
      })
    );

    const io = capture();
    let refusal: unknown;
    let elapsedMs = 0;
    await withExclusiveFileLock(runLockPath(stateRoot, runId), async () => {
      const startedAt = Date.now();
      refusal = await deleteCommand(
        ["--run", runId, "--lock-wait-ms", "0", "--state-root", stateRoot],
        io.io
      ).then(
        () => assert.fail("a held lock with a zero wait must refuse"),
        (error: unknown) => error
      );
      elapsedMs = Date.now() - startedAt;
    });

    assert.equal((refusal as { code?: unknown }).code, LOCK_TIMEOUT_CODE);
    // Well inside the 5s default: the bound came from the flag, not the lock.
    assert.ok(elapsedMs < 2_000, `the zero wait must not sit on the default: ${elapsedMs}ms`);
    // Fail-closed, exactly as the default-bounded refusal is.
    assert.equal(existsSync(runDir), true, "a refused delete leaves the run's records");
    assert.deepEqual(io.out, []);
    // This fixture has no invocation rows, so the refusal really did change
    // nothing and there is nothing to disclose. The case below is the other
    // one, where there is.
    assert.deepEqual(io.err, []);
  });
});

/**
 * The refusal an operator actually meets on a state root with telemetry in it.
 *
 * The delete's first half — the invocation-log rewrite and the derived
 * snapshot's invalidation — runs before any lock is requested and is not
 * rolled back when the run lock then refuses. The success path reports those
 * rows through `removedPaths`; the failure path throws that result away, so
 * without this line the operator is told only that the delete failed, while
 * their telemetry plane has already changed. USAGE promises this line.
 */
test("a delete refused at the run lock still discloses the rows it already dropped", async () => {
  await withStateRoot(async (stateRoot) => {
    const doomed = createRunId(UUID);
    const keeper = createRunId(UUID);
    const runDir = join(stateRoot, "runtime", "runs", doomed);
    await new EventStore(stateRoot, doomed).append(
      runEvent(doomed, "AGENT_EVENT", {
        agentInstanceId: "agt_00000000-0000-4000-8000-00000000000d",
        kind: "TEXT_DELTA",
        summary: "work the refusal keeps"
      })
    );
    const logPath = invocationsLogPath(stateRoot);
    await writeFile(
      logPath,
      [invocationLine(doomed, "inv_doomed"), invocationLine(keeper, "inv_keeper")].join(""),
      "utf8"
    );

    const io = capture();
    let refusal: unknown;
    await withExclusiveFileLock(runLockPath(stateRoot, doomed), async () => {
      refusal = await deleteCommand(
        ["--run", doomed, "--lock-wait-ms", "0", "--state-root", stateRoot],
        io.io
      ).then(
        () => assert.fail("a held run lock with a zero wait must refuse"),
        (error: unknown) => error
      );
    });

    assert.equal((refusal as { code?: unknown }).code, LOCK_TIMEOUT_CODE);
    assert.equal(existsSync(runDir), true, "the lock-guarded half is what was refused");
    const rewritten = await readFile(logPath, "utf8");
    assert.doesNotMatch(rewritten, new RegExp(doomed), "the pre-lock half is not rolled back");
    assert.match(rewritten, new RegExp(keeper));

    assert.deepEqual(io.out, [], "a failed delete reports no removals on stdout");
    assert.equal(io.err.length, 1, `one disclosure line, got: ${JSON.stringify(io.err)}`);
    const line = io.err[0] ?? "";
    assert.match(line, /1 invocation row\(s\) were dropped/);
    assert.ok(line.includes(logPath), "the line must name the log");
    assert.ok(line.endsWith("\n") && line.indexOf("\n") === line.length - 1, "exactly one line");
  });
});

test("--lock-wait-ms refuses a value it cannot honour exactly", async () => {
  await withStateRoot(async (stateRoot) => {
    const runId = createRunId(UUID);
    await mkdir(join(stateRoot, "runtime", "runs", runId), { recursive: true });

    // Spellings Number() would silently accept as something else, plus the
    // typo the ceiling exists for. `-1` goes through the `=` form because
    // parseArgs refuses a dash-led value before this validator ever sees it.
    for (const flag of [
      "--lock-wait-ms=",
      "--lock-wait-ms= ",
      "--lock-wait-ms=-1",
      "--lock-wait-ms=1.5",
      "--lock-wait-ms=1e4",
      "--lock-wait-ms=0x10",
      "--lock-wait-ms= 5 ",
      "--lock-wait-ms=abc",
      "--lock-wait-ms=8640000001"
    ]) {
      const io = capture();
      await assert.rejects(
        deleteCommand(["--run", runId, flag, "--state-root", stateRoot], io.io),
        (error: unknown) => {
          assert.ok(error instanceof DomainValidationError);
          assert.match(error.message, /^--lock-wait-ms must be a whole number of milliseconds/);
          return true;
        },
        `${flag} must be refused`
      );
      assert.deepEqual(io.out, [], "a refused flag deletes nothing and says nothing");
    }
    // The refusal is a parse failure, so the records are still there.
    assert.equal(existsSync(join(stateRoot, "runtime", "runs", runId)), true);
    // The ceiling itself is honoured, not merely asserted about.
    const io = capture();
    assert.equal(
      await deleteCommand(
        ["--run", runId, "--lock-wait-ms", "86400000", "--state-root", stateRoot],
        io.io
      ),
      0,
      io.err.join("")
    );
  });
});

/**
 * The wait is the target's, not the run plane's: `delete --episode` takes the
 * episode's cooperative lock (and the feedback log's) through the same options
 * object, so one flag covers both targets rather than only the one R5-1's
 * disclosure named.
 */
test("--lock-wait-ms bounds delete --episode too", async () => {
  await withStateRoot(async (stateRoot) => {
    const seed = await seedEpisodeWithFeedback(stateRoot);
    const io = capture();
    let refusal: unknown;
    await withExclusiveFileLock(episodeLockPath(stateRoot, seed.episodeId), async () => {
      refusal = await deleteCommand(
        ["--episode", seed.episodeId, "--lock-wait-ms", "0", "--state-root", stateRoot],
        io.io
      ).then(
        () => assert.fail("a held episode lock with a zero wait must refuse"),
        (error: unknown) => error
      );
    });
    assert.equal((refusal as { code?: unknown }).code, LOCK_TIMEOUT_CODE);
    assert.equal(
      existsSync(join(stateRoot, "runtime", "episodes", `${seed.episodeId}.jsonl`)),
      true,
      "the episode records survive the refusal"
    );
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
