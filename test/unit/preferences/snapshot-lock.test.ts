import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { main, type CliIo } from "../../../src/cli/main.js";
import { parseCliErrorJson } from "../../../src/cli/errors.js";
import type { DoctorJsonReport } from "../../../src/cli/doctor.js";
import { adaptationRoot } from "../../../src/privacy/state-layout.js";
import {
  preferenceSnapshotLockPath,
  preferenceSnapshotPath
} from "../../../src/preferences/store.js";
import {
  clearAll,
  configurePreferencePersistence,
  recordExplicitPreference
} from "../../../src/preferences/service.js";
import { createEpisodeId } from "../../../src/domain/ids.js";

/**
 * The cross-process read-modify-write guard on `adaptation/preferences.json`.
 *
 * `pref correct` and `pref delete` load the whole snapshot and persist the
 * whole in-memory state, so an unsynchronized pair of them silently loses one
 * side's work — including a `pref delete` whose tombstone a concurrent
 * `pref correct` writes back out, resurrecting an observation the CLI already
 * reported deleted. These tests hold the lock from outside the CLI, which is
 * exactly what another process does, and pin what a mutator must do: wait, or
 * fail closed typed having written nothing; and derive what it persists from
 * bytes read *inside* the lock rather than from whatever it had loaded before
 * acquiring it.
 */

interface Snapshot {
  readonly observations: Array<{ id: string; key: string; value: unknown }>;
  readonly tombstones: string[];
}

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { stdout: (text) => out.push(text), stderr: (text) => err.push(text) }, out, err };
}

