import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, type CliIo } from "../../../src/cli/main.js";
import { parseCliErrorJson } from "../../../src/cli/errors.js";
import {
  createEpisodeId,
  createEvidenceId,
  createProjectId
} from "../../../src/domain/ids.js";
import type { ProjectEpisode } from "../../../src/domain/episode.js";
import { nowIso } from "../../../src/domain/timestamp.js";
import { openEpisode } from "../../../src/episode/manager.js";
import { EpisodeEventStore } from "../../../src/episode/store.js";
import { EpisodeStore } from "../../../src/run/episode-store.js";

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (text) => out.push(text), stderr: (text) => err.push(text) },
    out,
    err
  };
}

async function seedEpisode(stateRoot: string, episode: ProjectEpisode): Promise<void> {
  const opened = openEpisode({
    id: episode.id,
    projectId: episode.projectId,
    objective: episode.objective,
    contractVersion: episode.contractVersion,
    acceptance: episode.acceptance
  });
  await new EpisodeStore(stateRoot, episode.id).append(episode);
  await new EpisodeEventStore(stateRoot, episode.id).append(opened.event);
}

test("episode close refuses completion when acceptance evidence is missing and records waiting", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-episode-close-"));
  const episode: ProjectEpisode = {
    id: createEpisodeId(() => "close0001"),
    projectId: createProjectId(() => "close0001"),
    objective: "ship",
    contractVersion: 1,
    runIds: [],
    startedAt: nowIso(),
    status: "OPEN",
    acceptance: [{ id: "tests", description: "tests pass", observableCheck: "pnpm test" }],
    evidenceRefs: []
  };
  await seedEpisode(stateRoot, episode);

  const captured = capture();
  const code = await main([
    "episode", "close", "--episode", episode.id, "--status", "COMPLETED", "--state-root", stateRoot
  ], captured.io);

  assert.equal(code, 1);
  assert.match(captured.err.join(""), /acceptance-incomplete.*tests/);
  assert.match(captured.err.join(""), /recorded WAITING_FOR_USER/);
  const snapshots = await new EpisodeStore(stateRoot, episode.id).readAll();
  assert.equal(snapshots.episodes.at(-1)?.status, "WAITING_FOR_USER");
  const events = await new EpisodeEventStore(stateRoot, episode.id).readAll();
  assert.equal(events.events.at(-1)?.type, "EPISODE_WAITING");
});

test("a second refused COMPLETED close writes no second snapshot and claims no write", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-episode-rewait-"));
  const episode: ProjectEpisode = {
    id: createEpisodeId(() => "close0003"),
    projectId: createProjectId(() => "close0003"),
    objective: "ship",
    contractVersion: 1,
    runIds: [],
    startedAt: nowIso(),
    status: "OPEN",
    acceptance: [{ id: "tests", description: "tests pass", observableCheck: "pnpm test" }],
    evidenceRefs: []
  };
  await seedEpisode(stateRoot, episode);

  const first = capture();
  assert.equal(
    await main(
      ["episode", "close", "--episode", episode.id, "--status", "COMPLETED", "--state-root", stateRoot],
      first.io
    ),
    1
  );
  const afterFirst = await new EpisodeStore(stateRoot, episode.id).readAll();
  assert.equal(afterFirst.episodes.at(-1)?.status, "WAITING_FOR_USER");

  const second = capture();
  assert.equal(
    await main(
      ["episode", "close", "--episode", episode.id, "--status", "COMPLETED", "--state-root", stateRoot],
      second.io
    ),
    1
  );
  const afterSecond = await new EpisodeStore(stateRoot, episode.id).readAll();
  assert.equal(afterSecond.episodes.length, afterFirst.episodes.length);
  assert.doesNotMatch(second.err.join(""), /recorded WAITING_FOR_USER/);
  assert.match(second.err.join(""), /already WAITING_FOR_USER/);
});

test("episode close completes once every criterion has matching evidence and events are inspectable", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-episode-complete-"));
  const evidenceId = createEvidenceId(() => "tests-pass");
  const episode: ProjectEpisode = {
    id: createEpisodeId(() => "close0002"),
    projectId: createProjectId(() => "close0002"),
    objective: "ship",
    contractVersion: 1,
    runIds: [],
    startedAt: nowIso(),
    status: "OPEN",
    acceptance: [{ id: "tests", description: "tests pass", observableCheck: "pnpm test" }],
    evidenceRefs: [evidenceId],
    acceptanceEvidence: [
      { criterionId: "tests", evidenceId, result: "PASSED", sourceRef: "check:pnpm-test" }
    ]
  };
  await seedEpisode(stateRoot, episode);

  const closed = capture();
  const closeCode = await main([
    "episode", "close", "--episode", episode.id, "--status", "COMPLETED", "--state-root", stateRoot
  ], closed.io);
  assert.equal(closeCode, 0, closed.err.join(""));
  assert.match(closed.out.join(""), /COMPLETED/);

  const listed = capture();
  const eventsCode = await main([
    "episode", "events", "--episode", episode.id, "--state-root", stateRoot, "--json"
  ], listed.io);
  assert.equal(eventsCode, 0, listed.err.join(""));
  const events = listed.out.map((line) => JSON.parse(line) as { type: string });
  assert.deepEqual(events.map((event) => event.type), ["EPISODE_OPENED", "EPISODE_CLOSED"]);
});

test("episode events on an unknown episode points at list --episodes, not at a run id", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-episode-events-missing-"));
  const missing = createEpisodeId(() => "missing001");

  const captured = capture();
  const code = await main(
    ["episode", "events", "--episode", missing, "--state-root", stateRoot],
    captured.io
  );

  assert.equal(code, 1);
  assert.deepEqual(captured.out, []);
  const report = parseCliErrorJson(captured.err.join(""));
  assert.equal(report?.command, "episode");
  assert.equal(report?.stage, "lookup");
  assert.match(report?.next ?? "", /pnpm cli list/);
  assert.match(report?.next ?? "", /--episodes/);
  assert.ok((report?.next ?? "").includes(stateRoot));
});

test("episode close on an unknown episode points at list --episodes, not at a run id", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-episode-close-missing-"));
  const missing = createEpisodeId(() => "missing002");

  const captured = capture();
  const code = await main(
    ["episode", "close", "--episode", missing, "--status", "FAILED", "--state-root", stateRoot],
    captured.io
  );

  assert.equal(code, 1);
  const report = parseCliErrorJson(captured.err.join(""));
  assert.equal(report?.command, "episode");
  assert.equal(report?.stage, "lookup");
  assert.match(report?.next ?? "", /pnpm cli list/);
  assert.match(report?.next ?? "", /--episodes/);
  assert.ok((report?.next ?? "").includes(stateRoot));
});
