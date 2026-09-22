import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createProjectId, createRunId, createTaskId } from "../../../src/domain/ids.js";
import { defaultRunLimits } from "../../../src/domain/limits.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { EventStore } from "../../../src/run/event-store.js";
import { makeEvent } from "../../../test/helpers/event-factory.js";
import {
  loopArtifactPath,
  loopArtifactsDir,
  readLoopArtifact,
  runDirectoryPath,
  runEventsPath,
  saveLoopArtifact
} from "../../../src/execution/loop-artifact.js";

const OPAQUE_ID = /^art_v2_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function seedDurableRun(stateRoot: string, runId: ReturnType<typeof createRunId>): Promise<void> {
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

function sameLengthReplacement(original: string): string {
  const marker = ": true";
  const index = original.lastIndexOf(marker);
  assert.notEqual(index, -1);
  const replaced = `${original.slice(0, index)}: 1.00${original.slice(index + marker.length)}`;
  assert.equal(Buffer.byteLength(replaced, "utf8"), Buffer.byteLength(original, "utf8"));
  assert.notEqual(replaced, original);
  return replaced;
}

test("save/read round-trip uses an opaque id and does not content-address", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "g1b-art-"));
  const runId = createRunId();
  await seedDurableRun(stateRoot, runId);
  try {
    const ref = await saveLoopArtifact({ stateRoot, runId, body: { hello: "world", secret: "nope" } });
    assert.match(ref.id, OPAQUE_ID);
    assert.equal("sha256" in ref, false);
    assert.equal(ref.schemaVersion, "loop-artifact-v2");
    assert.equal(ref.path, loopArtifactPath(stateRoot, runId, ref.id));
    const stored = await readFile(ref.path, "utf8");
    assert.equal(Buffer.byteLength(stored, "utf8"), ref.byteLength);
    assert.equal(/[0-9a-f]{64}/.test(stored), false);
    const body = await readLoopArtifact(stateRoot, runId, ref.id);
    assert.deepEqual(body, { hello: "world", secret: "nope" });
    const again = await saveLoopArtifact({ stateRoot, runId, body: { hello: "world", secret: "nope" } });
    assert.notEqual(again.id, ref.id);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("equal-length replacement is not claimed as detected when schema and length still match", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "g1b-art-"));
  const runId = createRunId();
  await seedDurableRun(stateRoot, runId);
  try {
    const ref = await saveLoopArtifact({ stateRoot, runId, body: { ok: true } });
    const original = await readFile(ref.path, "utf8");
    const replaced = sameLengthReplacement(original);
    const parsed = JSON.parse(replaced) as { schemaVersion: string; runId: string; byteLength: number; body: unknown };
    assert.equal(parsed.schemaVersion, "loop-artifact-v2");
    assert.equal(parsed.runId, runId);
    assert.equal(parsed.byteLength, ref.byteLength);
    assert.notDeepEqual(parsed.body, { ok: true });
    await writeFile(ref.path, replaced, "utf8");
    const body = await readLoopArtifact(stateRoot, runId, ref.id);
    assert.deepEqual(body, parsed.body);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("read rejects a stored byteLength that does not match the file", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "g1b-art-"));
  const runId = createRunId();
  await seedDurableRun(stateRoot, runId);
  try {
    const ref = await saveLoopArtifact({ stateRoot, runId, body: { ok: true } });
    const parsed = JSON.parse(await readFile(ref.path, "utf8")) as { byteLength: number };
    parsed.byteLength += 1;
    await writeFile(ref.path, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    await assert.rejects(() => readLoopArtifact(stateRoot, runId, ref.id), /byteLength|length/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("legacy 64-hex ids are rejected before any artifact file is created", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "g1b-art-"));
  const runId = createRunId();
  await seedDurableRun(stateRoot, runId);
  const legacy = "a".repeat(64);
  try {
    assert.throws(() => loopArtifactPath(stateRoot, runId, legacy), /legacy|64|opaque|refused/);
    await assert.rejects(() => readLoopArtifact(stateRoot, runId, legacy), /legacy|64|opaque|refused/);
    await assert.rejects(
      () => lstat(path.join(loopArtifactsDir(stateRoot, runId), `${legacy}.json`)),
      { code: "ENOENT" }
    );
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("save refuses a symlink at the artifact path and does not follow it", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "g1b-art-"));
  const runId = createRunId();
  await seedDurableRun(stateRoot, runId);
  const outside = await mkdtemp(path.join(tmpdir(), "g1b-art-out-"));
  const id = `art_v2_${randomUUID()}`;
  const outsideFile = path.join(outside, "leak.json");
  await writeFile(outsideFile, "untouched", "utf8");
  try {
    await mkdir(loopArtifactsDir(stateRoot, runId), { recursive: true });
    await symlink(outsideFile, loopArtifactPath(stateRoot, runId, id));
    const dirBefore = await lstat(loopArtifactsDir(stateRoot, runId));
    assert.equal(dirBefore.isSymbolicLink(), false);
    await assert.rejects(
      () => saveLoopArtifact({ stateRoot, runId, body: { x: 1 }, id }),
      /symlink/
    );
    assert.equal(await readFile(outsideFile, "utf8"), "untouched");
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
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
    await writeFile(runEventsPath(stateRoot, runId), `${JSON.stringify(mismatched)}\n`, "utf8");
    await assert.rejects(
      () => saveLoopArtifact({ stateRoot, runId, body: { x: 1 } }),
      /RUN_CREATED payload names a different run|refused/
    );
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});
