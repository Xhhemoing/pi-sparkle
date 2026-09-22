import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { runIndependentCheck } from "../../../src/execution/independent-check.js";
import {
  captureWorktreeFingerprint,
  fingerprintsCompatible
} from "../../../src/execution/worktree-snapshot.js";

function gitOk(cwd: string, args: string[]): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
}

function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "g1a-snap-"));
  gitOk(dir, ["init"]);
  gitOk(dir, ["config", "user.email", "g1a@test"]);
  gitOk(dir, ["config", "user.name", "g1a"]);
  writeFileSync(path.join(dir, "tracked.txt"), "v1\n", "utf8");
  gitOk(dir, ["add", "tracked.txt"]);
  gitOk(dir, ["commit", "-m", "init"]);
  return dir;
}

function initQuotedChineseRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "r1-zh-"));
  gitOk(dir, ["init"]);
  gitOk(dir, ["config", "user.email", "g1a@test"]);
  gitOk(dir, ["config", "user.name", "g1a"]);
  gitOk(dir, ["config", "core.quotePath", "true"]);
  writeFileSync(path.join(dir, "中文.txt"), "v1\n", "utf8");
  gitOk(dir, ["add", "中文.txt"]);
  gitOk(dir, ["commit", "-m", "init-zh"]);
  return dir;
}

