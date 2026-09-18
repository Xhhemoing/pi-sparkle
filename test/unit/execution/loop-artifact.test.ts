import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { test } from "node:test";
import { createRunId } from "../../../src/domain/ids.js";
import {
  loopArtifactPath,
  readLoopArtifact,
  runDirectoryPath,
  saveLoopArtifact
} from "../../../src/execution/loop-artifact.js";

test("save/read round-trip verifies content hash and schema", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "g1b-art-"));
  const runId = createRunId();
  await mkdir(runDirectoryPath(stateRoot, runId), { recursive: true });
  try {
    const ref = await saveLoopArtifact({ stateRoot, runId, body: { hello: "world", secret: "nope" } });
    assert.equal(ref.sha256.length, 64);
    assert.equal(ref.schemaVersion, "loop-artifact-v1");
    const body = await readLoopArtifact(stateRoot, runId, ref.sha256);
    assert.deepEqual(body, { hello: "world", secret: "nope" });
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("tampered JSON that still parses is rejected on read", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "g1b-art-"));
  const runId = createRunId();
  await mkdir(runDirectoryPath(stateRoot, runId), { recursive: true });
  try {
    const ref = await saveLoopArtifact({ stateRoot, runId, body: { ok: true } });
    const file = loopArtifactPath(stateRoot, runId, ref.sha256);
    await writeFile(file, `${JSON.stringify({ schemaVersion: "loop-artifact-v1", runId, body: { ok: false } }, null, 2)}\n`, "utf8");
    await assert.rejects(() => readLoopArtifact(stateRoot, runId, ref.sha256), /hash mismatch|tamper/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("save refuses when run directory is missing (no revive)", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "g1b-art-"));
  const runId = createRunId();
  try {
    await assert.rejects(
      () => saveLoopArtifact({ stateRoot, runId, body: { x: 1 } }),
      /run directory missing|refused/
    );
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});
