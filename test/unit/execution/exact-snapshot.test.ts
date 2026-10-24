import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { captureExactSnapshot, sameExactSnapshot, sameExactSnapshotContents } from "../../../src/execution/exact-snapshot.js";

function fixture(t: { after(fn: () => void): void }): string {
  const root = fs.mkdtempSync(path.join(tmpdir(), "sparkle-exact-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("exact snapshot compares binary bytes and includes ignored files", (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, ".gitignore"), "ignored.bin\n");
  fs.writeFileSync(path.join(root, "ignored.bin"), Buffer.from([0, 255, 1, 0]));
  const before = captureExactSnapshot(root);
  assert.equal(before.fileCount, 2);
  assert.equal(before.byteLength, 16);
  assert.equal(sameExactSnapshot(before, captureExactSnapshot(root)), true);
  fs.writeFileSync(path.join(root, "ignored.bin"), Buffer.from([0, 255, 2, 0]));
  assert.equal(sameExactSnapshot(before, captureExactSnapshot(root)), false);
});

test("exact snapshots reject file additions, deletions and renames", (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, "a"), "same");
  const before = captureExactSnapshot(root);
  fs.writeFileSync(path.join(root, "b"), "same");
  assert.equal(sameExactSnapshot(before, captureExactSnapshot(root)), false);
  fs.rmSync(path.join(root, "a"));
  assert.equal(sameExactSnapshot(before, captureExactSnapshot(root)), false);
  fs.rmSync(path.join(root, "b"));
  assert.equal(sameExactSnapshot(before, captureExactSnapshot(root)), false);
});

test("exact snapshots compare directory paths including empty directories", (t) => {
  const root = fixture(t);
  const before = captureExactSnapshot(root);
  fs.mkdirSync(path.join(root, "empty"));
  assert.equal(sameExactSnapshot(before, captureExactSnapshot(root)), false);
});

test("exact snapshots compare file permissions", { skip: process.platform === "win32" }, (t) => {
  const root = fixture(t);
  const file = path.join(root, "run");
  fs.writeFileSync(file, "same", { mode: 0o600 });
  const before = captureExactSnapshot(root);
  fs.chmodSync(file, 0o700);
  assert.equal(sameExactSnapshot(before, captureExactSnapshot(root)), false);
});

test("exact snapshot includes prefixes and fixed exclusions with mandatory .git exclusion", (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, "src", "generated"), { recursive: true });
  fs.mkdirSync(path.join(root, ".git"));
  fs.writeFileSync(path.join(root, "src", "kept"), "yes");
  fs.writeFileSync(path.join(root, "src", "generated", "noise"), "old");
  fs.writeFileSync(path.join(root, ".git", "noise"), "old");
  const manifest = { includePrefixes: ["./src/"], excludePrefixes: ["src/generated"] };
  const before = captureExactSnapshot(root, manifest);
  fs.writeFileSync(path.join(root, "src", "generated", "noise"), "new");
  fs.writeFileSync(path.join(root, "outside"), "ignored");
  assert.equal(before.fileCount, 1);
  assert.equal(sameExactSnapshot(before, captureExactSnapshot(root, manifest)), true);
  const full = captureExactSnapshot(root);
  fs.writeFileSync(path.join(root, ".git", "noise"), "longer");
  assert.equal(sameExactSnapshot(full, captureExactSnapshot(root)), true);
});

test("exact snapshot supports file include prefixes and refuses absent or excluded required prefixes", (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, "file"), "ok");
  assert.equal(captureExactSnapshot(root, { includePrefixes: ["file"] }).fileCount, 1);
  assert.throws(() => captureExactSnapshot(root, { includePrefixes: ["missing"] }), /include|missing/i);
  assert.throws(() => captureExactSnapshot(root, { includePrefixes: ["file"], excludePrefixes: ["file"] }), /include|excluded/i);
  assert.throws(() => captureExactSnapshot(root, { includePrefixes: [".git"] }), /include|excluded/i);
});

test("optional include prefixes preserve absence and capture creation deletion and exact bytes", (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, "outside"), "unselected");
  const manifest = { optionalIncludePrefixes: ["new.txt", "unused.txt"] };
  const absent = captureExactSnapshot(root, manifest);
  assert.equal(absent.fileCount, 0);
  fs.writeFileSync(path.join(root, "outside"), "changed outside scope");
  assert.equal(sameExactSnapshot(absent, captureExactSnapshot(root, manifest)), true);
  fs.writeFileSync(path.join(root, "new.txt"), "good");
  const created = captureExactSnapshot(root, manifest);
  assert.equal(created.fileCount, 1);
  assert.equal(sameExactSnapshot(absent, created), false);
  fs.writeFileSync(path.join(root, "new.txt"), "evil");
  assert.equal(sameExactSnapshot(created, captureExactSnapshot(root, manifest)), false);
  fs.rmSync(path.join(root, "new.txt"));
  assert.equal(sameExactSnapshot(created, captureExactSnapshot(root, manifest)), false);
  assert.equal(sameExactSnapshot(absent, captureExactSnapshot(root, manifest)), true);
});