async function withPrefRoot(run: (stateRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-pref-lock-"));
  try {
    configurePreferencePersistence(undefined);
    clearAll();
    await run(stateRoot);
  } finally {
    configurePreferencePersistence(undefined);
    clearAll();
    await rm(stateRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(
      () => undefined
    );
  }
}

/**
 * Seeds one explicit observation through the store and leaves the store bound
 * to that snapshot — the in-memory state a mutator carries into its command.
 */
function seedObservation(stateRoot: string, value: string): string {
  configurePreferencePersistence(preferenceSnapshotPath(stateRoot));
  return recordExplicitPreference("user", "u1", "format", value, createEpisodeId()).id;
}

async function readSnapshot(stateRoot: string): Promise<Snapshot> {
  return JSON.parse(await readFile(preferenceSnapshotPath(stateRoot), "utf8")) as Snapshot;
}

function prefCorrect(stateRoot: string, value: string, ...extra: string[]): string[] {
  return [
    "pref",
    "correct",
    "--scope",
    "user",
    "--scope-key",
    "u1",
    "--key",
    "format",
    "--value",
    value,
    ...extra,
    "--state-root",
    stateRoot
  ];
}

/**
 * Takes the snapshot lock the way another process does — `wx` plus the owner
 * record `withExclusiveFileLock` writes — and returns its release. Nothing
 * here steals or adopts: release removes only the file this call created.
 */
async function holdSnapshotLock(stateRoot: string): Promise<() => Promise<void>> {
  const lockPath = preferenceSnapshotLockPath(stateRoot);
  await mkdir(dirname(lockPath), { recursive: true });
  const handle = await open(lockPath, "wx");
  await handle.writeFile(
    JSON.stringify({
      ownerToken: "test-holder",
      pid: process.pid,
      acquiredAt: new Date().toISOString()
    }),
    "utf8"
  );
  return async () => {
    await handle.close();
    await rm(lockPath, { force: true });
  };
}

/** Yields the loop long enough that a lock waiter would have finished if it could. */
async function letTheWaiterTry(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test("the snapshot lock is a *.lock sidecar under the state root, where doctor inventories it", () => {
  const stateRoot = join(tmpdir(), "pi-sparkle-pref-lock-path");
  assert.equal(
    preferenceSnapshotPath(stateRoot),
    join(adaptationRoot(stateRoot), "preferences.json")
  );
  assert.equal(preferenceSnapshotLockPath(stateRoot), `${preferenceSnapshotPath(stateRoot)}.lock`);
  // Doctor's lock inventory walks the state root for `*.lock` and needs no
  // change to pick this one up; these two facts are the whole precondition.
  assert.ok(preferenceSnapshotLockPath(stateRoot).endsWith(".lock"));
  assert.ok(preferenceSnapshotLockPath(stateRoot).startsWith(stateRoot));
});

test("doctor inventories a held preferences lock with no doctor-side change", async () => {
  await withPrefRoot(async (stateRoot) => {
    seedObservation(stateRoot, "compact");
    const release = await holdSnapshotLock(stateRoot);
    try {
      const doctor = capture();
      await main(["doctor", "--json", "--state-root", stateRoot], doctor.io);
      const report = JSON.parse(doctor.out.join("")) as DoctorJsonReport;
      const entry = report.locks.entries.find(
        (candidate) => candidate.path === preferenceSnapshotLockPath(stateRoot)
      );
      assert.ok(entry, "the preferences lock must show up in doctor's lock inventory");
      assert.equal(entry.metadata, "valid");
      assert.equal(entry.pid, process.pid);
    } finally {
      await release();
    }
    // Doctor never acquires, steals or deletes a lock it inventories.
    assert.equal(existsSync(preferenceSnapshotPath(stateRoot)), true);
  });
});

test("pref delete fails closed with the typed lock timeout and writes nothing", async () => {
  await withPrefRoot(async (stateRoot) => {
    const id = seedObservation(stateRoot, "compact");
    const before = await readFile(preferenceSnapshotPath(stateRoot), "utf8");
    const release = await holdSnapshotLock(stateRoot);
    try {
      const { io, err } = capture();
      const code = await main(
        ["pref", "delete", "--id", id, "--lock-wait-ms", "0", "--state-root", stateRoot],
        io
      );
      assert.equal(code, 1);
      const report = parseCliErrorJson(err.join(""));
      assert.equal(report?.command, "pref");
      assert.equal(report?.stage, "validation");
      assert.match(report?.message ?? "", /timed out waiting for lock at .*preferences\.json\.lock/);
      // The doctor route is keyed on the frozen LOCK_TIMEOUT code and never on
      // message text, so seeing it is what proves the failure was the typed one.
      assert.match(report?.next ?? "", /doctor --json --state-root/);
      assert.match(report?.next ?? "", /locks\[\]/);
      assert.equal(
        await readFile(preferenceSnapshotPath(stateRoot), "utf8"),
        before,
        "a refused pref delete must leave the snapshot byte-identical"
      );
    } finally {
      await release();
    }
  });
});

test("pref correct fails closed with the typed lock timeout and writes nothing", async () => {
  await withPrefRoot(async (stateRoot) => {
    seedObservation(stateRoot, "compact");
    const before = await readFile(preferenceSnapshotPath(stateRoot), "utf8");
    const release = await holdSnapshotLock(stateRoot);
    try {
      const { io, err } = capture();
      const code = await main(prefCorrect(stateRoot, "roomy", "--lock-wait-ms", "0"), io);
      assert.equal(code, 1);
      const report = parseCliErrorJson(err.join(""));
      assert.equal(report?.stage, "validation");
      assert.match(report?.message ?? "", /timed out waiting for lock at .*preferences\.json\.lock/);
      assert.match(report?.next ?? "", /locks\[\]/);
      assert.equal(
        await readFile(preferenceSnapshotPath(stateRoot), "utf8"),
        before,
        "a refused pref correct must leave the snapshot byte-identical"
      );
    } finally {
      await release();
    }
  });
});

test("a second mutator waits for the lock instead of writing beside the holder", async () => {
  await withPrefRoot(async (stateRoot) => {
    seedObservation(stateRoot, "compact");
    const release = await holdSnapshotLock(stateRoot);
    let settled = false;
    const pending = main(prefCorrect(stateRoot, "roomy"), capture().io).then((code) => {
      settled = true;
      return code;
    });

    await letTheWaiterTry();
    assert.equal(settled, false, "the mutator must block while another writer holds the lock");
    assert.equal(
      (await readSnapshot(stateRoot)).observations.length,
      1,
      "nothing may be written while blocked"
    );

    await release();
    assert.equal(await pending, 0);
    assert.equal((await readSnapshot(stateRoot)).observations.length, 2);
  });
});

test("a correction bound before a delete cannot revert the delete's tombstone", async () => {
  await withPrefRoot(async (stateRoot) => {
    // The store is bound and holds the pre-delete snapshot in memory: exactly
    // what a `pref correct` had loaded before a concurrent `pref delete` wrote.
    // Persisting that state would resurrect the deleted observation.
    const id = seedObservation(stateRoot, "compact");

    const release = await holdSnapshotLock(stateRoot);
    let settled = false;
    const correcting = main(prefCorrect(stateRoot, "roomy"), capture().io).then((code) => {
      settled = true;
      return code;
    });
    await letTheWaiterTry();
    assert.equal(settled, false, "the correction must not bind or write while the delete holds");

    // The holder is the delete: it publishes the tombstoned snapshot and only
    // then releases, so the waiting correction has to load these bytes.
    await writeFile(
      preferenceSnapshotPath(stateRoot),
      JSON.stringify({ observations: [], tombstones: [id] }),
      "utf8"
    );
    await release();
    assert.equal(await correcting, 0);

    const after = await readSnapshot(stateRoot);
    assert.deepEqual(after.tombstones, [id], "the delete's tombstone must survive the next write");
    assert.equal(
      after.observations.some((row) => row.id === id),
      false,
      "the deleted observation must not be resurrected"
    );
    assert.equal(after.observations.length, 1);
    assert.equal(after.observations[0]?.value, "roomy");
  });
});

test("a released lock leaves no lock file behind", async () => {
  await withPrefRoot(async (stateRoot) => {
    const lockPath = preferenceSnapshotLockPath(stateRoot);
    const correct = capture();
    assert.equal(await main(prefCorrect(stateRoot, "compact"), correct.io), 0);
    assert.equal(existsSync(lockPath), false, "pref correct must release its lock");

    const id = correct.out.join("").match(/recorded explicit preference (\S+)/)?.[1];
    assert.ok(id);
    assert.equal(
      await main(["pref", "delete", "--id", id, "--state-root", stateRoot], capture().io),
      0
    );
    assert.equal(existsSync(lockPath), false, "pref delete must release its lock");

    // A delete that finds nothing leaves through the same release path.
    assert.equal(
      await main(["pref", "delete", "--id", id, "--state-root", stateRoot], capture().io),
      1
    );
    assert.equal(existsSync(lockPath), false, "a not-found pref delete must release its lock too");
  });
});

test("a pref mutation refused on its arguments never asks for the lock", async () => {
  await withPrefRoot(async (stateRoot) => {
    const release = await holdSnapshotLock(stateRoot);
    try {
      // The lock is held, so anything that asked for it would block for the
      // full default wait and then report a lock timeout instead of this.
      const bad = capture();
      assert.equal(
        await main(
          [
            "pref",
            "correct",
            "--scope",
            "bogus",
            "--scope-key",
            "u1",
            "--key",
            "k",
            "--value",
            "v",
            "--state-root",
            stateRoot
          ],
          bad.io
        ),
        1
      );
      assert.match(bad.err.join(""), /--scope/);
      assert.equal(parseCliErrorJson(bad.err.join("")), undefined);

      const noId = capture();
      assert.equal(await main(["pref", "delete", "--state-root", stateRoot], noId.io), 1);
      assert.match(noId.err.join(""), /--id/);
      assert.equal(parseCliErrorJson(noId.err.join("")), undefined);
    } finally {
      await release();
    }
    assert.equal(
      existsSync(preferenceSnapshotPath(stateRoot)),
      false,
      "a refused invocation must not bind or publish a snapshot"
    );
  });
});

test("--lock-wait-ms is validated before the lock is asked for", async () => {
  await withPrefRoot(async (stateRoot) => {
    const { io, err } = capture();
    const code = await main(
      ["pref", "delete", "--id", "pref_x", "--lock-wait-ms", "1e4", "--state-root", stateRoot],
      io
    );
    assert.equal(code, 1);
    assert.match(
      parseCliErrorJson(err.join(""))?.message ?? "",
      /--lock-wait-ms must be a whole number/
    );
    assert.equal(existsSync(preferenceSnapshotLockPath(stateRoot)), false);
  });
});
