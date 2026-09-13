import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createRunId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { CheckpointStore } from "../../../src/run/checkpoint-store.js";
import { EventStore } from "../../../src/run/event-store.js";
import { persistRunCheckpoint } from "../../../src/run/flowchart-checkpoint.js";
import { replayRun, validateCheckpoint } from "../../../src/run/replay.js";
import { makeEvent, makeRun } from "../../helpers/event-factory.js";

const NOW = parseIsoTimestamp("2026-09-13T00:00:00.000Z");

async function withStores(
  run: (eventStore: EventStore, checkpointStore: CheckpointStore, stateRoot: string, runId: ReturnType<typeof createRunId>) => Promise<void>
): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-fcp-"));
  try {
    const runId = createRunId(() => "01234567-89ab-cdef-0123-456789abcdef");
    await run(new EventStore(stateRoot, runId), new CheckpointStore(stateRoot, runId), stateRoot, runId);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
}

test("first persist is a full replay; the next persist is incremental and equivalent", async () => {
  await withStores(async (eventStore, checkpointStore) => {
    const created = makeEvent("RUN_CREATED", { run: makeRun() });
    const started = makeEvent("RUN_STARTED", {});
    await eventStore.append(created);
    await eventStore.append(started);
    const first = await persistRunCheckpoint({
      eventStore,
      checkpointStore,
      now: () => NOW
    });
    assert.equal(first.replayMode, "full");
    assert.equal(first.checkpoint.status, "RUNNING");
    assert.deepEqual(first.checkpoint.status, replayRun((await eventStore.readAll()).events).status);

    const completed = makeEvent("RUN_COMPLETED", {});
    await eventStore.append(completed);
    const second = await persistRunCheckpoint({
      eventStore,
      checkpointStore,
      now: () => NOW,
      cursor: first.cursor,
      eventLogByteOffset: first.eventLogByteOffset
    });
    assert.equal(second.replayMode, "incremental");
    assert.equal(second.appliedEvents.length, 1);
    assert.equal(second.appliedEvents[0]?.type, "RUN_COMPLETED");
    assert.equal(second.checkpoint.status, "COMPLETED");
    const full = replayRun((await eventStore.readAll()).events);
    assert.equal(second.checkpoint.status, full.status);
    assert.equal(second.checkpoint.lastEventId, full.lastEventId);
    assert.deepEqual(validateCheckpoint(await checkpointStore.read()).status, "COMPLETED");
  });
});

test("a corrupt middle still fails closed on incremental persist", async () => {
  await withStores(async (eventStore, checkpointStore, stateRoot, runId) => {
    await eventStore.append(makeEvent("RUN_CREATED", { run: makeRun() }));
    const first = await persistRunCheckpoint({
      eventStore,
      checkpointStore,
      now: () => NOW
    });
    const { appendFile } = await import("node:fs/promises");
    await appendFile(join(stateRoot, "runtime", "runs", runId, "events.jsonl"), "NOT JSON\n");
    await appendFile(
      join(stateRoot, "runtime", "runs", runId, "events.jsonl"),
      JSON.stringify(makeEvent("RUN_STARTED", {})) + "\n"
    );
    await assert.rejects(
      () =>
        persistRunCheckpoint({
          eventStore,
          checkpointStore,
          now: () => NOW,
          cursor: first.cursor,
          eventLogByteOffset: first.eventLogByteOffset
        }),
      /line /
    );
  });
});
