import assert from "node:assert/strict";
import { mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { createRunId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { withExclusiveFileLock } from "../../../src/persist/file-lock.js";
import { CheckpointStore } from "../../../src/run/checkpoint-store.js";
import { runLockPath } from "../../../src/run/event-store.js";
import { validateCheckpoint } from "../../../src/run/replay.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";
const CHECKPOINT_TIME = parseIsoTimestamp("2026-08-24T12:00:00.000Z");

function checkpointPaths(stateRoot: string, runId: string) {
  const checkpoint = join(stateRoot, "runtime", "runs", runId, "checkpoint.json");
  return { checkpoint, temp: `${checkpoint}.tmp` };
}

/** Temp files the store itself left behind; abandoned temps planted by a test are named explicitly. */
async function ownTempFiles(checkpointPath: string): Promise<string[]> {
  const entries = await readdir(dirname(checkpointPath)).catch(() => [] as string[]);
  return entries.filter((entry) => entry.endsWith(".tmp")).toSorted();
}

test("checkpoints write, read, and overwrite atomically", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-test-"));
  try {
    const runId = createRunId(UUID);
    const store = new CheckpointStore(stateRoot, runId);
    assert.equal(await store.read(), undefined);

    const first = { schemaVersion: 1, marker: "a", nested: { count: 1 } };
    await store.write(first);
    assert.deepEqual(await store.read(), first);

    const second = { schemaVersion: 1, marker: "b", nested: { count: 2 } };
    await store.write(second);
    assert.deepEqual(await store.read(), second);

    const paths = checkpointPaths(stateRoot, runId);
    const onDisk = await readFile(paths.checkpoint, "utf8");
    assert.deepEqual(JSON.parse(onDisk), second);
    assert.equal(onDisk, `${JSON.stringify(second, null, 2)}\n`);
    assert.deepEqual(await ownTempFiles(paths.checkpoint), []);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("a crash after the temp write but before rename preserves the previous resumable checkpoint", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-test-"));
  try {
    const runId = createRunId(UUID);
    const store = new CheckpointStore(stateRoot, runId);
    const previous = {
      schemaVersion: 1 as const,
      status: "PAUSED" as const,
      agentOutcomes: [],
      updatedAt: CHECKPOINT_TIME
    };
    const pending = {
      schemaVersion: 1 as const,
      status: "RUNNING" as const,
      agentOutcomes: [],
      updatedAt: CHECKPOINT_TIME
    };
    await store.write(previous);

    const paths = checkpointPaths(stateRoot, runId);
    const handle = await open(paths.temp, "w");
    try {
      await handle.writeFile(`${JSON.stringify(pending, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    const recovered = validateCheckpoint(await store.read());
    assert.deepEqual(recovered, previous);
    assert.deepEqual(JSON.parse(await readFile(paths.temp, "utf8")), pending);

    // The stranded temp is inert: the next write publishes its own bytes and never adopts it.
    const resumed = { ...pending, status: "COMPLETED" as const };
    await store.write(resumed);
    assert.deepEqual(validateCheckpoint(await store.read()), resumed);
    assert.deepEqual(JSON.parse(await readFile(paths.temp, "utf8")), pending);
    assert.deepEqual(await ownTempFiles(paths.checkpoint), ["checkpoint.json.tmp"]);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("a partial temp file is ignored and does not poison the next checkpoint write", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-test-"));
  try {
    const runId = createRunId(UUID);
    const store = new CheckpointStore(stateRoot, runId);
    const paths = checkpointPaths(stateRoot, runId);
    const abandonedTemp = `${paths.checkpoint}.999999.abandoned.tmp`;
    await mkdir(dirname(paths.temp), { recursive: true });
    await writeFile(paths.temp, '{"schemaVersion": 1, "status": "RUN', "utf8");
    await writeFile(abandonedTemp, '{"schemaVersion": 1, "status": "PAU', "utf8");

    assert.equal(await store.read(), undefined);

    const checkpoint = { schemaVersion: 1, marker: "recovered" };
    await store.write(checkpoint);
    assert.deepEqual(await store.read(), checkpoint);
    assert.equal(await readFile(paths.temp, "utf8"), '{"schemaVersion": 1, "status": "RUN');
    assert.equal(await readFile(abandonedTemp, "utf8"), '{"schemaVersion": 1, "status": "PAU');
    assert.deepEqual(await ownTempFiles(paths.checkpoint), [
      "checkpoint.json.999999.abandoned.tmp",
      "checkpoint.json.tmp"
    ]);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("concurrent checkpoint writes publish exactly one complete document", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-test-"));
  try {
    const runId = createRunId(UUID);
    const store = new CheckpointStore(stateRoot, runId);
    const checkpoints = Array.from({ length: 8 }, (_unused, index) => ({
      schemaVersion: 1 as const,
      status: "RUNNING" as const,
      agentOutcomes: [],
      updatedAt: CHECKPOINT_TIME,
      marker: String(index).repeat(100_000)
    }));

    await Promise.all(checkpoints.map((checkpoint) => store.write(checkpoint)));

    const paths = checkpointPaths(stateRoot, runId);
    const raw = await readFile(paths.checkpoint, "utf8");
    const expected = checkpoints.map((checkpoint) => `${JSON.stringify(checkpoint, null, 2)}\n`);
    assert.ok(expected.includes(raw), "published bytes are not any single writer's payload");
    assert.deepEqual(await store.read(), JSON.parse(raw));
    assert.deepEqual(await ownTempFiles(paths.checkpoint), []);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

/**
 * Decision pin, matching `event-store.test.ts`'s: the flowchart loop persists
 * a checkpoint after every scheduling step, so this is a per-step writer and
 * it deliberately does not take the run lock — measured at +62% per write and
 * +17.5% end-to-end against a 5% bar (see the docstring on `write`). The delete
 * side stays honest without it by verifying under the lock and again after it.
 */
test("checkpoint writes do not block on the run lock", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-test-"));
  try {
    const runId = createRunId(UUID);
    const store = new CheckpointStore(stateRoot, runId);
    await withExclusiveFileLock(runLockPath(stateRoot, runId), async () => {
      await store.write({ schemaVersion: 1, marker: "written under someone else's lock" });
    });
    assert.deepEqual(await store.read(), {
      schemaVersion: 1,
      marker: "written under someone else's lock"
    });
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("a corrupt checkpoint surfaces a typed error naming the checkpoint file", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-test-"));
  try {
    const runId = createRunId(UUID);
    const store = new CheckpointStore(stateRoot, runId);
    await store.write({ ok: true });
    const paths = checkpointPaths(stateRoot, runId);
    await writeFile(paths.checkpoint, "{broken", "utf8");
    await writeFile(paths.temp, JSON.stringify({ ok: "uncommitted" }), "utf8");
    await assert.rejects(
      () => store.read(),
      (error: unknown) => {
        assert.ok(error instanceof DomainValidationError);
        assert.equal(error.constructor, DomainValidationError);
        assert.match(error.message, /Invalid checkpoint/);
        assert.ok(error.message.includes(paths.checkpoint), "the error must name the damaged file");
        return true;
      }
    );
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});
