import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { main, type CliIo } from "../../../src/cli/main.js";
import { clearAll, configurePreferencePersistence } from "../../../src/preferences/service.js";
import {
  preferenceSnapshotLockPath,
  preferenceSnapshotPath
} from "../../../src/preferences/store.js";

const REPO_ROOT = process.cwd();
const execFileAsync = promisify(execFile);

/** One real `pi-sparkle` process, so the snapshot lock is exercised across processes. */
async function runCli(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--import", "tsx", "src/cli/main.ts", ...args],
    { cwd: REPO_ROOT, encoding: "utf8" }
  );
  return stdout;
}

/**
 * Holds the snapshot lock the way another process does — `wx` plus the owner
 * record `withExclusiveFileLock` writes. Release removes only this file.
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

/**
 * Long enough for a spawned `tsx` CLI to have reached its mutation had nothing
 * held it back. A lock-respecting child is merely slower by this much; only an
 * unlocked one gets far enough to be caught by it.
 */
const CHILD_REACHES_ITS_MUTATION_MS = 1_500;

interface Snapshot {
  readonly observations: Array<{ id: string; value: unknown }>;
  readonly tombstones: string[];
}

async function readSnapshot(stateRoot: string): Promise<Snapshot> {
  return JSON.parse(await readFile(preferenceSnapshotPath(stateRoot), "utf8")) as Snapshot;
}

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text),
    },
    out,
    err,
  };
}

beforeEach(() => {
  configurePreferencePersistence(undefined);
  clearAll();
});

