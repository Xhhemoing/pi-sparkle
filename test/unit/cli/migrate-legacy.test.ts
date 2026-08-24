import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { migrateLegacyCommand, planLegacyMigration } from "../../../src/cli/migrate-legacy.js";
import type { MigrateLegacyIo } from "../../../src/cli/migrate-legacy.js";
import { adaptationRoot, runtimeRoot } from "../../../src/privacy/state-layout.js";
import { readFeedback } from "../../../src/feedback/store.js";

/**
 * 2026-08-22 weak-area report §2.2: flat pre-split state (`feedback/records.jsonl`,
 * `runs/<id>/events.jsonl` at the state root) is invisible to plane-aware code
 * — readFeedback returns [] and EventStore returns [], with no error. These
 * tests pin the recovery path, including the two rules that make it safe to
 * run on a real install: planes never mix, and sources are never deleted.
 */

interface Captured {
  readonly io: MigrateLegacyIo;
  readonly out: () => string;
  readonly err: () => string;
}

function capture(): Captured {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (text) => out.push(text), stderr: (text) => err.push(text) },
    out: () => out.join(""),
    err: () => err.join("")
  };
}

async function withStateRoot(run: (stateRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-migrate-"));
  try {
    await run(stateRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
}

async function writeFileAt(path: string, body: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body, "utf8");
}

const FEEDBACK_LINE = JSON.stringify({
  id: "fbk_1",
  episodeId: "ep_1",
  kind: "user",
  score: 1
});

const EVENT_LINE = JSON.stringify({ id: "evt_1", type: "RUN_STARTED", runId: "run_legacy" });

/** A flat state root as it looked before the 2026-08-22 plane split. */
async function seedLegacy(stateRoot: string): Promise<void> {
  await writeFileAt(join(stateRoot, "feedback", "records.jsonl"), `${FEEDBACK_LINE}\n`);
  await writeFileAt(join(stateRoot, "feedback", "tombstones.json"), "[]");
  await writeFileAt(join(stateRoot, "runs", "run_legacy", "events.jsonl"), `${EVENT_LINE}\n`);
  await writeFileAt(join(stateRoot, "runs", "run_legacy", "checkpoint.json"), '{"status":"COMPLETED"}');
  await writeFileAt(join(stateRoot, "episodes", "ep_1.jsonl"), '{"id":"ep_1"}\n');
  await writeFileAt(join(stateRoot, "invocations.jsonl"), '{"id":"inv_1"}\n');
}

describe("migrate-legacy discovery", () => {
  it("reports nothing to do on a state root with no legacy files", async () => {
    await withStateRoot(async (stateRoot) => {
      const captured = capture();
      const code = await migrateLegacyCommand(["--state-root", stateRoot], captured.io);
      assert.equal(code, 0, "an empty scan is a clean exit");
      assert.match(captured.out(), /no legacy files found/);
    });
  });

  it("ignores files that already live in a plane directory", async () => {
    await withStateRoot(async (stateRoot) => {
      await writeFileAt(join(runtimeRoot(stateRoot), "runs", "run_new", "events.jsonl"), `${EVENT_LINE}\n`);
      await writeFileAt(join(adaptationRoot(stateRoot), "feedback", "records.jsonl"), `${FEEDBACK_LINE}\n`);
      const plan = await planLegacyMigration(stateRoot);
      assert.deepEqual(plan.items, [], "plane-resident data is not legacy data");
    });
  });

  it("routes every legacy source to exactly one plane", async () => {
    await withStateRoot(async (stateRoot) => {
      await seedLegacy(stateRoot);
      const plan = await planLegacyMigration(stateRoot);
      const planeOf = new Map(plan.items.map((item) => [item.relativePath, item.plane]));
      assert.equal(planeOf.get("feedback/records.jsonl"), "adaptation");
      assert.equal(planeOf.get("feedback/tombstones.json"), "adaptation");
      assert.equal(planeOf.get("runs/run_legacy/events.jsonl"), "runtime");
      assert.equal(planeOf.get("runs/run_legacy/checkpoint.json"), "runtime");
      assert.equal(planeOf.get("episodes/ep_1.jsonl"), "runtime");
      assert.equal(planeOf.get("invocations.jsonl"), "runtime");
      assert.equal(plan.items.length, 6);
    });
  });
});

describe("migrate-legacy dry run", () => {
  it("describes the copies without writing anything, and signals pending work", async () => {
    await withStateRoot(async (stateRoot) => {
      await seedLegacy(stateRoot);
      const captured = capture();
      const code = await migrateLegacyCommand(["--state-root", stateRoot], captured.io);

      assert.equal(code, 1, "pending work is reported through a non-zero exit");
      assert.match(captured.out(), /dry run \(no files written\)/);
      assert.match(
        captured.out(),
        /would copy: feedback\/records\.jsonl -> adaptation\/feedback\/records\.jsonl \(1 record\(s\)\)/
      );
      assert.match(
        captured.out(),
        /would copy: runs\/run_legacy\/events\.jsonl -> runtime\/runs\/run_legacy\/events\.jsonl/
      );
      assert.match(captured.out(), /summary: 6 to copy, 0 already migrated, 0 conflict\(s\)/);
      assert.equal(existsSync(runtimeRoot(stateRoot)), false, "a dry run must not create plane dirs");
      assert.equal(existsSync(adaptationRoot(stateRoot)), false);
    });
  });
});

describe("migrate-legacy apply", () => {
  it("copies each file into its plane and leaves the source in place", async () => {
    await withStateRoot(async (stateRoot) => {
      await seedLegacy(stateRoot);
      const captured = capture();
      const code = await migrateLegacyCommand(["--state-root", stateRoot, "--apply"], captured.io);

      assert.equal(code, 0, captured.err());
      assert.match(captured.out(), /summary: 6 copied, 0 already migrated, 0 conflict\(s\), 0 failed/);

      assert.equal(
        await readFile(join(adaptationRoot(stateRoot), "feedback", "records.jsonl"), "utf8"),
        `${FEEDBACK_LINE}\n`
      );
      assert.equal(
        await readFile(join(runtimeRoot(stateRoot), "runs", "run_legacy", "events.jsonl"), "utf8"),
        `${EVENT_LINE}\n`
      );
      assert.ok(existsSync(join(runtimeRoot(stateRoot), "episodes", "ep_1.jsonl")));
      assert.ok(existsSync(join(runtimeRoot(stateRoot), "invocations.jsonl")));

      // Copy, never move: the operator keeps the original tree.
      assert.ok(existsSync(join(stateRoot, "feedback", "records.jsonl")));
      assert.ok(existsSync(join(stateRoot, "runs", "run_legacy", "events.jsonl")));
    });
  });

  it("never lets a record cross into the other plane", async () => {
    await withStateRoot(async (stateRoot) => {
      await seedLegacy(stateRoot);
      await migrateLegacyCommand(["--state-root", stateRoot, "--apply"], capture().io);
      assert.equal(existsSync(join(runtimeRoot(stateRoot), "feedback")), false);
      assert.equal(existsSync(join(adaptationRoot(stateRoot), "runs")), false);
      assert.equal(existsSync(join(adaptationRoot(stateRoot), "episodes")), false);
      assert.equal(existsSync(join(adaptationRoot(stateRoot), "invocations.jsonl")), false);
    });
  });

  it("makes the migrated feedback readable through the plane-aware store", async () => {
    await withStateRoot(async (stateRoot) => {
      await seedLegacy(stateRoot);
      assert.deepEqual(await readFeedback(stateRoot), [], "the defect: legacy feedback reads as empty");
      await migrateLegacyCommand(["--state-root", stateRoot, "--apply"], capture().io);
      const records = await readFeedback(stateRoot);
      assert.equal(records.length, 1);
      assert.equal(records[0]?.id, "fbk_1");
    });
  });

  it("is idempotent: a second apply copies nothing and still exits 0", async () => {
    await withStateRoot(async (stateRoot) => {
      await seedLegacy(stateRoot);
      await migrateLegacyCommand(["--state-root", stateRoot, "--apply"], capture().io);

      const second = capture();
      assert.equal(await migrateLegacyCommand(["--state-root", stateRoot, "--apply"], second.io), 0);
      assert.match(second.out(), /summary: 0 copied, 6 already migrated, 0 conflict\(s\), 0 failed/);

      const dry = capture();
      assert.equal(
        await migrateLegacyCommand(["--state-root", stateRoot], dry.io),
        0,
        "a fully migrated root has no pending work"
      );
      assert.match(dry.out(), /summary: 0 to copy, 6 already migrated, 0 conflict\(s\)/);
    });
  });
});

describe("migrate-legacy fails closed", () => {
  it("refuses a JSONL file with a corrupt line in the middle", async () => {
    await withStateRoot(async (stateRoot) => {
      await writeFileAt(
        join(stateRoot, "feedback", "records.jsonl"),
        `${FEEDBACK_LINE}\n{ not json\n${FEEDBACK_LINE}\n`
      );
      const captured = capture();
      const code = await migrateLegacyCommand(["--state-root", stateRoot, "--apply"], captured.io);

      assert.equal(code, 1);
      assert.match(captured.err(), /corrupt legacy JSONL at feedback\/records\.jsonl line 2/);
      assert.equal(
        existsSync(join(adaptationRoot(stateRoot), "feedback", "records.jsonl")),
        false,
        "nothing is copied once a source is known to be corrupt"
      );
    });
  });

  it("tolerates a truncated final line but says so", async () => {
    await withStateRoot(async (stateRoot) => {
      const truncated = `${FEEDBACK_LINE}\n{"id":"fbk_2","epi`;
      await writeFileAt(join(stateRoot, "feedback", "records.jsonl"), truncated);
      const captured = capture();
      assert.equal(await migrateLegacyCommand(["--state-root", stateRoot, "--apply"], captured.io), 0);
      assert.match(captured.err(), /truncated final line at line 2/);
      assert.equal(
        await readFile(join(adaptationRoot(stateRoot), "feedback", "records.jsonl"), "utf8"),
        truncated,
        "the copy is byte-for-byte, so the recoverable tail survives"
      );
    });
  });

  it("never overwrites a destination that already holds different content", async () => {
    await withStateRoot(async (stateRoot) => {
      await writeFileAt(join(stateRoot, "feedback", "records.jsonl"), `${FEEDBACK_LINE}\n`);
      const destination = join(adaptationRoot(stateRoot), "feedback", "records.jsonl");
      await writeFileAt(destination, '{"id":"fbk_live","episodeId":"ep_9","kind":"user","score":0}\n');

      const captured = capture();
      const code = await migrateLegacyCommand(["--state-root", stateRoot, "--apply"], captured.io);

      assert.equal(code, 1);
      assert.match(captured.out(), /conflict: feedback\/records\.jsonl/);
      assert.match(
        await readFile(destination, "utf8"),
        /fbk_live/,
        "the plane copy wins; migration never clobbers live data"
      );
    });
  });
});
