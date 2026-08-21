import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createEventId, createProjectId, createRunId } from "../../../src/domain/ids.js";
import { nowIso } from "../../../src/domain/timestamp.js";
import {
  bindEpisodeToRun,
  contractFromObjective,
  episodeIdFromEvents,
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
