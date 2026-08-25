import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createRunId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { LOCK_TIMEOUT_CODE, withExclusiveFileLock } from "../../../src/persist/file-lock.js";
import { runLockPath } from "../../../src/run/event-store.js";
import { createFilePauseController } from "../../../src/run/pause-controller.js";

const RUN_ID = createRunId(() => "01234567-89ab-cdef-0123-456789abcdef");
const NOW = parseIsoTimestamp("2026-08-15T06:00:00.000Z");

async function withStateRoot(run: (stateRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-pause-"));
  await run(stateRoot);
}

function runDirectory(stateRoot: string): string {
  return join(stateRoot, "runtime", "runs", RUN_ID);
}

async function tempFiles(stateRoot: string): Promise<string[]> {
  const entries = await readdir(runDirectory(stateRoot)).catch(() => [] as string[]);
  return entries.filter((entry) => entry.endsWith(".tmp")).toSorted();
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
    assert.equal(
      await readFile(join(runDirectory(stateRoot), "pause.json"), "utf8"),
      `${JSON.stringify(requested, null, 2)}\n`
    );
    assert.deepEqual(await tempFiles(stateRoot), []);

    await pause.clearPause(RUN_ID);
    assert.deepEqual(await pause.token(RUN_ID), { paused: false });
    await pause.clearPause(RUN_ID);
  });
});

test("requestPause twice replaces the token on Windows", async () => {
  await withStateRoot(async (stateRoot) => {
    let current = NOW;
    const pause = createFilePauseController(stateRoot, () => current);
    await pause.requestPause(RUN_ID, "first hold");
    const later = parseIsoTimestamp("2026-08-15T06:01:00.000Z");
    current = later;
    const second = await pause.requestPause(RUN_ID, "updated reason");
    assert.equal(second.paused, true);
    assert.equal(second.requestedAt, later);
    assert.equal(second.reason, "updated reason");
    assert.deepEqual(await pause.token(RUN_ID), second);
    assert.deepEqual(await tempFiles(stateRoot), []);
  });
});

test("concurrent pause requests leave a single parseable token", async () => {
  await withStateRoot(async (stateRoot) => {
    const reasons = Array.from({ length: 8 }, (_unused, index) => `hold ${String(index).repeat(50_000)}`);
    const pause = createFilePauseController(stateRoot, () => NOW);

    const tokens = await Promise.all(reasons.map((reason) => pause.requestPause(RUN_ID, reason)));

    const raw = await readFile(join(runDirectory(stateRoot), "pause.json"), "utf8");
    const expected = tokens.map((token) => `${JSON.stringify(token, null, 2)}\n`);
    assert.ok(expected.includes(raw), "published bytes are not any single writer's token");
    const observed = await pause.token(RUN_ID);
    assert.equal(observed.paused, true);
    assert.ok(reasons.includes(observed.reason ?? ""));
    assert.deepEqual(await tempFiles(stateRoot), []);
  });
});

test("a stale pause temp file neither corrupts nor blocks the next pause request", async () => {
  await withStateRoot(async (stateRoot) => {
    const directory = runDirectory(stateRoot);
    await mkdir(directory, { recursive: true });
    const legacyTemp = join(directory, "pause.json.tmp");
    const abandonedTemp = join(directory, "pause.json.999999.abandoned.tmp");
    await writeFile(legacyTemp, '{"paused": tru', "utf8");
    await writeFile(abandonedTemp, '{"paused": fals', "utf8");

    const pause = createFilePauseController(stateRoot, () => NOW);
    assert.deepEqual(await pause.token(RUN_ID), { paused: false });

    const requested = await pause.requestPause(RUN_ID, "after a crashed writer");
    assert.deepEqual(await pause.token(RUN_ID), requested);
    assert.equal(await readFile(legacyTemp, "utf8"), '{"paused": tru');
    assert.equal(await readFile(abandonedTemp, "utf8"), '{"paused": fals');
    assert.deepEqual(await tempFiles(stateRoot), [
      "pause.json.999999.abandoned.tmp",
      "pause.json.tmp"
    ]);

    await pause.clearPause(RUN_ID);
    assert.deepEqual(await pause.token(RUN_ID), { paused: false });
  });
});

