import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createEpisodeId, createProjectId, createRunId, createEvidenceId } from "../../../src/domain/ids.js";
import { EpisodeStore } from "../../../src/run/episode-store.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";
const TEST_TS = "2026-08-13T10:00:00.000Z";

function makeEpisode(overrides: Partial<{ status: string; closedAt?: string }> = {}) {
  return {
    id: createEpisodeId(UUID),
    projectId: createProjectId(UUID),
    objective: "Implement adaptive episode lifecycle",
    contractVersion: 1,
    runIds: [createRunId(UUID)],
    startedAt: parseIsoTimestamp(TEST_TS),
    closedAt: overrides.closedAt ? parseIsoTimestamp(overrides.closedAt) : undefined,
    status: (overrides.status ?? "OPEN") as "OPEN" | "COMPLETED" | "FAILED" | "ABANDONED" | "WAITING_FOR_USER",
    acceptance: [{ id: "acc-1", description: "All M3-T1 tests pass", observableCheck: "npm test" }],
    evidenceRefs: [createEvidenceId(UUID)],
    outcomeId: undefined
  };
}

async function withStore(run: (store: EpisodeStore, stateRoot: string, episodeId: string) => Promise<void>) {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-episode-test-"));
  try {
    const episodeId = createEpisodeId(UUID);
    const store = new EpisodeStore(stateRoot, episodeId);
    await run(store, stateRoot, episodeId);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
}

test("appended episodes round-trip in order", async () => {
  await withStore(async (store) => {
    const ep = makeEpisode();
    await store.append(ep);
    const read = await store.readAll();
    assert.equal(read.episodes.length, 1);
    const first = read.episodes[0];
    if (!first) throw new Error("expected episode");
    assert.equal(first.id, ep.id);
    assert.deepEqual(read.recovery, {});
  });
});

test("reading a missing episode log yields no episodes", async () => {
  await withStore(async (store) => {
    const read = await store.readAll();
    assert.deepEqual(read.episodes, []);
    assert.deepEqual(read.recovery, {});
  });
});

test("a crash-truncated final line is reported as recovery evidence", async () => {
  await withStore(async (store, stateRoot, episodeId) => {
    await store.append(makeEpisode());
    await appendFile(join(stateRoot, "episodes", `${episodeId}.jsonl`), '{"id":"ep_truncated","status":"OP');
    const read = await store.readAll();
    assert.equal(read.episodes.length, 1);
    assert.equal(read.recovery.incompleteLine, '{"id":"ep_truncated","status":"OP');
    assert.equal(read.recovery.lineNumber, 2);
  });
});

test("terminal status episodes trigger fsync", async () => {
  await withStore(async (store) => {
    const closed = makeEpisode({ status: "COMPLETED", closedAt: "2026-08-13T10:05:00.000Z" });
    await store.append(closed);
    const read = await store.readAll();
    const first = read.episodes[0];
    if (!first) throw new Error("expected episode");
    assert.equal(first.status, "COMPLETED");
  });
});
