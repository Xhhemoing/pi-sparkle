import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { createEpisodeId, createProjectId, createRunId, type EpisodeId } from "../../../src/domain/ids.js";
import { attachRun, closeEpisode, openEpisode, waitForUser } from "../../../src/episode/manager.js";
import type { EpisodeEvent } from "../../../src/episode/events.js";
import { EpisodeEventStore } from "../../../src/episode/store.js";

function logPath(stateRoot: string, episodeId: EpisodeId): string {
  return join(stateRoot, "runtime", "episodes", `${episodeId}.events.jsonl`);
}

function fixtures(episodeId: EpisodeId): readonly EpisodeEvent[] {
  const opened = openEpisode({
    id: episodeId,
    projectId: createProjectId(),
    objective: "episode event store",
    contractVersion: 1,
    acceptance: [{ id: "acc-1", description: "events validate", observableCheck: "pnpm test" }]
  });
  const attached = attachRun(opened.episode, createRunId(), opened.episode.projectId);
  const waiting = waitForUser(attached.episode, "acceptance-incomplete", ["acc-1"]);
  const closed = closeEpisode(waiting.episode, "COMPLETED", "out-1");
  return [opened.event, attached.event, waiting.event, closed.event];
}

async function withStore(
  run: (store: EpisodeEventStore, stateRoot: string, episodeId: EpisodeId) => Promise<void>
): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-episode-events-"));
  try {
    const episodeId = createEpisodeId();
    await run(new EpisodeEventStore(stateRoot, episodeId), stateRoot, episodeId);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
}

test("a valid episode event log round-trips identically", async () => {
  await withStore(async (store, stateRoot, episodeId) => {
    const events = fixtures(episodeId);
    for (const event of events) await store.append(event);

    const read = await store.readAll();
    assert.deepEqual(read.recovery, {});
    assert.equal(read.events.length, events.length);
    assert.deepEqual(
      read.events.map((event) => JSON.stringify(event)),
      events.map((event) => JSON.stringify(event))
    );
    const raw = await readFile(logPath(stateRoot, episodeId), "utf8");
    assert.equal(raw, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
  });
});

test("reading a missing episode event log yields no events", async () => {
  await withStore(async (store) => {
    const read = await store.readAll();
    assert.deepEqual(read.events, []);
    assert.deepEqual(read.recovery, {});
  });
});

test("an unknown-type row fails readAll closed and names the line", async () => {
  await withStore(async (store, stateRoot, episodeId) => {
    const [opened] = fixtures(episodeId);
    if (opened === undefined) throw new Error("expected a fixture");
    await store.append(opened);
    await appendFile(
      logPath(stateRoot, episodeId),
      `${JSON.stringify({ type: "EPISODE_REOPENED", episodeId, occurredAt: "2026-08-24T00:00:00.000Z" })}\n`
    );

    await assert.rejects(
      () => store.readAll(),
      (error: unknown) =>
        error instanceof DomainValidationError &&
        /line 2/.test(error.message) &&
        /Unknown EpisodeEvent\.type: EPISODE_REOPENED/.test(error.message)
    );
  });
});

test("a malformed required field fails readAll closed instead of being cast", async () => {
  await withStore(async (store, stateRoot, episodeId) => {
    const events = fixtures(episodeId);
    const [opened, attached] = events;
    if (opened === undefined || attached === undefined) throw new Error("expected fixtures");
    await store.append(opened);
    await appendFile(
      logPath(stateRoot, episodeId),
      `${JSON.stringify({ ...attached, runId: "not-a-run-id" })}\n`
    );
    await store.append(events[3] as EpisodeEvent);

    await assert.rejects(
      () => store.readAll(),
      (error: unknown) =>
        error instanceof DomainValidationError &&
        /line 2/.test(error.message) &&
        /runId/.test(error.message)
    );
  });
});

test("a corrupt mid-file line fails readAll closed with a DomainValidationError", async () => {
  await withStore(async (store, stateRoot, episodeId) => {
    const events = fixtures(episodeId);
    const [opened, attached] = events;
    if (opened === undefined || attached === undefined) throw new Error("expected fixtures");
    await store.append(opened);
    await appendFile(logPath(stateRoot, episodeId), "NOT JSON\n");
    await store.append(attached);

    await assert.rejects(
      () => store.readAll(),
      (error: unknown) => error instanceof DomainValidationError && /line 2/.test(error.message)
    );
  });
});

test("a crash-truncated final line is still recovered, not fatal", async () => {
  await withStore(async (store, stateRoot, episodeId) => {
    const events = fixtures(episodeId);
    const [opened, attached] = events;
    if (opened === undefined || attached === undefined) throw new Error("expected fixtures");
    await store.append(opened);
    await store.append(attached);
    await appendFile(logPath(stateRoot, episodeId), '{"type":"EPISODE_CLOS');

    const read = await store.readAll();
    assert.equal(read.events.length, 2);
    assert.equal(read.events.at(-1)?.type, "RUN_ATTACHED");
    assert.equal(read.recovery.incompleteLine, '{"type":"EPISODE_CLOS');
    assert.equal(read.recovery.lineNumber, 3);
  });
});
