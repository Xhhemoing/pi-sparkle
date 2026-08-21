import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createEpisodeId,
  createProjectId,
  createRunId
} from "../../../src/domain/ids.js";
import {
  attachRun,
  closeEpisode,
  openEpisode,
  reduceEpisodeEvents
} from "../../../src/episode/manager.js";
import { EpisodeEventStore } from "../../../src/episode/store.js";

test("a multi-run episode round-trips through the event store and reduces clean", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-episode-reducer-"));
  try {
    const episodeId = createEpisodeId();
    const store = new EpisodeEventStore(stateRoot, episodeId);
    const opened = openEpisode({
      id: episodeId,
      projectId: createProjectId(),
      objective: "multi-run episode integration",
      contractVersion: 1,
      acceptance: [{ id: "acc-1", description: "two runs attach", observableCheck: "runIds length" }]
    });
    const runA = createRunId();
    const runB = createRunId();
    const attachA = attachRun(opened.episode, runA, opened.episode.projectId);
    const attachB = attachRun(attachA.episode, runB, opened.episode.projectId);
    const closed = closeEpisode(attachB.episode, "COMPLETED", "out-1");

    for (const event of [opened.event, attachA.event, attachB.event, closed.event]) {
      await store.append(event);
    }

    const read = await store.readAll();
    assert.equal(read.recovery.incompleteLine, undefined);
    const state = reduceEpisodeEvents(read.events);
    assert.equal(state.failClosed, false);
    assert.equal(state.episode?.status, "COMPLETED");
    assert.deepEqual(state.episode?.runIds, [runA, runB]);
    assert.deepEqual(state.episode?.acceptance, opened.episode.acceptance);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("a duplicated attach persisted in the log fails closed on replay", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-episode-reducer-"));
  try {
    const episodeId = createEpisodeId();
    const store = new EpisodeEventStore(stateRoot, episodeId);
    const opened = openEpisode({
      id: episodeId,
      projectId: createProjectId(),
      objective: "duplicate attach integration",
      contractVersion: 1,
      acceptance: []
    });
    const runId = createRunId();
    const attached = attachRun(opened.episode, runId, opened.episode.projectId);
    await store.append(opened.event);
    await store.append(attached.event);
    await store.append(attached.event); // corrupted writer wrote the same attach twice

    const read = await store.readAll();
    const state = reduceEpisodeEvents(read.events);
    assert.equal(state.failClosed, true);
    assert.match(state.failClosedReason ?? "", /duplicate/i);
    assert.deepEqual(state.episode?.runIds, [runId]);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});