/**
 * `requestPause` creates the run directory (`writeFileAtomic` does), so it is
 * one of the writers that can put a subtree back that `delete --run` has just
 * removed. It therefore takes the run's cooperative lock — the same file the
 * delete holds across its removal and verification.
 */
test("requestPause waits for whoever holds the run lock, then writes", async () => {
  await withStateRoot(async (stateRoot) => {
    const pause = createFilePauseController(stateRoot, () => NOW);
    const pausePath = join(runDirectory(stateRoot), "pause.json");
    let pending: Promise<unknown> | undefined;

    await withExclusiveFileLock(runLockPath(stateRoot, RUN_ID), async () => {
      pending = pause.requestPause(RUN_ID, "queued behind the lock");
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.equal(
        existsSync(pausePath),
        false,
        "no pause token may be published while another writer holds the run lock"
      );
    });

    assert.ok(pending !== undefined);
    await pending;
    assert.equal(existsSync(pausePath), true);
    assert.equal(
      existsSync(runLockPath(stateRoot, RUN_ID)),
      false,
      "the pause request releases the lock it took"
    );
  });
});

test("a pause request that cannot take the run lock fails closed and writes nothing", async () => {
  await withStateRoot(async (stateRoot) => {
    const pause = createFilePauseController(stateRoot, () => NOW, { timeoutMs: 40, retryMs: 5 });
    const lockPath = runLockPath(stateRoot, RUN_ID);
    let outcome: unknown;

    await withExclusiveFileLock(lockPath, async () => {
      outcome = await pause
        .requestPause(RUN_ID, "never lands")
        .then((token) => token, (error: unknown) => error);
    });

    assert.ok(outcome instanceof DomainValidationError, "a lock timeout must reject the request");
    assert.equal((outcome as { code?: unknown }).code, LOCK_TIMEOUT_CODE);
    assert.ok(outcome.message.includes(lockPath), "the failure must name the run lock");
    assert.equal(existsSync(join(runDirectory(stateRoot), "pause.json")), false);
  });
});

/**
 * Neither reading a token nor clearing one can recreate a deleted run
 * directory, so neither waits on the lock: an operator inspecting or clearing
 * a pause is not blocked by a `delete --run` it does not race.
 */
test("token and clearPause do not take the run lock", async () => {
  await withStateRoot(async (stateRoot) => {
    const pause = createFilePauseController(stateRoot, () => NOW);
    await pause.requestPause(RUN_ID, "hold");

    await withExclusiveFileLock(runLockPath(stateRoot, RUN_ID), async () => {
      assert.equal((await pause.token(RUN_ID)).paused, true);
      await pause.clearPause(RUN_ID);
      assert.deepEqual(await pause.token(RUN_ID), { paused: false });
    });
  });
});

test("clearing a pause for a run with nothing on disk creates neither directory nor lock", async () => {
  await withStateRoot(async (stateRoot) => {
    const pause = createFilePauseController(stateRoot, () => NOW);
    await pause.clearPause(RUN_ID);
    assert.equal(existsSync(join(stateRoot, "runtime", "runs")), false);
    assert.equal(existsSync(runLockPath(stateRoot, RUN_ID)), false);
  });
});

test("malformed pause.json fails closed", async () => {
  await withStateRoot(async (stateRoot) => {
    const pause = createFilePauseController(stateRoot, () => NOW);
    const dir = join(stateRoot, "runtime", "runs", RUN_ID);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "pause.json"), "{not-json", "utf8");
    await assert.rejects(() => pause.token(RUN_ID), /pause\.json|malformed|Invalid/);

    await writeFile(join(dir, "pause.json"), JSON.stringify({ paused: true }), "utf8");
    await assert.rejects(() => pause.token(RUN_ID), /pause\.json|malformed|requestedAt|Invalid/);
  });
});