test("fingerprint is stable for clean tree and changes when dirty content changes", () => {
  const dir = initRepo();
  try {
    const a = captureWorktreeFingerprint(dir);
    const b = captureWorktreeFingerprint(dir);
    assert.equal(a.snapshotId, b.snapshotId);
    assert.equal(a.schemaVersion, "g1a-v1");
    assert.equal("sha256" in a, false);

    writeFileSync(path.join(dir, "tracked.txt"), "v2\n", "utf8");
    const dirty = captureWorktreeFingerprint(dir);
    assert.notEqual(dirty.snapshotId, a.snapshotId);
    const tracked = dirty.entries.find((e) => e.path === "tracked.txt");
    assert.ok(tracked);
    assert.equal(tracked.byteLength, Buffer.byteLength("v2\n", "utf8"));
    assert.equal("sha256" in tracked, false);

    writeFileSync(path.join(dir, "untracked.bin"), Buffer.from([0, 1, 2, 255]));
    const withUntracked = captureWorktreeFingerprint(dir);
    assert.notEqual(withUntracked.snapshotId, dirty.snapshotId);
    const untrackedBin = withUntracked.entries.find((e) => e.path === "untracked.bin" && e.kind === "untracked");
    assert.ok(untrackedBin);
    assert.equal(untrackedBin.byteLength, 4);
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
    assert.notEqual(after.snapshotId, before.snapshotId);
    const deleted = after.entries.find((e) => e.path === "tracked.txt" && e.kind === "deleted");
    assert.ok(deleted);
    assert.equal(deleted.byteLength, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("quotePath Chinese path content change records byte length and same-length rewrite is not a digest check", () => {
  const dir = initQuotedChineseRepo();
  try {
    writeFileSync(path.join(dir, "中文.txt"), "v2\n", "utf8");
    const before = captureWorktreeFingerprint(dir);
    const zh = before.entries.find((e) => e.path === "中文.txt");
    assert.ok(zh, `expected 中文.txt entry, got ${JSON.stringify(before.entries)}`);
    assert.equal(zh.byteLength, Buffer.byteLength("v2\n", "utf8"));
    assert.equal("sha256" in zh, false);

    const check = runIndependentCheck({
      cwd: dir,
      command: "node",
      args: ["-e", "require('fs').writeFileSync('中文.txt','v3\\n')"]
    });
    assert.equal(check.exitCode, 0);
    assert.equal(check.ok, true, "same-length rewrite is not detected without a content digest");
    const afterZh = check.contentFingerprintAfter.entries.find((e) => e.path === "中文.txt");
    assert.equal(afterZh?.byteLength, Buffer.byteLength("v3\n", "utf8"));
    assert.equal(afterZh?.byteLength, zh.byteLength);
    assert.equal("sha256" in check, false);
    assert.match(check.checkId, /^check_v2_/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fingerprint tracks space, rename, binary, and platform special names", () => {
  const dir = initRepo();
  try {
    writeFileSync(path.join(dir, "has space.txt"), "space-v1\n", "utf8");
    writeFileSync(path.join(dir, "weird #file.txt"), "hash-v1\n", "utf8");
    mkdirSync(path.join(dir, "sub dir"), { recursive: true });
    writeFileSync(path.join(dir, "sub dir", "nested file.txt"), "nest-v1\n", "utf8");
    gitOk(dir, ["add", "has space.txt", "weird #file.txt", "sub dir/nested file.txt"]);
    gitOk(dir, ["commit", "-m", "special-names"]);
    gitOk(dir, ["config", "core.quotePath", "true"]);

    writeFileSync(path.join(dir, "has space.txt"), "space-v2\n", "utf8");
    writeFileSync(path.join(dir, "sub dir", "nested file.txt"), "nest-v2\n", "utf8");
    writeFileSync(path.join(dir, "bin.dat"), Buffer.from([0, 1, 2, 255]));
    gitOk(dir, ["mv", "weird #file.txt", "renamed #file.txt"]);

    const fp = captureWorktreeFingerprint(dir);
    const paths = fp.entries.map((e) => e.path);
    assert.ok(paths.includes("has space.txt"), JSON.stringify(paths));
    assert.ok(paths.includes("bin.dat"), JSON.stringify(paths));
    assert.ok(paths.includes("renamed #file.txt"), JSON.stringify(paths));
    assert.ok(paths.includes("sub dir/nested file.txt"), JSON.stringify(paths));

    const spaced = fp.entries.find((e) => e.path === "has space.txt");
    assert.equal(spaced?.byteLength, Buffer.byteLength("space-v2\n", "utf8"));
    assert.equal("sha256" in (spaced ?? {}), false);

    const bin = fp.entries.find((e) => e.path === "bin.dat");
    assert.equal(bin?.byteLength, 4);

    const renamed = fp.entries.find((e) => e.path === "renamed #file.txt");
    assert.ok(renamed, JSON.stringify(paths));
    assert.equal(typeof renamed.byteLength, "number");

    writeFileSync(path.join(dir, "has space.txt"), "space-v3-longer\n", "utf8");
    const after = captureWorktreeFingerprint(dir);
    assert.equal(fingerprintsCompatible(fp, after).ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("staged delete plus same-name untracked keeps both entries and detects content change", () => {
  const dir = initRepo();
  try {
    gitOk(dir, ["rm", "--cached", "tracked.txt"]);
    const fp = captureWorktreeFingerprint(dir);
    const deleted = fp.entries.filter((e) => e.path === "tracked.txt" && e.kind === "deleted");
    const untracked = fp.entries.filter((e) => e.path === "tracked.txt" && e.kind === "untracked");
    assert.equal(deleted.length, 1);
    assert.equal(untracked.length, 1);
    assert.equal(deleted[0]?.byteLength, null);
    assert.equal(untracked[0]?.byteLength, Buffer.byteLength("v1\n", "utf8"));

    writeFileSync(path.join(dir, "tracked.txt"), "replaced\n", "utf8");
    const after = captureWorktreeFingerprint(dir);
    assert.equal(fingerprintsCompatible(fp, after).ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rename source identity changes the fingerprint even when file contents match", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "g1a-rename-source-"));
  try {
    gitOk(dir, ["init"]);
    gitOk(dir, ["config", "user.email", "g1a@test"]);
    gitOk(dir, ["config", "user.name", "g1a"]);
    writeFileSync(path.join(dir, "a.txt"), "same\n", "utf8");
    writeFileSync(path.join(dir, "b.txt"), "same\n", "utf8");
    gitOk(dir, ["add", "a.txt", "b.txt"]);
    gitOk(dir, ["commit", "-m", "rename-source"]);
    gitOk(dir, ["mv", "a.txt", "dest.txt"]);
    const before = captureWorktreeFingerprint(dir);
    const command = "const {execFileSync}=require('node:child_process'); execFileSync('git',['mv','dest.txt','a.txt']); execFileSync('git',['mv','b.txt','dest.txt']);";
    const check = runIndependentCheck({ cwd: dir, command: "node", args: ["-e", command] });
    assert.equal(check.exitCode, 0);
    assert.equal(check.ok, false, "swapping identical rename sources changes the file set");
    assert.notEqual(check.contentFingerprintAfter.snapshotId, before.snapshotId);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("non-delete unreadable path fails closed instead of a silent null length", () => {
  const dir = initRepo();
  try {
    symlinkSync(path.join(dir, "no-such-target"), path.join(dir, "dangle.txt"));
    assert.throws(
      () => captureWorktreeFingerprint(dir),
      (err: unknown) => err instanceof DomainValidationError && /unreadable non-delete/.test(err.message)
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("same-length content change keeps a non-hash snapshot label and does not claim content verification", () => {
  const dir = initRepo();
  try {
    writeFileSync(path.join(dir, "tracked.txt"), "v2\n", "utf8");
    const first = captureWorktreeFingerprint(dir);
    writeFileSync(path.join(dir, "tracked.txt"), "v3\n", "utf8");
    const second = captureWorktreeFingerprint(dir);
    assert.equal(first.entries[0]?.byteLength, second.entries[0]?.byteLength);
    assert.equal(first.snapshotId, second.snapshotId);
    assert.equal(fingerprintsCompatible(first, second).ok, true);
    assert.match(first.snapshotId, /^snap_v2_/);
    assert.doesNotMatch(first.snapshotId, /^[0-9a-f]{64}$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("snapshot module does not import a cryptographic hash", () => {
  const source = readFileSync(new URL("../../../src/execution/worktree-snapshot.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /createHash|sha256/i);
  const check = readFileSync(new URL("../../../src/execution/independent-check.ts", import.meta.url), "utf8");
  assert.doesNotMatch(check, /createHash|sha256/i);
});
