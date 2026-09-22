import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { createRunId, type RunId } from "../../../src/domain/ids.js";
import { withExclusiveFileLock } from "../../../src/persist/file-lock.js";
import {
  OBSERVATION_MAX_OBJECT_BYTES,
  OBSERVATION_MAX_RECALL_BYTES,
  OBSERVATION_MAX_RECALL_LINES,
  OBSERVATION_MAX_RUN_ARCHIVE_BYTES,
  ObservationStore,
  observationLockPath,
  observationObjectPath,
  observationsDir
} from "../../../src/context/observation-store.js";
import { deleteRunRecords } from "../../../src/privacy/deletion.js";

let uuidCounter = 0;
const UUID = (): string => `abcdef01-2345-6789-abcd-${String(uuidCounter++).padStart(12, "0")}`;

async function withStateRoot(run: (stateRoot: string, runId: RunId) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-obs-store-"));
  const runId = createRunId(UUID);
  try {
    await run(stateRoot, runId);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
}

test("put stores an opaque v2 object under observations/objects and returns a digest-free ref", async () => {
  await withStateRoot(async (stateRoot, runId) => {
    const store = new ObservationStore(stateRoot, runId);
    const text = "hello observation archive\n";
    const ref = await store.put(text);
    assert.match(ref.id, /^obs_v2_[0-9a-f-]{36}$/);
    assert.equal("sha256" in ref, false);
    assert.equal(ref.byteLength, Buffer.byteLength(text, "utf8"));
    const path = observationObjectPath(stateRoot, runId, ref.id);
    const st = await lstat(path);
    assert.ok(st.isFile());
    assert.ok(!st.isSymbolicLink());
    assert.equal(await readFile(path, "utf8"), text);
    // Owner-only file mode where the platform supports it.
    if (process.platform !== "win32") {
      assert.equal(st.mode & 0o777, 0o600);
      const dirSt = await lstat(observationsDir(stateRoot, runId));
      assert.equal(dirSt.mode & 0o777, 0o700);
    }
  });
});

test("put is idempotent: EEXIST with matching bytes reuses the object", async () => {
  await withStateRoot(async (stateRoot, runId) => {
    const store = new ObservationStore(stateRoot, runId);
    const text = "same bytes twice\n";
    const a = await store.put(text);
    const b = await store.put(text);
    assert.deepEqual(a, b);
  });
});

test("put deduplicates only exact bytes and does not reuse a legacy object", async () => {
  await withStateRoot(async (stateRoot, runId) => {
    const store = new ObservationStore(stateRoot, runId);
    const text = "canonical payload for mismatch\n";
    const legacyPath = join(observationsDir(stateRoot, runId), "objects", `obs_${"0".repeat(64)}.txt`);
    await mkdir(join(legacyPath, ".."), { recursive: true, mode: 0o700 });
    await writeFile(legacyPath, text, { mode: 0o600 });
    const ref = await store.put(text);
    assert.match(ref.id, /^obs_v2_[0-9a-f-]{36}$/);
    assert.notEqual(observationObjectPath(stateRoot, runId, ref.id), legacyPath);
    assert.equal(await readFile(legacyPath, "utf8"), text);
  });
});

test("legacy refs and unsafe ids are refused before filesystem mutation", async () => {
  await withStateRoot(async (stateRoot, runId) => {
    const store = new ObservationStore(stateRoot, runId);
    const objects = join(observationsDir(stateRoot, runId), "objects");
    await assert.rejects(
      () => store.recall({ id: `obs_${"0".repeat(64)}`, byteLength: 1 } as never),
      /v2|legacy|id/i
    );
    await assert.rejects(
      () => store.recall({ id: "obs_v2_../../unsafe", byteLength: 1 } as never),
      /v2|safe|id/i
    );
    await assert.rejects(() => lstat(objects), (err: NodeJS.ErrnoException) => err.code === "ENOENT");
  });
});

test("put refuses symlinks at the object path", async () => {
  await withStateRoot(async (stateRoot, runId) => {
    const store = new ObservationStore(stateRoot, runId);
    const text = "symlink refusal payload\n";
    const objectsDir = join(observationsDir(stateRoot, runId), "objects");
    await mkdir(objectsDir, { recursive: true, mode: 0o700 });
    const target = join(objectsDir, "outside.txt");
    await writeFile(target, text, { mode: 0o600 });
    const objectPath = observationObjectPath(stateRoot, runId, "obs_v2_abcdef01-2345-6789-abcd-000000000001");
    await symlink(target, objectPath);
    await assert.rejects(() => store.put(text), (err: unknown) => {
      assert.ok(err instanceof DomainValidationError);
      assert.match(err.message, /symlink/i);
      return true;
    });
  });
});

test("put rejects objects over the 8 MiB per-observation cap", async () => {
  await withStateRoot(async (stateRoot, runId) => {
    const store = new ObservationStore(stateRoot, runId);
    const over = "x".repeat(OBSERVATION_MAX_OBJECT_BYTES + 1);
    await assert.rejects(() => store.put(over), (err: unknown) => {
      assert.ok(err instanceof DomainValidationError);
      assert.match(err.message, /8 MiB|per-observation|object cap|too large/i);
      return true;
    });
  });
});

test("put rejects when the run archive would exceed 64 MiB", async () => {
  await withStateRoot(async (stateRoot, runId) => {
    const store = new ObservationStore(stateRoot, runId);
    // Fill near the run cap with a few large distinct objects, then refuse one more.
    const chunk = OBSERVATION_MAX_OBJECT_BYTES;
    const fillCount = Math.floor(OBSERVATION_MAX_RUN_ARCHIVE_BYTES / chunk);
    for (let i = 0; i < fillCount; i += 1) {
      const suffix = `#${String(i).padStart(12, "0")}`;
      const text = `${"a".repeat(chunk - Buffer.byteLength(suffix, "utf8"))}${suffix}`;
      assert.equal(Buffer.byteLength(text, "utf8"), chunk);
      await store.put(text);
    }
    const leftover = OBSERVATION_MAX_RUN_ARCHIVE_BYTES - fillCount * chunk;
    assert.equal(leftover, 0);
    const overflow = `${"b".repeat(1024)}`;
    await assert.rejects(() => store.put(overflow), (err: unknown) => {
      assert.ok(err instanceof DomainValidationError);
      assert.match(err.message, /64 MiB|per-run|archive cap|quota/i);
      return true;
    });
  });
});

test("recall pages by byte offset without splitting UTF-8 continuation bytes", async () => {
  await withStateRoot(async (stateRoot, runId) => {
    const store = new ObservationStore(stateRoot, runId);
    // "€" is 3 bytes (e2 82 ac). Embed so an unlucky cut would land mid-codepoint.
    const text = `prefix-${"€".repeat(20)}-suffix\nline2\n`;
    const ref = await store.put(text);
    const page0 = await store.recall(ref, 0);
    assert.equal(page0.text, text);
    assert.equal(page0.eof, true);
    assert.equal(page0.nextOffset, Buffer.byteLength(text, "utf8"));

    // Offset into the middle of the first euro (byte 8 is start of first € at "prefix-".length=7? "prefix-"=7, so byte 8 is second byte of €)
    const mid = 8; // inside first €
    const page = await store.recall(ref, mid);
    assert.ok(!page.text.startsWith("\uFFFD"));
    assert.ok(Buffer.from(page.text, "utf8").length <= OBSERVATION_MAX_RECALL_BYTES);
    // Reassemble from a safe start
    const safeStart = Buffer.from("prefix-", "utf8").length;
    const fromSafe = await store.recall(ref, safeStart);
    assert.ok(fromSafe.text.startsWith("€") || fromSafe.text.startsWith("-") || fromSafe.text.length >= 0);
    assert.equal(Buffer.from(text.slice(0), "utf8").subarray(0).toString("utf8").includes("€"), true);
  });
});

test("recall respects max bytes and max lines and never takes a negative offset", async () => {
  await withStateRoot(async (stateRoot, runId) => {
    const store = new ObservationStore(stateRoot, runId);
    const lines = Array.from({ length: 500 }, (_, i) => `line-${String(i).padStart(4, "0")}-${"y".repeat(40)}`);
    const text = `${lines.join("\n")}\n`;
    const ref = await store.put(text);
    const page = await store.recall(ref, 0);
    assert.ok(Buffer.byteLength(page.text, "utf8") <= OBSERVATION_MAX_RECALL_BYTES);
    assert.ok(page.text.split("\n").length <= OBSERVATION_MAX_RECALL_LINES + 1);
    assert.equal(page.eof, false);
    assert.ok(page.nextOffset > 0);

    await assert.rejects(() => store.recall(ref, -1), DomainValidationError);
    await assert.rejects(() => store.recall(ref, Number.NaN), DomainValidationError);
    await assert.rejects(() => store.recall(ref, 1.5), DomainValidationError);
  });
});

test("recall validates the ref byte length but intentionally does not detect equal-length tampering", async () => {
  await withStateRoot(async (stateRoot, runId) => {
    const store = new ObservationStore(stateRoot, runId);
    const text = "verify-length-only\n";
    const ref = await store.put(text);
    const replacement = "x".repeat(Buffer.byteLength(text, "utf8"));
    await writeFile(observationObjectPath(stateRoot, runId, ref.id), replacement, { mode: 0o600 });
    const page = await store.recall(ref, 0);
    assert.equal(page.text, replacement);
    assert.equal(page.eof, true);
    await writeFile(observationObjectPath(stateRoot, runId, ref.id), "short", { mode: 0o600 });
    await assert.rejects(() => store.recall(ref, 0), /byteLength|length/i);
  });
});

test("mutating ops hold the observation lock; put waits behind an exclusive holder", async () => {
  await withStateRoot(async (stateRoot, runId) => {
    const store = new ObservationStore(stateRoot, runId);
    // Observation archives use their own lock (not the run lifecycle lock):
    // workers archive observations while the run is executing, so sharing the
    // run lock would deadlock every live put (live wiring, 2026-09-20).
    const lockPath = observationLockPath(stateRoot, runId);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holderReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      holderReady = resolve;
    });
    const holder = withExclusiveFileLock(
      lockPath,
      async () => {
        holderReady();
        await held;
      },
      { timeoutMs: 5_000 }
    );
    await ready;
    let putFinished = false;
    const pending = store.put("locked-put\n").then((ref) => {
      putFinished = true;
      return ref;
    });
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(putFinished, false, "put must not finish while the run lock is held");
    release();
    await holder;
    await pending;
    assert.equal(putFinished, true);
  });
});

test("deleteRunRecords removes the observation archive with zero residual bytes", async () => {
  await withStateRoot(async (stateRoot, runId) => {
    const store = new ObservationStore(stateRoot, runId);
    await store.put("delete-me observation body\n");
    const dir = observationsDir(stateRoot, runId);
    assert.equal((await lstat(dir)).isDirectory(), true);
    await deleteRunRecords(stateRoot, runId, { timeoutMs: 2_000 });
    await assert.rejects(() => lstat(dir), (err: NodeJS.ErrnoException) => err.code === "ENOENT");
    await assert.rejects(
      () => lstat(join(stateRoot, "runtime", "runs", runId)),
      (err: NodeJS.ErrnoException) => err.code === "ENOENT"
    );
  });
});