test("optional prefixes do not relax required paths exclusions or combined bounds", (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, "required"), "ok");
  assert.equal(captureExactSnapshot(root, { includePrefixes: ["required"], optionalIncludePrefixes: ["missing"] }).fileCount, 1);
  assert.throws(() => captureExactSnapshot(root, { includePrefixes: ["missing"], optionalIncludePrefixes: ["required"] }), /include|missing/i);
  for (const prefix of ["../outside", "/absolute", "a/../b", "C:\\outside", "", "a\0b"]) {
    assert.throws(() => captureExactSnapshot(root, { optionalIncludePrefixes: [prefix] }), /manifest|prefix|path/i);
  }
  assert.throws(() => captureExactSnapshot(root, { optionalIncludePrefixes: ["required"], excludePrefixes: ["required"] }), /include|excluded/i);
  assert.throws(() => captureExactSnapshot(root, { optionalIncludePrefixes: [".git"] }), /include|excluded/i);
  const optional = Array.from({ length: 256 }, (_, index) => `optional-${index}`);
  assert.throws(() => captureExactSnapshot(root, { includePrefixes: ["required"], optionalIncludePrefixes: optional }), /prefix|bounded|limit/i);
  assert.throws(() => captureExactSnapshot(root, { optionalIncludePrefixes: ["required"] }, { maxFiles: 1, maxBytes: 1 }), /byte.*limit|limit.*byte/i);
  assert.equal(sameExactSnapshot(captureExactSnapshot(root), captureExactSnapshot(root, { optionalIncludePrefixes: [] })), true);
  assert.equal(sameExactSnapshot(captureExactSnapshot(root, { includePrefixes: ["required"] }),
    captureExactSnapshot(root, { optionalIncludePrefixes: ["required"] })), false);
});

test("optional include prefixes refuse linked ancestors", (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, "actual"));
  fs.symlinkSync(path.join(root, "actual"), path.join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => captureExactSnapshot(root, { optionalIncludePrefixes: ["linked/missing"] }), /link|directory|include/i);
});

test("exact snapshot refuses nonempty allowed output directories", (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, "out"));
  fs.writeFileSync(path.join(root, "out", "existing"), "important");
  assert.throws(() => captureExactSnapshot(root, { allowedOutputDirs: ["out"] }), /allowedOutputDirs|output/i);
});

test("exact snapshot refuses included symlink files and directories", { skip: process.platform === "win32" }, (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, "target"), "ok");
  fs.symlinkSync("target", path.join(root, "link"));
  assert.throws(() => captureExactSnapshot(root), /link|regular/i);
  assert.equal(captureExactSnapshot(root, { excludePrefixes: ["link"] }).fileCount, 1);
  fs.rmSync(path.join(root, "link"));
  fs.mkdirSync(path.join(root, "target-dir"));
  fs.symlinkSync("target-dir", path.join(root, "link-dir"));
  assert.throws(() => captureExactSnapshot(root, { includePrefixes: ["link-dir/file"] }), /link|directory|include/i);
});

test("exact snapshot refuses root symlink and non-directory roots", { skip: process.platform === "win32" }, (t) => {
  const outer = fixture(t);
  fs.mkdirSync(path.join(outer, "real"));
  fs.symlinkSync("real", path.join(outer, "linked"));
  fs.writeFileSync(path.join(outer, "file"), "ok");
  assert.throws(() => captureExactSnapshot(path.join(outer, "linked")), /link|root/i);
  assert.throws(() => captureExactSnapshot(path.join(outer, "file")), /directory|root/i);
});

test("exact snapshot refuses special files without reading them", { skip: process.platform === "win32" }, (t) => {
  const root = fixture(t);
  const result = spawnSync("mkfifo", [path.join(root, "fifo")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.throws(() => captureExactSnapshot(root), /regular|special/i);
});

test("exact snapshot refuses multiply linked regular files", (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, "original"), "same");
  fs.linkSync(path.join(root, "original"), path.join(root, "hardlink"));
  assert.throws(() => captureExactSnapshot(root), /nonlinked|regular/i);
});

test("exact snapshot enforces aggregate file and byte limits", (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, "a"), "123");
  fs.writeFileSync(path.join(root, "b"), "456");
  assert.throws(() => captureExactSnapshot(root, {}, { maxFiles: 1, maxBytes: 100 }), /file.*limit|limit.*file/i);
  assert.throws(() => captureExactSnapshot(root, {}, { maxFiles: 2, maxBytes: 5 }), /byte.*limit|limit.*byte/i);
  assert.equal(captureExactSnapshot(root, {}, { maxFiles: 2, maxBytes: 6 }).byteLength, 6);
});

