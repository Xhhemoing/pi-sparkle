import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createRunId } from "../../../src/domain/ids.js";
import { deleteRunRecords } from "../../../src/privacy/deletion.js";
import {
  readLoopArtifact,
  runDirectoryPath,
  saveLoopArtifact
} from "../../../src/execution/loop-artifact.js";

test("after deleteRunRecords, save/read refuse and do not revive the run", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "g1b-life-"));
  const runId = createRunId();
  await mkdir(runDirectoryPath(stateRoot, runId), { recursive: true });
    await writeFile(path.join(runDirectoryPath(stateRoot, runId), "events.jsonl"), "", "utf8");
  try {
    const ref = await saveLoopArtifact({ stateRoot, runId, body: { n: 1 } });
    await deleteRunRecords(stateRoot, runId);
    await assert.rejects(() => readLoopArtifact(stateRoot, runId, ref.sha256), /missing|refused/);
    await assert.rejects(() => saveLoopArtifact({ stateRoot, runId, body: { n: 2 } }), /missing|refused/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});
