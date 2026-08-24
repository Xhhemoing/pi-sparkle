import assert from "node:assert/strict";
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { createRunId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { CheckpointStore } from "../../../src/run/checkpoint-store.js";
import { validateCheckpoint } from "../../../src/run/replay.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";
const CHECKPOINT_TIME = parseIsoTimestamp("2026-08-24T12:00:00.000Z");

function checkpointPaths(stateRoot: string, runId: string) {
  const checkpoint = join(stateRoot, "runtime", "runs", runId, "checkpoint.json");
  return { checkpoint, temp: `${checkpoint}.tmp` };
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
    const onDisk = JSON.parse(await readFile(paths.checkpoint, "utf8"));
    assert.deepEqual(onDisk, second);
    await assert.rejects(() => readFile(paths.temp), { code: "ENOENT" });
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

    await store.write(pending);
    assert.deepEqual(validateCheckpoint(await store.read()), pending);
    await assert.rejects(() => readFile(paths.temp), { code: "ENOENT" });
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
    await mkdir(dirname(paths.temp), { recursive: true });
    await writeFile(paths.temp, '{"schemaVersion": 1, "status": "RUN', "utf8");

    assert.equal(await store.read(), undefined);

    const checkpoint = { schemaVersion: 1, marker: "recovered" };
    await store.write(checkpoint);
    assert.deepEqual(await store.read(), checkpoint);
    await assert.rejects(() => readFile(paths.temp), { code: "ENOENT" });
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("a corrupt checkpoint surfaces a parse error to the caller", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-test-"));
  try {
    const runId = createRunId(UUID);
    const store = new CheckpointStore(stateRoot, runId);
    await store.write({ ok: true });
    const paths = checkpointPaths(stateRoot, runId);
    await writeFile(paths.checkpoint, "{broken", "utf8");
    await writeFile(paths.temp, JSON.stringify({ ok: "uncommitted" }), "utf8");
    await assert.rejects(() => store.read(), SyntaxError);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});
