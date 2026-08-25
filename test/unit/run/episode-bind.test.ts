import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { createEpisodeId, createEventId, createProjectId, createRunId } from "../../../src/domain/ids.js";
import { nowIso } from "../../../src/domain/timestamp.js";
import { closeEpisode } from "../../../src/episode/manager.js";
import { EpisodeEventStore } from "../../../src/episode/store.js";
import { withExclusiveFileLock } from "../../../src/persist/file-lock.js";
import {
  bindEpisodeToRun,
  contractFromObjective,
  episodeIdFromEvents,
  episodeLockPath,
  settleBoundEpisode
} from "../../../src/run/episode-bind.js";
import { EpisodeStore } from "../../../src/run/episode-store.js";
import type { Event } from "../../../src/run/events.js";

test("contractFromObjective marks skip-contract when synthesized", () => {
  const skipped = contractFromObjective("do x", true);
  assert.ok(skipped.assumptions.some((assumption) => assumption.id === "skip-contract"));
  assert.equal(skipped.acceptanceCriteria[0]?.id, "run-complete");
});

test("contractFromObjective omits skip-contract when the caller supplied one", () => {
  const supplied = contractFromObjective("do x", false);
  assert.equal(supplied.assumptions.length, 0);
  assert.equal(supplied.sourceRefs[0]?.ref, "cli-objective");
});

function make(runId: ReturnType<typeof createRunId>, type: Event["type"], payload: unknown): Event {
  return {
    id: createEventId(),
    schemaVersion: 1,
    occurredAt: nowIso(),
    runId,
    type,
    actor: "test",
    payload
  } as Event;
}

