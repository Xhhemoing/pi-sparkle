import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { test } from "node:test";
import { createProjectId, createRunId, createTaskId } from "../../../src/domain/ids.js";
import { defaultRunLimits } from "../../../src/domain/limits.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { EventStore } from "../../../src/run/event-store.js";
import { makeEvent } from "../../../test/helpers/event-factory.js";
import { runEventsPath } from "../../../src/execution/loop-artifact.js";

async function seedDurableRun(stateRoot: string, runId: ReturnType<typeof createRunId>): Promise<void> {
  // Real durable initialization: assertRunPresent validates the event log.
  const createdAt = parseIsoTimestamp("2026-08-12T09:00:00.000Z");
  await new EventStore(stateRoot, runId).append(
    makeEvent(
      "RUN_CREATED",
      {
        run: {
          id: runId,
          projectId: createProjectId(),
          rootTaskId: createTaskId(),
          status: "PLANNING",
          limits: defaultRunLimits(),
          createdAt,
          updatedAt: createdAt
        }
      },
      { runId }
    )
  );
}
import {
  loopArtifactPath,
  readLoopArtifact,
  runDirectoryPath,
  saveLoopArtifact
} from "../../../src/execution/loop-artifact.js";

test("save/read round-trip verifies content hash and schema", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "g1b-art-"));
  const runId = createRunId();
  await seedDurableRun(stateRoot, runId);
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
  await seedDurableRun(stateRoot, runId);
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

test("save refuses an empty mkdir-only run directory without events.jsonl", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "g1b-art-"));
  const runId = createRunId();
  await mkdir(runDirectoryPath(stateRoot, runId), { recursive: true });
  try {
    await assert.rejects(
      () => saveLoopArtifact({ stateRoot, runId, body: { x: 1 } }),
      /run directory missing|refused/
    );
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("save refuses a log whose RUN_CREATED payload names a different run", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "g1b-art-"));
  const runId = createRunId();
  const otherRunId = createRunId();
  try {
    // Envelope runId matches, but the creation payload binds a different run.
    // Field-level validation alone accepts this; durable identity must not.
    const createdAt = parseIsoTimestamp("2026-08-12T09:00:00.000Z");
    const mismatched = makeEvent(
      "RUN_CREATED",
      {
        run: {
          id: otherRunId,
          projectId: createProjectId(),
          rootTaskId: createTaskId(),
          status: "PLANNING",
          limits: defaultRunLimits(),
          createdAt,
          updatedAt: createdAt
        }
      },
      { runId }
    );
    await mkdir(runDirectoryPath(stateRoot, runId), { recursive: true });
    await writeFile(runEventsPath(stateRoot, runId), `${JSON.stringify(mismatched)}\n`, "utf8");    await assert.rejects(
      () => saveLoopArtifact({ stateRoot, runId, body: { x: 1 } }),
      /RUN_CREATED payload names a different run|refused/
    );
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});