async function withPrefRoot(run: (stateRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-pref-cli-"));
  try {
    await run(stateRoot);
  } finally {
    configurePreferencePersistence(undefined);
    clearAll();
    await rm(stateRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => undefined);
  }
}

function withRoot(stateRoot: string, args: string[]): string[] {
  return [...args, "--state-root", stateRoot];
}

describe("M4-T5: preference CLI workflow", () => {
  it("pref correct records an explicit preference visible to pref list", async () => {
    await withPrefRoot(async (stateRoot) => {
      const { io, out, err } = capture();
      const code = await main(
        withRoot(stateRoot, [
          "pref",
          "correct",
          "--scope",
          "user",
          "--scope-key",
          "u1",
          "--key",
          "format",
          "--value",
          "compact"
        ]),
        io
      );
      assert.equal(code, 0);
      assert.match(out.join(""), /recorded explicit preference/);
      assert.deepEqual(err, []);

      const list = capture();
      const listCode = await main(withRoot(stateRoot, ["pref", "list", "--scope", "user"]), list.io);
      assert.equal(listCode, 0);
      const text = list.out.join("");
      assert.match(text, /format=compact/);
      assert.match(text, /explicit=true/);
    });
  });

  it("pref list shows the materialized view with confidence and scope", async () => {
    await withPrefRoot(async (stateRoot) => {
      await main(
        withRoot(stateRoot, [
          "pref",
          "correct",
          "--scope",
          "project",
          "--scope-key",
          "p1",
          "--key",
          "ci",
          "--value",
          "strict"
        ]),
        capture().io
      );
      const list = capture();
      await main(withRoot(stateRoot, ["pref", "list"]), list.io);
      const text = list.out.join("");
      assert.match(text, /\[project:p1\]/);
      assert.match(text, /ci=strict/);
      assert.match(text, /confidence=/);
    });
  });

  it("pref export restricts to authorized scopes", async () => {
    await withPrefRoot(async (stateRoot) => {
      await main(
        withRoot(stateRoot, [
          "pref",
          "correct",
          "--scope",
          "user",
          "--scope-key",
          "u1",
          "--key",
          "format",
          "--value",
          "compact"
        ]),
        capture().io
      );
      await main(
        withRoot(stateRoot, [
          "pref",
          "correct",
          "--scope",
          "project",
          "--scope-key",
          "p1",
          "--key",
          "ci",
          "--value",
          "strict"
        ]),
        capture().io
      );

      const exp = capture();
      const code = await main(withRoot(stateRoot, ["pref", "export", "--scope", "project"]), exp.io);
      assert.equal(code, 0);
      const parsed = JSON.parse(exp.out.join("")) as {
        count: number;
        observations: Array<{ scope: string }>;
      };
      assert.equal(parsed.count, 1);
      assert.ok(parsed.observations.every((o) => o.scope === "project"));
    });
  });

  it("pref delete tombstones a preference and removes it from the list", async () => {
    await withPrefRoot(async (stateRoot) => {
      const correct = capture();
      await main(
        withRoot(stateRoot, [
          "pref",
          "correct",
          "--scope",
          "user",
          "--scope-key",
          "u1",
          "--key",
          "format",
          "--value",
          "compact"
        ]),
        correct.io
      );
      const idMatch = correct.out.join("").match(/recorded explicit preference (\S+)/);
      assert.ok(idMatch);
      const id = idMatch![1]!;

      const del = capture();
      const code = await main(withRoot(stateRoot, ["pref", "delete", "--id", id]), del.io);
      assert.equal(code, 0);
      assert.match(del.out.join(""), /tombstoned/);

      const list = capture();
      await main(withRoot(stateRoot, ["pref", "list"]), list.io);
      assert.doesNotMatch(list.out.join(""), /format=compact/);

      const again = capture();
      assert.equal(await main(withRoot(stateRoot, ["pref", "delete", "--id", id]), again.io), 1);
      assert.match(again.out.join(""), /not found/);
    });
  });

  it("rejects unknown preference scopes", async () => {
    await withPrefRoot(async (stateRoot) => {
      const { io, err } = capture();
      const code = await main(
        withRoot(stateRoot, [
          "pref",
          "correct",
          "--scope",
          "bogus",
          "--scope-key",
          "u1",
          "--key",
          "k",
          "--value",
          "v"
        ]),
        io
      );
      assert.equal(code, 1);
      assert.match(err.join(""), /scope/);
    });
  });

  it("pref delete requires an id", async () => {
    await withPrefRoot(async (stateRoot) => {
      const { io, err } = capture();
      const code = await main(withRoot(stateRoot, ["pref", "delete"]), io);
      assert.equal(code, 1);
      assert.match(err.join(""), /--id/);
    });
  });

  /**
   * The P1 this lock exists for, with the mutator in a real second process:
   * a `pref delete` that printed success must stay true on disk.
   *
   * Both mutators rewrite the whole snapshot from the whole state they loaded,
   * so unsynchronized they are last-writer-wins in both directions. Here this
   * process plays the concurrent `pref correct` — it publishes a snapshot in
   * which the observation is still live — while a genuine child process runs
   * the delete. Unlocked, the child loads before that publish and writes after
   * it, and the tombstone is gone with no error anywhere. Locked, the child
   * cannot load until the publish is done, so it tombstones out of the bytes
   * that were actually on disk.
   *
   * The interleaving is forced rather than raced: the child is launched into a
   * held lock, so what it does next is a property of the code, not of process
   * scheduling.
   */
  it("a pref delete in another process stays true on disk against a concurrent write", async () => {
    await withPrefRoot(async (stateRoot) => {
      const seed = capture();
      await main(
        withRoot(stateRoot, [
          "pref",
          "correct",
          "--scope",
          "user",
          "--scope-key",
          "u1",
          "--key",
          "format",
          "--value",
          "compact"
        ]),
        seed.io
      );
      const id = seed.out.join("").match(/recorded explicit preference (\S+)/)?.[1];
      assert.ok(id);
      const seeded = await readSnapshot(stateRoot);

      const release = await holdSnapshotLock(stateRoot);
      const deleting = runCli(
        withRoot(stateRoot, ["pref", "delete", "--id", id, "--lock-wait-ms", "60000"])
      );
      await new Promise((resolve) => setTimeout(resolve, CHILD_REACHES_ITS_MUTATION_MS));

      // The concurrent correction publishes while the delete is still waiting:
      // the original observation is live again in these bytes, tombstones empty.
      await writeFile(
        preferenceSnapshotPath(stateRoot),
        JSON.stringify({
          observations: [...seeded.observations, { ...seeded.observations[0], id: "pref_other" }],
          tombstones: []
        }),
        "utf8"
      );
      await release();

      assert.match(await deleting, new RegExp(`tombstoned preference ${id}`));
      const after = await readSnapshot(stateRoot);
      assert.deepEqual(after.tombstones, [id], "the reported delete must stay true on disk");
      assert.equal(
        after.observations.some((row) => row.id === id),
        false,
        "the deleted observation must not survive the delete that reported success"
      );
      assert.equal(
        after.observations.some((row) => row.id === "pref_other"),
        true,
        "the concurrent write must not be lost either"
      );
      assert.equal(existsSync(preferenceSnapshotLockPath(stateRoot)), false);
    });
  });

  /**
   * The same pair with nothing forcing the interleaving: two real processes,
   * started together, each doing a whole mutation. Serialized, the two possible
   * orders converge on one state, which is what lets this assert an exact
   * result rather than "one of two acceptable outcomes" — delete-then-correct
   * leaves the tombstone plus the correction, and correct-then-delete records
   * the correction and then tombstones the original id out of the snapshot it
   * just wrote.
   *
   * This is an end-to-end smoke check over the real spawn path, not the
   * regression net: whether the two windows actually overlap is up to process
   * scheduling. The forced-interleaving proofs are the test above and
   * `test/unit/preferences/snapshot-lock.test.ts`.
   */
  it("two concurrent pref mutator processes converge on one snapshot", async () => {
    await withPrefRoot(async (stateRoot) => {
      const seed = capture();
      await main(
        withRoot(stateRoot, [
          "pref",
          "correct",
          "--scope",
          "user",
          "--scope-key",
          "u1",
          "--key",
          "format",
          "--value",
          "compact"
        ]),
        seed.io
      );
      const id = seed.out.join("").match(/recorded explicit preference (\S+)/)?.[1];
      assert.ok(id);

      const wait = ["--lock-wait-ms", "60000"];
      const [deleteOut, correctOut] = await Promise.all([
        runCli(withRoot(stateRoot, ["pref", "delete", "--id", id, ...wait])),
        runCli(
          withRoot(stateRoot, [
            "pref",
            "correct",
            "--scope",
            "user",
            "--scope-key",
            "u1",
            "--key",
            "format",
            "--value",
            "roomy",
            ...wait
          ])
        )
      ]);
      assert.match(deleteOut, new RegExp(`tombstoned preference ${id}`));
      assert.match(correctOut, /recorded explicit preference/);

      const snapshot = await readSnapshot(stateRoot);
      assert.deepEqual(snapshot.tombstones, [id], "the reported delete must stay true on disk");
      assert.equal(
        snapshot.observations.some((row) => row.id === id),
        false,
        "the deleted observation must not be resurrected by the concurrent correction"
      );
      assert.equal(snapshot.observations.length, 1, "the concurrent correction must not be lost");
      assert.equal(snapshot.observations[0]?.value, "roomy");
      assert.equal(
        existsSync(preferenceSnapshotLockPath(stateRoot)),
        false,
        "both processes must release the lock"
      );
    });
  });

  it("help mentions the pref workflow", async () => {
    const { io, out } = capture();
    const code = await main(["help"], io);
    assert.equal(code, 0);
    assert.match(out.join(""), /pref (list|correct|export|delete)/);
  });
});