test("exact snapshot bounds traversed directory entries even with no files", (t) => {
  const root = fixture(t);
  for (let index = 0; index < 1100; index += 1) fs.mkdirSync(path.join(root, `d${index}`));
  assert.throws(() => captureExactSnapshot(root, {}, { maxFiles: 1, maxBytes: 10 }), /traversal|entr.*limit|limit.*entr/i);
});

test("exact snapshot validates limit values and unsafe manifest paths", (t) => {
  const root = fixture(t);
  for (const value of [0, -1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => captureExactSnapshot(root, {}, { maxFiles: value, maxBytes: 10 }), /limit|maxFiles/i);
    assert.throws(() => captureExactSnapshot(root, {}, { maxFiles: 1, maxBytes: value }), /limit|maxBytes/i);
  }
  for (const prefix of ["../outside", "/absolute", "a/../b", "C:\\outside", "", "a\0b"]) {
    assert.throws(() => captureExactSnapshot(root, { includePrefixes: [prefix] }), /manifest|prefix|path/i);
    assert.throws(() => captureExactSnapshot(root, { excludePrefixes: [prefix] }), /manifest|prefix|path/i);
  }
});

test("snapshot data stays opaque and copied metadata cannot manufacture equality", (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, "private"), "private-candidate-content");
  const snapshot = captureExactSnapshot(root);
  assert.ok(Object.isFrozen(snapshot));
  assert.deepEqual(Object.keys(snapshot).sort(), ["byteLength", "fileCount"]);
  assert.equal(JSON.stringify(snapshot).includes("private"), false);
  assert.equal(sameExactSnapshot(snapshot, { ...snapshot }), false);
  assert.equal(sameExactSnapshot(snapshot, snapshot), true);
});

test("different roots and manifest scopes do not compare equal accidentally", (t) => {
  const first = fixture(t);
  const second = fixture(t);
  fs.writeFileSync(path.join(first, "file"), "same");
  fs.writeFileSync(path.join(second, "file"), "same");
  assert.equal(sameExactSnapshot(captureExactSnapshot(first), captureExactSnapshot(second)), false);
  assert.equal(sameExactSnapshot(captureExactSnapshot(first), captureExactSnapshot(first, { includePrefixes: ["file"] })), false);
});

test("file replacement while reading fails closed", (t) => {
  const root = fixture(t);
  const file = path.join(root, "candidate");
  fs.writeFileSync(file, "same");
  const original = fs.readSync;
  let swapped = false;
  t.mock.method(fs, "readSync", (...args: unknown[]) => {
    const result = Reflect.apply(original, fs, args) as number;
    if (!swapped) {
      swapped = true;
      fs.renameSync(file, path.join(root, "previous"));
      fs.writeFileSync(file, "same");
    }
    return result;
  });
  assert.throws(() => captureExactSnapshot(root), /changed|identity|unstable/i);
});

test("parent replacement while reading fails closed", (t) => {
  const root = fixture(t);
  const parent = path.join(root, "dir");
  fs.mkdirSync(parent);
  fs.writeFileSync(path.join(parent, "candidate"), "same");
  const original = fs.readSync;
  let swapped = false;
  t.mock.method(fs, "readSync", (...args: unknown[]) => {
    const result = Reflect.apply(original, fs, args) as number;
    if (!swapped) {
      swapped = true;
      fs.renameSync(parent, path.join(root, "previous-dir"));
      fs.mkdirSync(parent);
      fs.writeFileSync(path.join(parent, "candidate"), "same");
    }
    return result;
  });
  assert.throws(() => captureExactSnapshot(root), /changed|identity|unstable/i);
});

test("cross-root content comparison keeps identity checks and exact scope/bytes distinct", (t) => {
  const left = fixture(t);
  const right = fixture(t);
  for (const root of [left, right]) {
    fs.mkdirSync(path.join(root, "checks"));
    fs.writeFileSync(path.join(root, "checks", "guard"), "first\n", "utf8");
  }
  const manifest = { includePrefixes: ["checks"] };
  const original = captureExactSnapshot(left, manifest);
  const peer = captureExactSnapshot(right, manifest);
  assert.equal(sameExactSnapshot(original, peer), false, "content equality cannot establish root identity");
  assert.equal(sameExactSnapshotContents(original, peer), true);
  assert.equal(sameExactSnapshotContents({ ...original }, peer), false, "serialized/copied handles are not observations");
  assert.equal(sameExactSnapshotContents(original, captureExactSnapshot(right)), false, "scope remains part of equality");
  fs.writeFileSync(path.join(right, "checks", "guard"), "first\r\n", "utf8");
  assert.equal(sameExactSnapshotContents(original, captureExactSnapshot(right, manifest)), false);
});
