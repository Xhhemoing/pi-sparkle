import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { main } from "../../../src/cli/main.js";
import type { CliIo } from "../../../src/cli/main.js";
import { adaptationRoot, runtimeRoot } from "../../../src/privacy/state-layout.js";
import { EventStore } from "../../../src/run/event-store.js";
import { createEventId, createRunId, type RunId } from "../../../src/domain/ids.js";
import { nowIso } from "../../../src/domain/timestamp.js";

/**
 * End-to-end wiring of `pi-sparkle migrate-legacy` through the CLI dispatcher,
 * against a state root laid out the pre-2026-08-22 way. The assertion that
 * matters is the one the weak-area report could not make: after the migration,
 * the plane-aware EventStore can read a legacy run again.
 */

function capture(): { io: CliIo; out: () => string; err: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (text) => out.push(text), stderr: (text) => err.push(text) },
    out: () => out.join(""),
    err: () => err.join("")
  };
}

async function writeFileAt(path: string, body: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body, "utf8");
}

function legacyEventLine(runId: RunId): string {
  return JSON.stringify({
    id: createEventId(),
    schemaVersion: 1,
    occurredAt: nowIso(),
    runId,
    type: "RUN_STARTED",
    actor: "cli",
    payload: {}
  });
}

test("migrate-legacy makes a flat legacy run readable through the plane-aware store", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-migrate-cli-"));
  try {
    const runId = createRunId();
    const line = legacyEventLine(runId);
    await writeFileAt(join(stateRoot, "runs", runId, "events.jsonl"), `${line}\n`);
    await writeFileAt(
      join(stateRoot, "feedback", "records.jsonl"),
      `${JSON.stringify({ id: "fbk_legacy", episodeId: "ep_legacy", kind: "user", score: 1 })}\n`
    );

    // The defect: plane-aware readers see nothing at all.
    assert.deepEqual((await new EventStore(stateRoot, runId).readAll()).events, []);

    const dry = capture();
    assert.equal(
      await main(["migrate-legacy", "--state-root", stateRoot], dry.io),
      1,
      "a dry run with pending work exits non-zero"
    );
    assert.match(dry.out(), /would copy: runs\//);
    assert.equal(existsSync(runtimeRoot(stateRoot)), false);

    const applied = capture();
    assert.equal(
      await main(["migrate-legacy", "--state-root", stateRoot, "--apply"], applied.io),
      0,
      applied.err()
    );

    const read = await new EventStore(stateRoot, runId).readAll();
    assert.equal(read.events.length, 1);
    assert.equal(read.events[0]?.runId, runId);
    assert.equal(
      await readFile(join(adaptationRoot(stateRoot), "feedback", "records.jsonl"), "utf8"),
      `${JSON.stringify({ id: "fbk_legacy", episodeId: "ep_legacy", kind: "user", score: 1 })}\n`
    );
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

/**
 * Disaster recovery, end to end: --apply must be able to finish the job after
 * an --apply that was killed. The old copy-straight-to-the-destination write
 * left a prefix of the source under the destination's real name, and every
 * later run refused it as `conflict (destination differs)` — permanently, by
 * design, since migrate-legacy never overwrites. Staging in a `*.tmp` next to
 * the destination and publishing with `link` means a kill leaves the
 * destination absent instead, so the re-run just copies.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * Kill the child the moment anything shows up in the (pre-created, empty)
 * plane directory — the staging temp today, the half-written destination
 * itself under the write this replaced. Either way the kill lands inside the
 * copy, which is the window the test is about. The size of the destination at
 * that instant is the observation that matters, so it is taken before the
 * signal: `undefined` means the destination did not exist yet.
 */
function killMidCopy(
  child: ChildProcess,
  directory: string,
  destination: string
): Promise<{ fired: boolean; destinationBytes: number | undefined }> {
  const deadline = Date.now() + 20_000;
  const spin = async (): Promise<{ fired: boolean; destinationBytes: number | undefined }> => {
    while (Date.now() < deadline && child.exitCode === null && child.signalCode === null) {
      // Synchronous polling: an awaited readdir per turn is slow enough that a
      // fast copy finishes between samples.
      for (let sample = 0; sample < 200; sample += 1) {
        if (readdirSync(directory).length === 0) continue;
        const destinationBytes = existsSync(destination) ? statSync(destination).size : undefined;
        child.kill("SIGKILL");
        return { fired: true, destinationBytes };
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
    return { fired: false, destinationBytes: undefined };
  };
  return spin();
}

test("a SIGKILLed --apply leaves no partial destination and the re-run finishes", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-migrate-kill-"));
  try {
    // Big enough that the copy is still running when the temp is spotted.
    const body = `${JSON.stringify({ id: "inv_1", note: "x".repeat(512) })}\n`.repeat(40_000);
    await writeFileAt(join(stateRoot, "invocations.jsonl"), body);
    const planeDir = runtimeRoot(stateRoot);
    await mkdir(planeDir, { recursive: true });
    const destination = join(planeDir, "invocations.jsonl");

    const child = spawn(
      process.execPath,
      [
        fileURLToPath(import.meta.resolve("tsx/cli")),
        join(repoRoot, "src/cli/main.ts"),
        "migrate-legacy",
        "--state-root",
        stateRoot,
        "--apply"
      ],
      { cwd: repoRoot, stdio: ["ignore", "ignore", "ignore"] }
    );
    const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
    const observed = await killMidCopy(child, planeDir, destination);
    child.kill("SIGKILL");
    await exited;

    // The invariant a real kill must not break, checked at the instant of the
    // kill and again after it: the destination is absent, or it is the whole
    // file. Never a prefix of it. (The pre-fix write failed the first check —
    // it was observed holding 110KB and 458KB of a 21MB source.)
    assert.equal(observed.fired, true, "the child never started copying");
    if (observed.destinationBytes !== undefined) {
      assert.equal(observed.destinationBytes, body.length, "a destination is never half-written");
    }
    if (existsSync(destination)) {
      assert.equal(await readFile(destination, "utf8"), body, "no half-copied destination");
    }
    assert.equal(
      await readFile(join(stateRoot, "invocations.jsonl"), "utf8"),
      body,
      "the source is never touched"
    );

    const rerun = capture();
    assert.equal(
      await main(["migrate-legacy", "--state-root", stateRoot, "--apply"], rerun.io),
      0,
      rerun.err()
    );
    assert.doesNotMatch(rerun.out(), /conflict:/, "a killed apply is not a conflict");
    assert.equal(await readFile(destination, "utf8"), body);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("a staging temp left by a killed apply does not block the CLI re-run", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-migrate-orphan-"));
  try {
    const runId = createRunId();
    const line = legacyEventLine(runId);
    await writeFileAt(join(stateRoot, "runs", runId, "events.jsonl"), `${line}\n`);
    const destination = join(runtimeRoot(stateRoot), "runs", runId, "events.jsonl");
    await writeFileAt(`${destination}.999999.abandoned.tmp`, line.slice(0, 20));

    const applied = capture();
    assert.equal(
      await main(["migrate-legacy", "--state-root", stateRoot, "--apply"], applied.io),
      0,
      applied.err()
    );
    assert.doesNotMatch(applied.out(), /conflict:/);

    const read = await new EventStore(stateRoot, runId).readAll();
    assert.equal(read.events.length, 1);
    assert.deepEqual(
      (await readdir(dirname(destination))).filter((name) => name.endsWith(".tmp")),
      ["events.jsonl.999999.abandoned.tmp"],
      "the orphan is inert and this run's own temp is gone"
    );
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("migrate-legacy is listed in the CLI usage and dispatches as a known command", async () => {
  const help = capture();
  assert.equal(await main(["help"], help.io), 0);
  assert.match(help.out(), /pi-sparkle migrate-legacy \[--state-root <dir>\] \[--apply\]/);

  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-migrate-cli-empty-"));
  try {
    const empty = capture();
    assert.equal(await main(["migrate-legacy", "--state-root", stateRoot], empty.io), 0);
    assert.match(empty.out(), /no legacy files found/);
    assert.equal(empty.err(), "", "a clean scan must not report an error");
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});
