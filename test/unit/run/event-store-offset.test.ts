import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createRunId, type RunId } from "../../../src/domain/ids.js";
import { EventLogOffsetError, EventStore } from "../../../src/run/event-store.js";
import { makeEvent, makeRun } from "../../helpers/event-factory.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

async function withStore(run: (store: EventStore, stateRoot: string, runId: RunId) => Promise<void>) {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-eso-"));
  try {
    const runId = createRunId(UUID);
    await run(new EventStore(stateRoot, runId), stateRoot, runId);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
}

test("readAll reports a completeByteLength that readFromOffset can resume", async () => {
  await withStore(async (store) => {
    const first = makeEvent("RUN_CREATED", { run: makeRun() });
    const second = makeEvent("RUN_STARTED", {});
    await store.append(first);
    const afterFirst = await store.readAll();
    assert.ok(afterFirst.completeByteLength > 0);
    await store.append(second);
    const tail = await store.readFromOffset(afterFirst.completeByteLength);
    assert.equal(tail.mode, "incremental");
    assert.equal(tail.events.length, 1);
    assert.equal(tail.events[0]?.type, "RUN_STARTED");
    const full = await store.readAll();
    assert.deepEqual([...afterFirst.events, ...tail.events], full.events);
    assert.equal(tail.completeByteLength, full.completeByteLength);
  });
});

test("readFromOffset on a mid-record byte throws EventLogOffsetError", async () => {
  await withStore(async (store) => {
    await store.append(makeEvent("RUN_CREATED", { run: makeRun() }));
    await assert.rejects(() => store.readFromOffset(3), EventLogOffsetError);
  });
});

test("offset beyond EOF falls back to a full read rather than inventing a tail", async () => {
  await withStore(async (store) => {
    await store.append(makeEvent("RUN_CREATED", { run: makeRun() }));
    const fallback = await store.readFromOffset(50_000);
    assert.equal(fallback.mode, "full-fallback");
    assert.equal(fallback.fallbackReason, "offset-beyond-eof");
    assert.equal(fallback.events.length, 1);
    assert.equal(fallback.events[0]?.type, "RUN_CREATED");
  });
});

test("readFromOffset still fails closed on a corrupt middle", async () => {
  await withStore(async (store, stateRoot, runId) => {
    await store.append(makeEvent("RUN_CREATED", { run: makeRun() }));
    const afterFirst = await store.readAll();
    const eventsPath = join(stateRoot, "runtime", "runs", runId, "events.jsonl");
    await appendFile(eventsPath, "NOT JSON\n");
    await appendFile(eventsPath, JSON.stringify(makeEvent("RUN_STARTED", {})) + "\n");
    await assert.rejects(() => store.readFromOffset(afterFirst.completeByteLength), /line 2/);
    await assert.rejects(() => store.readAll(), /line 2/);
  });
});

test("crash-truncated tail after an offset is recovery evidence, not corruption", async () => {
  await withStore(async (store, stateRoot, runId) => {
    await store.append(makeEvent("RUN_CREATED", { run: makeRun() }));
    const afterFirst = await store.readAll();
    const eventsPath = join(stateRoot, "runtime", "runs", runId, "events.jsonl");
    await appendFile(eventsPath, '{"id":"evt_truncated","schemaVersion":1,"type":"RUN_ST');
    const tail = await store.readFromOffset(afterFirst.completeByteLength);
    assert.equal(tail.mode, "incremental");
    assert.deepEqual(tail.events, []);
    assert.equal(tail.recovery.incompleteLine, '{"id":"evt_truncated","schemaVersion":1,"type":"RUN_ST');
  });
});
