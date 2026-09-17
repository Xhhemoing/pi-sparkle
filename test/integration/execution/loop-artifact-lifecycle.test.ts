import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createProjectId, createRunId, createTaskId } from "../../../src/domain/ids.js";
import { defaultRunLimits } from "../../../src/domain/limits.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { deleteRunRecords } from "../../../src/privacy/deletion.js";
import { EventStore } from "../../../src/run/event-store.js";
import { makeEvent } from "../../../test/helpers/event-factory.js";
import {
  readLoopArtifact,
  saveLoopArtifact
} from "../../../src/execution/loop-artifact.js";

test("after deleteRunRecords, save/read refuse and do not revive the run", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "g1b-life-"));
  const runId = createRunId();
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
  try {
    const ref = await saveLoopArtifact({ stateRoot, runId, body: { n: 1 } });
    await deleteRunRecords(stateRoot, runId);
    await assert.rejects(() => readLoopArtifact(stateRoot, runId, ref.sha256), /missing|refused/);
    await assert.rejects(() => saveLoopArtifact({ stateRoot, runId, body: { n: 2 } }), /missing|refused/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});
