import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
  captureWorktreeFingerprint,
  fingerprintsCompatible
} from "../../../src/execution/worktree-snapshot.js";

function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "g1a-snap-"));
  const run = (args: string[]) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8", windowsHide: true });
    assert.equal(r.status, 0, r.stderr);
  };
  run(["init"]);
  run(["config", "user.email", "g1a@test"]);
  run(["config", "user.name", "g1a"]);
  writeFileSync(path.join(dir, "tracked.txt"), "v1\n", "utf8");
  run(["add", "tracked.txt"]);
  run(["commit", "-m", "init"]);
  return dir;
}

test("fingerprint is stable for clean tree and changes when dirty content changes", () => {
  const dir = initRepo();
  try {
    const a = captureWorktreeFingerprint(dir);
    const b = captureWorktreeFingerprint(dir);
    assert.equal(a.digest, b.digest);
    assert.equal(a.schemaVersion, "g1a-v1");

    writeFileSync(path.join(dir, "tracked.txt"), "v2\n", "utf8");
    const dirty = captureWorktreeFingerprint(dir);
    assert.notEqual(dirty.digest, a.digest);
    assert.ok(dirty.entries.some((e) => e.path === "tracked.txt"));

    writeFileSync(path.join(dir, "untracked.bin"), Buffer.from([0, 1, 2, 255]));
    const withUntracked = captureWorktreeFingerprint(dir);
    assert.notEqual(withUntracked.digest, dirty.digest);
    assert.ok(withUntracked.entries.some((e) => e.path === "untracked.bin" && e.kind === "untracked"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fingerprintsCompatible rejects mid-check candidate edits; allows declared output dirs", () => {
  const dir = initRepo();
  try {
    mkdirSync(path.join(dir, "out"), { recursive: true });
    const before = captureWorktreeFingerprint(dir, { allowedOutputDirs: ["out"] });
    writeFileSync(path.join(dir, "tracked.txt"), "mutated\n", "utf8");
    const afterBad = captureWorktreeFingerprint(dir, { allowedOutputDirs: ["out"] });
    const bad = fingerprintsCompatible(before, afterBad, { allowedOutputDirs: ["out"] });
    assert.equal(bad.ok, false);

    // reset content
    writeFileSync(path.join(dir, "tracked.txt"), "v1\n", "utf8");
    spawnSync("git", ["checkout", "--", "tracked.txt"], { cwd: dir, windowsHide: true });
    const before2 = captureWorktreeFingerprint(dir, { allowedOutputDirs: ["out"] });
    writeFileSync(path.join(dir, "out", "log.txt"), "ok\n", "utf8");
    const afterOk = captureWorktreeFingerprint(dir, { allowedOutputDirs: ["out"] });
    const good = fingerprintsCompatible(before2, afterOk, { allowedOutputDirs: ["out"] });
    assert.equal(good.ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deleted tracked file is represented in fingerprint", () => {
  const dir = initRepo();
  try {
    const before = captureWorktreeFingerprint(dir);
    rmSync(path.join(dir, "tracked.txt"));
    const after = captureWorktreeFingerprint(dir);
    assert.notEqual(after.digest, before.digest);
    assert.ok(after.entries.some((e) => e.path === "tracked.txt" && e.kind === "deleted"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
