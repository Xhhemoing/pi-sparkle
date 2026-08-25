import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createRunId, type RunId } from "../../../src/domain/ids.js";
import { withExclusiveFileLock } from "../../../src/persist/file-lock.js";
import { EventStore, runLockPath } from "../../../src/run/event-store.js";
import { makeEvent, makeRun } from "../../helpers/event-factory.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

async function withStore(run: (store: EventStore, stateRoot: string, runId: RunId) => Promise<void>) {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-test-"));
  try {
    const runId = createRunId(UUID);
    const store = new EventStore(stateRoot, runId);
    await run(store, stateRoot, runId);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
}

test("appended events round-trip in order", async () => {
  await withStore(async (store) => {
    const events = [
      makeEvent("RUN_CREATED", { run: makeRun() }),
      makeEvent("RUN_STARTED", {}),
      makeEvent("RUN_COMPLETED", {})
    ];
    for (const event of events) await store.append(event);
    const read = await store.readAll();
    assert.deepEqual(read.events, events);
    assert.deepEqual(read.recovery, {});
  });
});

test("concurrent appends are serialized and none are lost", async () => {
  await withStore(async (store) => {
    const events = Array.from({ length: 20 }, (_, index) =>
      makeEvent("AGENT_EVENT", { agentInstanceId: "agt_01234567-89ab-cdef-0123-456789abcdef", kind: "TEXT_DELTA", summary: `delta ${index}` })
    );
    await Promise.all(events.map((event) => store.append(event)));
    const read = await store.readAll();
    assert.equal(read.events.length, 20);
    assert.deepEqual(
      read.events.map((event) => (event.payload as { summary: string }).summary),
      events.map((event) => (event.payload as { summary: string }).summary)
    );
  });
});

test("reading a missing log yields no events and no recovery entry", async () => {
  await withStore(async (store) => {
    const read = await store.readAll();
    assert.deepEqual(read.events, []);
    assert.deepEqual(read.recovery, {});
  });
});

test("a crash-truncated final line is reported as recovery evidence", async () => {
  await withStore(async (store, stateRoot, runId) => {
    await store.append(makeEvent("RUN_CREATED", { run: makeRun() }));
    const eventsPath = join(stateRoot, "runtime", "runs", runId, "events.jsonl");
    const { appendFile } = await import("node:fs/promises");
    await appendFile(eventsPath, '{"id":"evt_truncated","schemaVersion":1,"type":"RUN_ST');
    const read = await store.readAll();
    assert.equal(read.events.length, 1);
    assert.equal(read.recovery.incompleteLine, '{"id":"evt_truncated","schemaVersion":1,"type":"RUN_ST');
    assert.equal(read.recovery.lineNumber, 2);
  });
});

test("a corrupt non-final line is treated as log corruption", async () => {
  await withStore(async (store, stateRoot, runId) => {
    await store.append(makeEvent("RUN_CREATED", { run: makeRun() }));
    const eventsPath = join(stateRoot, "runtime", "runs", runId, "events.jsonl");
    const { appendFile } = await import("node:fs/promises");
    await appendFile(eventsPath, "NOT JSON\n");
    await appendFile(eventsPath, JSON.stringify(makeEvent("RUN_STARTED", {})) + "\n");
    await assert.rejects(() => store.readAll(), /line 2/);
  });
});

test("appending an event for another run is rejected and writes nothing", async () => {
  await withStore(async (store) => {
    const foreign = makeEvent("RUN_STARTED", {}, { runId: createRunId(() => "11111111-2222-3333-4444-555555555555") });
    await assert.rejects(() => store.append(foreign), /runId/);
    const read = await store.readAll();
    assert.deepEqual(read.events, []);
  });
});

test("appending an invalid event is rejected and writes nothing", async () => {
  await withStore(async (store) => {
    const invalid = makeEvent("RUN_FAILED", { reason: "" });
    await assert.rejects(() => store.append(invalid), /payload/);
    const read = await store.readAll();
    assert.deepEqual(read.events, []);
  });
});

test("the run lock sits beside the run directory, not inside it", () => {
  const runId = createRunId(UUID);
  // A lock inside `runs/<runId>/` would be removed by the recursive delete
  // that holds it. Beside it, the delete's own lock survives its own `rm`.
  assert.equal(runLockPath("/state", runId), join("/state", "runtime", "runs", `${runId}.lock`));
});

/**
 * Decision pin, not an aspiration: appending is the run's per-step hot path
 * and deliberately does not take the run lock — measured at +372% per append
 * and +22.5% end-to-end against a 5% bar (see the docstring in
 * `src/run/event-store.ts`). Re-introducing the acquisition is allowed, but it
 * must be a decision someone makes on purpose, with this test and that
 * docstring updated together.
 */
test("append does not block on the run lock", async () => {
  await withStore(async (store, stateRoot, runId) => {
    await withExclusiveFileLock(runLockPath(stateRoot, runId), async () => {
      await store.append(makeEvent("RUN_CREATED", { run: makeRun() }));
    });
    assert.equal((await store.readAll()).events.length, 1);
    assert.equal(existsSync(runLockPath(stateRoot, runId)), false);
  });
});

test("terminal events fsync and remain readable", async () => {
  await withStore(async (store) => {
    await store.append(makeEvent("RUN_CREATED", { run: makeRun() }));
    await store.append(makeEvent("RUN_COMPLETED", {}));
    const read = await store.readAll();
    assert.equal(read.events.length, 2);
    assert.equal(read.events[1]?.type, "RUN_COMPLETED");
  });
});
