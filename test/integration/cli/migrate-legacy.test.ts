import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
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
