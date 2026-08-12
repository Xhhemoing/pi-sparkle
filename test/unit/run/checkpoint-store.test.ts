import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createRunId } from "../../../src/domain/ids.js";
import { CheckpointStore } from "../../../src/run/checkpoint-store.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

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

    const checkpointPath = join(stateRoot, "runs", runId, "checkpoint.json");
    const onDisk = JSON.parse(await readFile(checkpointPath, "utf8"));
    assert.deepEqual(onDisk, second);
    const leftover = join(stateRoot, "runs", runId, "checkpoint.json.tmp");
    await assert.rejects(() => readFile(leftover), { code: "ENOENT" });
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
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(stateRoot, "runs", runId, "checkpoint.json"), "{broken", "utf8");
    await assert.rejects(() => store.read(), SyntaxError);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});
