import assert from "node:assert/strict";
import { test } from "node:test";
import { createEpisodeId, createProjectId, createRunId } from "../../../src/domain/ids.js";
import {
  attachRun,
  closeEpisode,
  openEpisode,
  reduceEpisodeEvents,
  waitForUser,
  type EpisodeState,
} from "../../../src/episode/manager.js";
import type { EpisodeEvent } from "../../../src/episode/events.js";
import type { ProjectEpisode } from "../../../src/domain/episode.js";

test("attachRun rejects a run from another project", () => {
  const opened = openEpisode({
    id: createEpisodeId(),
    projectId: createProjectId(),
    objective: "ship",
    contractVersion: 1,
    acceptance: []
  });
  const foreign = createProjectId();
  assert.notEqual(opened.episode.projectId, foreign);
  assert.throws(
    () => attachRun(opened.episode, createRunId(), foreign),
    /another project|foreign/i
  );
});

test("attachRun accepts a run from the same project", () => {
  const opened = openEpisode({
    id: createEpisodeId(),
    projectId: createProjectId(),
    objective: "ship",
    contractVersion: 1,
    acceptance: []
  });
  const runId = createRunId();
  const next = attachRun(opened.episode, runId, opened.episode.projectId);
  assert.deepEqual(next.episode.runIds, [runId]);
});

// --- reducer fail-closed (M3-T1) ---

function seedEpisode(): { opened: { episode: ProjectEpisode; event: EpisodeEvent } } {
  const opened = openEpisode({
    id: createEpisodeId(),
    projectId: createProjectId(),
    objective: "ship",
    contractVersion: 1,
    acceptance: []
  });
  return { opened };
}

function reduceAll(...events: readonly EpisodeEvent[]): EpisodeState {
  return reduceEpisodeEvents(events);
}

test("a clean log reduces without fail-closed", () => {
  const { opened } = seedEpisode();
  const attached = attachRun(opened.episode, createRunId(), opened.episode.projectId);
  const closed = closeEpisode(attached.episode, "COMPLETED", "out-1");
  const state = reduceAll(opened.event, attached.event, closed.event);
  assert.equal(state.failClosed, false);
  assert.equal(state.failClosedReason, undefined);
  assert.equal(state.episode?.status, "COMPLETED");
});

test("a duplicate open fails closed and keeps the original state", () => {
  const first = seedEpisode();
  const second = seedEpisode();
  const state = reduceAll(first.opened.event, second.opened.event);
  assert.equal(state.failClosed, true);
  assert.match(state.failClosedReason ?? "", /duplicate/i);
  assert.equal(state.episode?.id, first.opened.episode.id);
});

test("a duplicate attach fails closed and leaves runIds unchanged", () => {
  const { opened } = seedEpisode();
  const runId = createRunId();
  const attached = attachRun(opened.episode, runId, opened.episode.projectId);
  const state = reduceAll(opened.event, attached.event, attached.event);
  assert.equal(state.failClosed, true);
  assert.match(state.failClosedReason ?? "", /duplicate/i);
  assert.deepEqual(state.episode?.runIds, [runId]);
});

test("a waiting event after a terminal status fails closed and keeps the terminal status", () => {
  const { opened } = seedEpisode();
  const closed = closeEpisode(opened.episode, "COMPLETED");
  const waiting = waitForUser(opened.episode, "need input", ["e1"]);
  const state = reduceAll(opened.event, closed.event, waiting.event);
  assert.equal(state.failClosed, true);
  assert.match(state.failClosedReason ?? "", /terminal/i);
  assert.equal(state.episode?.status, "COMPLETED");
});

test("a second close after a terminal status fails closed", () => {
  const { opened } = seedEpisode();
  const closed = closeEpisode(opened.episode, "COMPLETED");
  const reclosed = closeEpisode(opened.episode, "FAILED");
  const state = reduceAll(opened.event, closed.event, reclosed.event);
  assert.equal(state.failClosed, true);
  assert.equal(state.episode?.status, "COMPLETED");
});

test("an event referencing another episode fails closed as a dangling cross-stream ref", () => {
  const { opened } = seedEpisode();
  const foreign = createEpisodeId();
  assert.notEqual(foreign, opened.episode.id);
  const foreignAttach: EpisodeEvent = {
    type: "RUN_ATTACHED",
    episodeId: foreign,
    runId: createRunId(),
    attachedAt: opened.episode.startedAt
  };
  const state = reduceAll(opened.event, foreignAttach);
  assert.equal(state.failClosed, true);
  assert.match(state.failClosedReason ?? "", /another episode|cross-stream|dangling/i);
  assert.deepEqual(state.episode?.runIds, []);
});

test("fail-closed is sticky once the log is suspect", () => {
  const { opened } = seedEpisode();
  const attached = attachRun(opened.episode, createRunId(), opened.episode.projectId);
  const duplicate = attachRun(opened.episode, createRunId(), opened.episode.projectId);
  const duplicateEvent = { ...duplicate.event, runId: attached.event.runId } as EpisodeEvent;
  const closed = closeEpisode(attached.episode, "COMPLETED");
  const state = reduceAll(opened.event, attached.event, duplicateEvent, closed.event);
  assert.equal(state.failClosed, true);
  assert.equal(state.episode?.status, "COMPLETED");
});

test("multiple runs can attach to one episode", () => {
  const { opened } = seedEpisode();
  const runA = createRunId();
  const runB = createRunId();
  const attachA = attachRun(opened.episode, runA, opened.episode.projectId);
  const attachB = attachRun(attachA.episode, runB, opened.episode.projectId);
  assert.deepEqual(attachB.episode.runIds, [runA, runB]);
  const state = reduceAll(opened.event, attachA.event, attachB.event);
  assert.equal(state.failClosed, false);
  assert.deepEqual(state.episode?.runIds, [runA, runB]);
});