async function withState(run: (stateRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-episode-bind-"));
  try {
    await run(stateRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
}

test("settleBoundEpisode keeps a completed run waiting when custom acceptance evidence is missing", async () => {
  await withState(async (stateRoot) => {
    const runId = createRunId();
    const events: Event[] = [];
    const bound = await bindEpisodeToRun({
      stateRoot,
      runId,
      projectId: createProjectId(),
      objective: "custom acceptance",
      contract: {
        ...contractFromObjective("custom acceptance", false),
        acceptanceCriteria: [{ id: "security-review", description: "review", observableCheck: "review" }]
      },
      append: async (event) => {
        events.push(event);
      },
      make: (type, payload) => make(runId, type, payload)
    });

    await settleBoundEpisode({
      stateRoot,
      events,
      status: "COMPLETED",
      append: async (event) => {
        events.push(event);
      },
      make: (type, payload) => make(runId, type, payload)
    });

    assert.equal(events.at(-1)?.type, "EPISODE_WAITING");
    assert.equal(
      (await new EpisodeStore(stateRoot, bound.episodeId).readAll()).episodes.at(-1)?.status,
      "WAITING_FOR_USER"
    );
  });
});

test("settleBoundEpisode closes a completed run and is idempotent", async () => {
  await withState(async (stateRoot) => {
    const runId = createRunId();
    const events: Event[] = [];
    const append = async (event: Event) => {
      events.push(event);
    };
    const bound = await bindEpisodeToRun({
      stateRoot,
      runId,
      projectId: createProjectId(),
      objective: "do x",
      append,
      make: (type, payload) => make(runId, type, payload)
    });
    assert.equal(episodeIdFromEvents(events), bound.episodeId);

    await settleBoundEpisode({
      stateRoot,
      events,
      status: "COMPLETED",
      append,
      make: (type, payload) => make(runId, type, payload)
    });
    assert.equal(events.at(-1)?.type, "EPISODE_CLOSED");
    const closedCount = events.filter((event) => event.type === "EPISODE_CLOSED").length;
    const snapshot = (await new EpisodeStore(stateRoot, bound.episodeId).readAll()).episodes.at(-1);
    assert.equal(snapshot?.status, "COMPLETED");

    await settleBoundEpisode({
      stateRoot,
      events,
      status: "COMPLETED",
      append,
      make: (type, payload) => make(runId, type, payload)
    });
    assert.equal(events.filter((event) => event.type === "EPISODE_CLOSED").length, closedCount);
  });
});

test("settleBoundEpisode waits instead of closing, then closes on completion", async () => {
  await withState(async (stateRoot) => {
    const runId = createRunId();
    const events: Event[] = [];
    const append = async (event: Event) => {
      events.push(event);
    };
    const bound = await bindEpisodeToRun({
      stateRoot,
      runId,
      projectId: createProjectId(),
      objective: "wait then finish",
      append,
      make: (type, payload) => make(runId, type, payload)
    });

    await settleBoundEpisode({
      stateRoot,
      events,
      status: "WAITING_FOR_USER",
      append,
      make: (type, payload) => make(runId, type, payload)
    });
    assert.equal(events.at(-1)?.type, "EPISODE_WAITING");
    assert.equal(
      (await new EpisodeStore(stateRoot, bound.episodeId).readAll()).episodes.at(-1)?.status,
      "WAITING_FOR_USER"
    );

    await settleBoundEpisode({
      stateRoot,
      events,
      status: "WAITING_FOR_USER",
      append,
      make: (type, payload) => make(runId, type, payload)
    });
    assert.equal(events.filter((event) => event.type === "EPISODE_WAITING").length, 1);

    await settleBoundEpisode({
      stateRoot,
      events,
      status: "COMPLETED",
      append,
      make: (type, payload) => make(runId, type, payload)
    });
    assert.equal(events.at(-1)?.type, "EPISODE_CLOSED");
    assert.equal(
      (await new EpisodeStore(stateRoot, bound.episodeId).readAll()).episodes.at(-1)?.status,
      "COMPLETED"
    );
  });
});

test("settleBoundEpisode maps FAILED and is a no-op without RUN_ATTACHED", async () => {
  await withState(async (stateRoot) => {
    const runId = createRunId();
    const events: Event[] = [];
    const append = async (event: Event) => {
      events.push(event);
    };
    const bound = await bindEpisodeToRun({
      stateRoot,
      runId,
      projectId: createProjectId(),
      objective: "fail",
      append,
      make: (type, payload) => make(runId, type, payload)
    });
    await settleBoundEpisode({
      stateRoot,
      events,
      status: "FAILED",
      append,
      make: (type, payload) => make(runId, type, payload)
    });
    assert.equal(
      (await new EpisodeStore(stateRoot, bound.episodeId).readAll()).episodes.at(-1)?.status,
      "FAILED"
    );

    const orphan: Event[] = [];
    await settleBoundEpisode({
      stateRoot,
      events: orphan,
      status: "COMPLETED",
      append: async (event) => {
        orphan.push(event);
      },
      make: (type, payload) => make(runId, type, payload)
    });
    assert.deepEqual(orphan, []);
  });
});

test("the settle lock is the same file `episode close` takes", async () => {
  const episodeId = createEpisodeId();
  assert.equal(
    episodeLockPath("/state", episodeId),
    join("/state", "runtime", "episodes", `${episodeId}.lock`)
  );
  const cli = await readFile(new URL("../../../src/cli/episode.ts", import.meta.url), "utf8");
  assert.match(cli, /join\(runtimeRoot\(stateRoot\), "episodes", `\$\{episodeId\}\.lock`\)/);
});

test("settleBoundEpisode fails closed when another writer holds the episode lock", async () => {
  await withState(async (stateRoot) => {
    const runId = createRunId();
    const events: Event[] = [];
    const append = async (event: Event) => {
      events.push(event);
    };
    const bound = await bindEpisodeToRun({
      stateRoot,
      runId,
      projectId: createProjectId(),
      objective: "contended settle",
      append,
      make: (type, payload) => make(runId, type, payload)
    });
    const snapshots = new EpisodeStore(stateRoot, bound.episodeId);
    const episodeEvents = new EpisodeEventStore(stateRoot, bound.episodeId);
    const snapshotsBefore = (await snapshots.readAll()).episodes.length;
    const episodeEventsBefore = (await episodeEvents.readAll()).events.length;
    const runEventsBefore = events.length;

    let release = (): void => {};
    let acquired = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const isAcquired = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const holder = withExclusiveFileLock(episodeLockPath(stateRoot, bound.episodeId), async () => {
      acquired();
      await held;
    });
    await isAcquired;

    await assert.rejects(
      settleBoundEpisode({
        stateRoot,
        events,
        status: "COMPLETED",
        append,
        make: (type, payload) => make(runId, type, payload),
        lockOptions: { timeoutMs: 40, retryMs: 5 }
      }),
      (error: unknown) =>
        error instanceof DomainValidationError && /timed out waiting for lock/.test(error.message)
    );

    release();
    await holder;
    assert.equal(events.length, runEventsBefore);
    assert.equal((await snapshots.readAll()).episodes.length, snapshotsBefore);
    assert.equal((await episodeEvents.readAll()).events.length, episodeEventsBefore);
  });
});

test("settleBoundEpisode re-reads under the lock and never appends a second terminal", async () => {
  await withState(async (stateRoot) => {
    const runId = createRunId();
    const events: Event[] = [];
    const append = async (event: Event) => {
      events.push(event);
    };
    const bound = await bindEpisodeToRun({
      stateRoot,
      runId,
      projectId: createProjectId(),
      objective: "operator closes first",
      append,
      make: (type, payload) => make(runId, type, payload)
    });
    const snapshots = new EpisodeStore(stateRoot, bound.episodeId);
    const episodeEvents = new EpisodeEventStore(stateRoot, bound.episodeId);

    let release = (): void => {};
    let acquired = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const isAcquired = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    // Stands in for `episode close`: it owns the lock and lands a terminal
    // snapshot while the run is still waiting to settle.
    const holder = withExclusiveFileLock(episodeLockPath(stateRoot, bound.episodeId), async () => {
      const latest = (await snapshots.readAll()).episodes.at(-1);
      if (latest === undefined) throw new Error("expected a bound episode");
      const closed = closeEpisode(latest, "ABANDONED", "operator");
      await snapshots.append(closed.episode);
      await episodeEvents.append(closed.event);
      acquired();
      await held;
    });
    await isAcquired;

    let settled = false;
    const settling = settleBoundEpisode({
      stateRoot,
      events,
      status: "COMPLETED",
      append,
      make: (type, payload) => make(runId, type, payload),
      lockOptions: { timeoutMs: 5_000, retryMs: 5 }
    }).then(() => {
      settled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false, "settle must block on the lock the operator holds");

    release();
    await holder;
    await settling;

    assert.equal(events.filter((event) => event.type === "EPISODE_CLOSED").length, 0);
    const terminal = (await snapshots.readAll()).episodes.filter((episode) =>
      ["COMPLETED", "FAILED", "ABANDONED"].includes(episode.status)
    );
    assert.equal(terminal.length, 1);
    assert.equal(terminal[0]?.status, "ABANDONED");
    const closedEvents = (await episodeEvents.readAll()).events.filter(
      (event) => event.type === "EPISODE_CLOSED"
    );
    assert.equal(closedEvents.length, 1);
  });
});

test("settleBoundEpisode leaves no lock file behind after a clean settle", async () => {
  await withState(async (stateRoot) => {
    const runId = createRunId();
    const events: Event[] = [];
    const append = async (event: Event) => {
      events.push(event);
    };
    const bound = await bindEpisodeToRun({
      stateRoot,
      runId,
      projectId: createProjectId(),
      objective: "clean settle",
      append,
      make: (type, payload) => make(runId, type, payload)
    });
    await settleBoundEpisode({
      stateRoot,
      events,
      status: "FAILED",
      append,
      make: (type, payload) => make(runId, type, payload)
    });
    await assert.rejects(
      readFile(episodeLockPath(stateRoot, bound.episodeId), "utf8"),
      (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT"
    );
  });
});
