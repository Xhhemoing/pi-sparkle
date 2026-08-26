import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ProjectEpisode } from "../../../src/domain/episode.js";
import {
  createEpisodeId,
  createEvidenceId,
  createProjectId,
  createRunId,
  type EpisodeId,
  type RunId
} from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { runtimeRoot } from "../../../src/privacy/state-layout.js";
import { EpisodeStore } from "../../../src/run/episode-store.js";
import { EventStore } from "../../../src/run/event-store.js";
import { listEpisodes, listRuns } from "../../../src/run/inventory.js";
import { makeEvent, makeRun } from "../../helpers/event-factory.js";

const RUN_A = createRunId(() => "aaaaaaaa-1111-2222-3333-444444444444");
const RUN_B = createRunId(() => "bbbbbbbb-1111-2222-3333-444444444444");
const EPISODE_A = createEpisodeId(() => "aaaaaaaa-5555-6666-7777-888888888888");
const EPISODE_B = createEpisodeId(() => "bbbbbbbb-5555-6666-7777-888888888888");

async function withStateRoot(body: (stateRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-inventory-"));
  try {
    await body(stateRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
}

function eventsPath(stateRoot: string, runId: RunId): string {
  return join(runtimeRoot(stateRoot), "runs", runId, "events.jsonl");
}

/** A completed run, optionally attached to an episode. */
async function seedCompletedRun(
  stateRoot: string,
  runId: RunId,
  episodeId?: EpisodeId
): Promise<void> {
  const store = new EventStore(stateRoot, runId);
  await store.append(
    makeEvent("RUN_CREATED", { run: makeRun() }, { runId, occurredAt: "2026-08-20T10:00:00.000Z" })
  );
  await store.append(makeEvent("RUN_STARTED", {}, { runId, occurredAt: "2026-08-20T10:01:00.000Z" }));
  if (episodeId !== undefined) {
    await store.append(
      makeEvent(
        "RUN_ATTACHED",
        { episodeId, runId, attachedAt: "2026-08-20T10:02:00.000Z" },
        { runId, occurredAt: "2026-08-20T10:02:00.000Z" }
      )
    );
  }
  await store.append(makeEvent("RUN_COMPLETED", {}, { runId, occurredAt: "2026-08-20T10:03:00.000Z" }));
}

/** A run that requested a pause and never cleared it: replays as PAUSED. */
async function seedPausedRun(stateRoot: string, runId: RunId): Promise<void> {
  const store = new EventStore(stateRoot, runId);
  await store.append(
    makeEvent("RUN_CREATED", { run: makeRun() }, { runId, occurredAt: "2026-08-21T09:00:00.000Z" })
  );
  await store.append(makeEvent("RUN_STARTED", {}, { runId, occurredAt: "2026-08-21T09:01:00.000Z" }));
  await store.append(
    makeEvent("PAUSE_REQUESTED", { reason: "operator" }, { runId, occurredAt: "2026-08-21T09:02:00.000Z" })
  );
}

function makeEpisode(id: EpisodeId, overrides: { status?: ProjectEpisode["status"]; closedAt?: string } = {}): ProjectEpisode {
  return {
    id,
    projectId: createProjectId(() => "cccccccc-1111-2222-3333-444444444444"),
    objective: "List the runtime inventory",
    contractVersion: 1,
    runIds: [RUN_A],
    startedAt: parseIsoTimestamp("2026-08-20T09:00:00.000Z"),
    closedAt: overrides.closedAt === undefined ? undefined : parseIsoTimestamp(overrides.closedAt),
    status: overrides.status ?? "OPEN",
    acceptance: [{ id: "acc-1", description: "Rows are listed", observableCheck: "pi-sparkle list" }],
    evidenceRefs: [createEvidenceId(() => "dddddddd-1111-2222-3333-444444444444")],
    outcomeId: undefined
  };
}

test("a state root with no runtime directory inventories nothing", async () => {
  await withStateRoot(async (stateRoot) => {
    assert.deepEqual(await listRuns(stateRoot), { runs: [], errors: [], warnings: [] });
    assert.deepEqual(await listEpisodes(stateRoot), { episodes: [], errors: [], warnings: [] });
  });
});

test("runs are listed by id with their replayed status and bound episode", async () => {
  await withStateRoot(async (stateRoot) => {
    // Seeded out of id order so the sort is load-bearing rather than incidental.
    await seedPausedRun(stateRoot, RUN_B);
    await seedCompletedRun(stateRoot, RUN_A, EPISODE_A);

    const inventory = await listRuns(stateRoot);
    assert.deepEqual(inventory.errors, []);
    assert.deepEqual(inventory.warnings, []);
    assert.deepEqual(inventory.runs, [
      {
        runId: RUN_A,
        status: "COMPLETED",
        lastEventAt: "2026-08-20T10:03:00.000Z",
        episodeId: EPISODE_A
      },
      {
        runId: RUN_B,
        status: "PAUSED",
        lastEventAt: "2026-08-21T09:02:00.000Z",
        episodeId: undefined
      }
    ]);
  });
});

test("non-run entries and empty logs are skipped, not reported as errors", async () => {
  await withStateRoot(async (stateRoot) => {
    await seedCompletedRun(stateRoot, RUN_A);
    const runsDir = join(runtimeRoot(stateRoot), "runs");
    await mkdir(join(runsDir, "scratch"), { recursive: true });
    await mkdir(join(runsDir, RUN_B), { recursive: true });
    await writeFile(join(runsDir, RUN_B, "events.jsonl"), "", "utf8");
    await writeFile(join(runsDir, `${RUN_B}.lock`), "{}", "utf8");

    const inventory = await listRuns(stateRoot);
    assert.deepEqual(inventory.errors, []);
    assert.deepEqual(inventory.warnings, []);
    assert.deepEqual(
      inventory.runs.map((run) => run.runId),
      [RUN_A]
    );
  });
});

test("a corrupt run log is reported and the readable runs are still listed", async () => {
  await withStateRoot(async (stateRoot) => {
    await seedCompletedRun(stateRoot, RUN_A);
    await seedPausedRun(stateRoot, RUN_B);
    // Corruption in the middle of the log: a bad *final* line is ordinary
    // crash-truncation recovery, so the bad line is followed by a good one.
    await appendFile(eventsPath(stateRoot, RUN_B), "NOT JSON\n", "utf8");
    await appendFile(
      eventsPath(stateRoot, RUN_B),
      `${JSON.stringify(makeEvent("RUN_COMPLETED", {}, { runId: RUN_B }))}\n`,
      "utf8"
    );

    const inventory = await listRuns(stateRoot);
    assert.deepEqual(
      inventory.runs.map((run) => run.runId),
      [RUN_A]
    );
    assert.equal(inventory.errors.length, 1);
    assert.equal(inventory.errors[0]?.path, eventsPath(stateRoot, RUN_B));
    assert.match(inventory.errors[0]?.message ?? "", /line 4/);
    assert.deepEqual(inventory.warnings, []);
  });
});

test("a crash-truncated run log is listed from the shortened log and disclosed", async () => {
  await withStateRoot(async (stateRoot) => {
    await seedCompletedRun(stateRoot, RUN_A);
    await seedPausedRun(stateRoot, RUN_B);
    // A killed writer leaves half a terminal event and no newline behind it.
    await appendFile(
      eventsPath(stateRoot, RUN_B),
      `${JSON.stringify(makeEvent("RUN_COMPLETED", {}, { runId: RUN_B })).slice(0, 40)}`,
      "utf8"
    );

    const inventory = await listRuns(stateRoot);
    assert.deepEqual(inventory.errors, []);
    // The row survives, replayed from the three events that did land.
    assert.deepEqual(inventory.runs, [
      {
        runId: RUN_A,
        status: "COMPLETED",
        lastEventAt: "2026-08-20T10:03:00.000Z",
        episodeId: undefined
      },
      {
        runId: RUN_B,
        status: "PAUSED",
        lastEventAt: "2026-08-21T09:02:00.000Z",
        episodeId: undefined
      }
    ]);
    assert.deepEqual(inventory.warnings, [
      {
        path: eventsPath(stateRoot, RUN_B),
        message:
          "ignored truncated event log at line 4; status and lastEventAt are replayed from the shortened log"
      }
    ]);
  });
});

test("episodes are listed at their latest snapshot, ignoring event logs and locks", async () => {
  await withStateRoot(async (stateRoot) => {
    const store = new EpisodeStore(stateRoot, EPISODE_A);
    await store.append(makeEpisode(EPISODE_A));
    await store.append(makeEpisode(EPISODE_A, { status: "COMPLETED", closedAt: "2026-08-20T11:00:00.000Z" }));
    await new EpisodeStore(stateRoot, EPISODE_B).append(makeEpisode(EPISODE_B));
    const episodesDir = join(runtimeRoot(stateRoot), "episodes");
    // Both would decode as garbage if the name filter let them through.
    await writeFile(join(episodesDir, `${EPISODE_A}.events.jsonl`), "NOT AN EPISODE\n", "utf8");
    await writeFile(join(episodesDir, `${EPISODE_A}.lock`), "{}", "utf8");

    const inventory = await listEpisodes(stateRoot);
    assert.deepEqual(inventory.errors, []);
    assert.deepEqual(inventory.warnings, []);
    assert.deepEqual(inventory.episodes, [
      { episodeId: EPISODE_A, status: "COMPLETED", lastEventAt: "2026-08-20T11:00:00.000Z" },
      { episodeId: EPISODE_B, status: "OPEN", lastEventAt: "2026-08-20T09:00:00.000Z" }
    ]);
  });
});

test("an unreadable episode snapshot log is reported and the others are still listed", async () => {
  await withStateRoot(async (stateRoot) => {
    await new EpisodeStore(stateRoot, EPISODE_B).append(makeEpisode(EPISODE_B));
    const episodesDir = join(runtimeRoot(stateRoot), "episodes");
    await writeFile(
      join(episodesDir, `${EPISODE_A}.jsonl`),
      `${JSON.stringify({ id: EPISODE_A, status: "OPEN" })}\n`,
      "utf8"
    );

    const inventory = await listEpisodes(stateRoot);
    assert.deepEqual(
      inventory.episodes.map((episode) => episode.episodeId),
      [EPISODE_B]
    );
    assert.equal(inventory.errors.length, 1);
    assert.equal(inventory.errors[0]?.path, join(episodesDir, `${EPISODE_A}.jsonl`));
    assert.deepEqual(inventory.warnings, []);
  });
});

test("a crash-truncated episode log is listed at its last whole snapshot and disclosed", async () => {
  await withStateRoot(async (stateRoot) => {
    await new EpisodeStore(stateRoot, EPISODE_A).append(makeEpisode(EPISODE_A));
    const episodesDir = join(runtimeRoot(stateRoot), "episodes");
    const path = join(episodesDir, `${EPISODE_A}.jsonl`);
    await appendFile(
      path,
      `${JSON.stringify(makeEpisode(EPISODE_A, { status: "COMPLETED", closedAt: "2026-08-20T11:00:00.000Z" })).slice(0, 30)}`,
      "utf8"
    );

    const inventory = await listEpisodes(stateRoot);
    assert.deepEqual(inventory.errors, []);
    // The dropped snapshot is the closing one: the row still reads OPEN.
    assert.deepEqual(inventory.episodes, [
      { episodeId: EPISODE_A, status: "OPEN", lastEventAt: "2026-08-20T09:00:00.000Z" }
    ]);
    assert.deepEqual(inventory.warnings, [
      {
        path,
        message:
          "ignored truncated episode log at line 2; status and lastEventAt are replayed from the shortened log"
      }
    ]);
  });
});
