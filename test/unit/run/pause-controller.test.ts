import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createRunId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { createFilePauseController } from "../../../src/run/pause-controller.js";

const RUN_ID = createRunId(() => "01234567-89ab-cdef-0123-456789abcdef");
const NOW = parseIsoTimestamp("2026-08-15T06:00:00.000Z");

async function withStateRoot(run: (stateRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-pause-"));
  await run(stateRoot);
}

test("token is not paused when pause.json is absent", async () => {
  await withStateRoot(async (stateRoot) => {
    const pause = createFilePauseController(stateRoot, () => NOW);
    assert.deepEqual(await pause.token(RUN_ID), { paused: false });
  });
});

test("requestPause writes a token that token() and clearPause round-trip", async () => {
  await withStateRoot(async (stateRoot) => {
    const pause = createFilePauseController(stateRoot, () => NOW);
    const requested = await pause.requestPause(RUN_ID, "hold the run");
    assert.equal(requested.paused, true);
    assert.equal(requested.requestedAt, NOW);
    assert.equal(requested.reason, "hold the run");
    assert.deepEqual(await pause.token(RUN_ID), requested);

    await pause.clearPause(RUN_ID);
    assert.deepEqual(await pause.token(RUN_ID), { paused: false });
    await pause.clearPause(RUN_ID);
  });
});

test("malformed pause.json fails closed", async () => {
  await withStateRoot(async (stateRoot) => {
    const pause = createFilePauseController(stateRoot, () => NOW);
    const dir = join(stateRoot, "runs", RUN_ID);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "pause.json"), "{not-json", "utf8");
    await assert.rejects(() => pause.token(RUN_ID), /pause\.json|malformed|Invalid/);

    await writeFile(join(dir, "pause.json"), JSON.stringify({ paused: true }), "utf8");
    await assert.rejects(() => pause.token(RUN_ID), /pause\.json|malformed|requestedAt|Invalid/);
  });
});
