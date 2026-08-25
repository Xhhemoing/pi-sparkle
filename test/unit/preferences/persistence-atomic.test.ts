import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { createEpisodeId } from "../../../src/domain/ids.js";
import {
  PREFERENCE_SNAPSHOT_UNREADABLE_CODE,
  PreferenceSnapshotUnreadableError,
  configurePreferencePersistence,
  deleteObservation,
  listObservations,
  recordPreference,
  resetPreferenceStore,
} from "../../../src/preferences/store.js";

const episodeId = createEpisodeId();

afterEach(() => {
  configurePreferencePersistence(undefined);
  resetPreferenceStore();
});

async function withDir(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "pi-sparkle-pref-atomic-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(
      () => undefined
    );
  }
}

async function tempFiles(directory: string): Promise<string[]> {
  return (await readdir(directory)).filter((entry) => entry.endsWith(".tmp")).toSorted();
}

function explicit(key: string, value: string) {
  return recordPreference("user", "u1", key, value, episodeId, 1.0, true);
}

/** Writes `body` where the store expects its snapshot, without going through the store. */
async function plant(file: string, body: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, body, "utf8");
}

describe("R4-9: preferences.json is published atomically and read fail-closed", () => {
  it("persists through a temp-and-rename, creating the directory and leaving no temp behind", async () => {
    await withDir(async (directory) => {
      const file = join(directory, "adaptation", "preferences.json");
      configurePreferencePersistence(file);
      const obs = explicit("format", "compact");

      const raw = await readFile(file, "utf8");
      // Byte-for-byte the shape the previous writer published: an episode delete still has to
      // leave this file identical (`test/unit/privacy/deletion.test.ts`).
      assert.equal(raw, JSON.stringify({ observations: [obs], tombstones: [] }));
      assert.deepEqual(await tempFiles(dirname(file)), []);

      assert.equal(deleteObservation(obs.id), true);
      assert.equal(
        await readFile(file, "utf8"),
        JSON.stringify({ observations: [], tombstones: [obs.id] })
      );
      assert.deepEqual(await tempFiles(dirname(file)), []);
    });
  });

  it("does not adopt or truncate a temp left behind by a crashed writer", async () => {
    await withDir(async (directory) => {
      const file = join(directory, "preferences.json");
      const abandoned = `${file}.999999.crashed.tmp`;
      await plant(abandoned, '{"observations":[{"id":"half');

      configurePreferencePersistence(file);
      const obs = explicit("format", "compact");

      assert.equal(
        await readFile(file, "utf8"),
        JSON.stringify({ observations: [obs], tombstones: [] })
      );
      assert.equal(await readFile(abandoned, "utf8"), '{"observations":[{"id":"half');
    });
  });

  it("a valid snapshot still round-trips observations and tombstones", async () => {
    await withDir(async (directory) => {
      const file = join(directory, "preferences.json");
      configurePreferencePersistence(file);
      const kept = explicit("format", "compact");
      const dropped = explicit("length", "short");
      assert.equal(deleteObservation(dropped.id), true);

      configurePreferencePersistence(undefined);
      resetPreferenceStore();
      configurePreferencePersistence(file);

      assert.deepEqual(listObservations().map((row) => row.id), [kept.id]);
    });
  });

  it("an unreadable snapshot throws a typed error and never resets the store to empty", async () => {
    await withDir(async (directory) => {
      const bound = join(directory, "bound.json");
      const damaged = join(directory, "damaged.json");
      configurePreferencePersistence(bound);
      const kept = explicit("format", "compact");
      const boundBytes = await readFile(bound, "utf8");
      const damagedBytes = '{"observations":[{"id":"pref_1","scope":"user","sc';
      await plant(damaged, damagedBytes);

      const error = (() => {
        try {
          configurePreferencePersistence(damaged);
          return undefined;
        } catch (thrown: unknown) {
          return thrown;
        }
      })();

      assert.ok(
        error instanceof PreferenceSnapshotUnreadableError,
        `unexpected error ${String(error)}`
      );
      assert.equal(error.code, PREFERENCE_SNAPSHOT_UNREADABLE_CODE);
      assert.equal(error.name, "PreferenceSnapshotUnreadableError");
      assert.equal(error.path, damaged);
      assert.ok(error instanceof DomainValidationError);
      assert.ok(error.cause instanceof SyntaxError);

      // Fail closed on both sides: the in-memory history is intact, and the store still
      // persists where it did before, so nothing overwrote the file it could not read.
      assert.deepEqual(listObservations().map((row) => row.id), [kept.id]);
      const second = explicit("length", "short");
      assert.equal(await readFile(damaged, "utf8"), damagedBytes);
      assert.notEqual(await readFile(bound, "utf8"), boundBytes);
      assert.deepEqual(
        (JSON.parse(await readFile(bound, "utf8")) as { observations: { id: string }[] }).observations.map(
          (row) => row.id
        ),
        [kept.id, second.id]
      );
    });
  });

  it("an empty snapshot file is damage, not a user who has never expressed a preference", async () => {
    await withDir(async (directory) => {
      const file = join(directory, "preferences.json");
      await plant(file, "");
      assert.throws(() => configurePreferencePersistence(file), {
        code: PREFERENCE_SNAPSHOT_UNREADABLE_CODE,
      });
      // Unbound, so a later observation cannot land on top of the damaged file.
      explicit("format", "compact");
      assert.equal(await readFile(file, "utf8"), "");
    });
  });

  it("rejects snapshot shapes that would otherwise read as an empty history", async () => {
    await withDir(async (directory) => {
      const file = join(directory, "preferences.json");
      const rejected = [
        "[]",
        "null",
        '"preferences"',
        '{"observations":"nope"}',
        '{"observations":[1,2]}',
        '{"observations":[null]}',
        '{"tombstones":{"a":1}}',
        '{"tombstones":[7]}',
      ];
      for (const body of rejected) {
        await plant(file, body);
        assert.throws(
          () => configurePreferencePersistence(file),
          { code: PREFERENCE_SNAPSHOT_UNREADABLE_CODE },
          body
        );
        assert.equal(await readFile(file, "utf8"), body);
      }
    });
  });

  it("keeps the write on the shared atomic writer rather than a private temp-and-rename", async () => {
    // In-process sync writes cannot interleave, so the tear window this slot closed is only
    // observable across processes; what is checkable here is that the store still delegates.
    // `writeFileAtomicSync`'s own publish protocol is pinned in test/unit/persist/.
    const source = await readFile("src/preferences/store.ts", "utf8");
    assert.match(source, /writeFileAtomicSync\(/);
    assert.doesNotMatch(source, /writeFileSync\(/);
    assert.doesNotMatch(source, /renameSync\(/);
  });

  it("accepts a snapshot that legitimately carries no history", async () => {
    await withDir(async (directory) => {
      const file = join(directory, "preferences.json");
      for (const body of ["{}", '{"observations":[]}', '{"observations":[],"tombstones":[]}']) {
        await plant(file, body);
        configurePreferencePersistence(file);
        assert.deepEqual(listObservations(), [], body);
        configurePreferencePersistence(undefined);
        resetPreferenceStore();
      }
    });
  });
});
