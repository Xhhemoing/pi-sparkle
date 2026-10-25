import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { captureExactSnapshot, sameExactSnapshot, assertExactSnapshotMatchesGitTree } from "../../../src/execution/exact-snapshot.js";
import { runIndependentCheck } from "../../../src/execution/independent-check.js";
import { prepareTrustedVerification, beginTrustedVerification } from "../../../src/execution/trusted-verification.js";
import { captureWorktreeFingerprint, type SnapshotManifest } from "../../../src/execution/worktree-snapshot.js";

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function fixture(t: { after(fn: () => void): void }): string {
  const root = fs.mkdtempSync(path.join(tmpdir(), "sparkle-pattern-"));
  t.after(() => { assert.ok(path.basename(root).startsWith("sparkle-pattern-")); fs.rmSync(root, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(root, "test"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "test/base.cjs"), "base", "utf8");
  fs.writeFileSync(path.join(root, "src/value.cjs"), "source", "utf8");
  fs.writeFileSync(path.join(root, ".gitignore"), "*.secret\n.cache/\n", "utf8");
  git(root, ["init"]); git(root, ["config", "user.name", "Pattern fixture"]); git(root, ["config", "user.email", "fixture@example.invalid"]);
  git(root, ["config", "core.autocrlf", "false"]); git(root, ["add", "."]); git(root, ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
  return root;
}
function patterns(manifest: Record<string, readonly string[]>): SnapshotManifest { return manifest as SnapshotManifest; }

test("pattern capture requires each protection selector to match independently", (t) => {
  const root = fixture(t);
  assert.throws(() => captureExactSnapshot(root, patterns({ includePatterns: ["test/*.cjs", "absent/*.cjs"] })), /required.*pattern|pattern.*missing/i);
});
test("pattern snapshots exclude unrelated regular files and directory-only traversal hints", (t) => {
  const root = fixture(t);
  const manifest = patterns({ includePatterns: ["**/*.cjs"] });
  const before = captureExactSnapshot(root, manifest);
  assert.equal(before.fileCount, 2);
  fs.mkdirSync(path.join(root, "unrelated", "nested"), { recursive: true });
  fs.writeFileSync(path.join(root, "unrelated/nested/readme.txt"), "noise", "utf8");
  assert.equal(sameExactSnapshot(before, captureExactSnapshot(root, manifest)), true);
});
test("optional future pattern dynamically observes new ignored files and binary bytes", (t) => {
  const root = fixture(t);
  const manifest = patterns({ includePatterns: ["test/*.cjs"], optionalIncludePatterns: [".cache/**/*.secret"] });
  const before = captureExactSnapshot(root, manifest);
  fs.mkdirSync(path.join(root, ".cache"));
  fs.writeFileSync(path.join(root, ".cache/new.secret"), Buffer.from([0, 255, 1]));
  const after = captureExactSnapshot(root, manifest);
  assert.equal(after.fileCount, 2);
  assert.equal(sameExactSnapshot(before, after), false);
  fs.writeFileSync(path.join(root, ".cache/new.secret"), Buffer.from([0, 255, 2]));
  assert.equal(sameExactSnapshot(after, captureExactSnapshot(root, manifest)), false);
});
test("real trusted checker catches newly-created ignored pattern matches", async (t) => {
  const root = fixture(t);
  const args = ["-e", "require('node:fs').writeFileSync('test/new.secret','hidden')"];
  const manifest = patterns({ includePatterns: ["test/*"] });
  const trustedVerification = prepareTrustedVerification({ command: process.execPath, args, snapshotManifest: manifest });
  assert.deepEqual(trustedVerification.snapshotManifest.includePatterns, ["test/*"]);
  const check = await runIndependentCheck({ cwd: root, command: process.execPath, args, trustedVerification });
  assert.equal(check.exitCode, 0);
  assert.equal(check.ok, false);
  assert.equal(check.trustedVerification?.ok, false);
  assert.match(check.trustedVerification?.reason ?? "", /changed/i);
});
test("trusted manifest compares pattern authority and permits unrelated checker output", async (t) => {
  const root = fixture(t);
  const args = ["-e", "require('node:fs').writeFileSync('noise.txt','not selected')"];
  const manifest = patterns({ includePatterns: ["test/*.cjs"] });
  const trustedVerification = prepareTrustedVerification({ command: process.execPath, args, snapshotManifest: manifest });
  assert.throws(() => beginTrustedVerification(trustedVerification, root, process.execPath, args,
    patterns({ includePatterns: ["src/*.cjs"] })), /manifest.*match/i);
  const check = await runIndependentCheck({ cwd: root, command: process.execPath, args, trustedVerification });
  assert.equal(check.ok, true);
});
test("fingerprint filters Git changes through patterns without changing its ignored-file semantics", (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, "test/base.cjs"), "changed", "utf8");
  fs.writeFileSync(path.join(root, "src/value.cjs"), "changed", "utf8");
  fs.writeFileSync(path.join(root, "test/ignored.secret"), "ignored", "utf8");
  const fingerprint = captureWorktreeFingerprint(root, patterns({ includePatterns: ["test/*"] }));
  assert.deepEqual(fingerprint.entries.map((entry) => entry.path), ["test/base.cjs"]);
});
test("pattern scopes cannot bind whole-worktree Git trees and empty additions preserve literal identity", (t) => {
  const root = fixture(t);
  const manifest = patterns({ includePatterns: ["**"] });
  const snapshot = captureExactSnapshot(root, manifest);
  assert.throws(() => assertExactSnapshotMatchesGitTree(snapshot, root, git(root, ["rev-parse", "HEAD^{tree}"])), /whole-worktree/i);
  const literal = captureExactSnapshot(root, { includePrefixes: ["test"] });
  assert.equal(sameExactSnapshot(literal, captureExactSnapshot(root, { includePrefixes: ["test"], ...patterns({ includePatterns: [], optionalIncludePatterns: [] }) })), true);
  assert.equal(sameExactSnapshot(captureExactSnapshot(root), captureExactSnapshot(root, patterns({ includePatterns: [], optionalIncludePatterns: [] }))), true);
});
test("pattern capture preserves limits, forbidden syntax and directory-link refusal", (t) => {
  const root = fixture(t);
  assert.throws(() => captureExactSnapshot(root, patterns({ includePatterns: ["**/*.cjs"] }), { maxFiles: 1, maxBytes: 100 }), /file.*limit/i);
  assert.throws(() => captureExactSnapshot(root, patterns({ includePatterns: ["test/*.cjs"] }), { maxFiles: 10, maxBytes: 1 }), /byte.*limit/i);
  for (const selector of ["../test/*", "test/[ab]", "test/{a,b}", "test/**x", ".git/*", "test/.git/*", "test\\*"]) {
    assert.throws(() => captureExactSnapshot(root, patterns({ optionalIncludePatterns: [selector] })), /selector|pattern|path/i);
  }
  fs.symlinkSync(path.join(root, "test"), path.join(root, "alias"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => captureExactSnapshot(root, patterns({ includePatterns: ["alias/**/*.cjs"] })), /link/i);
});
test("pattern traversal keeps bounded entry visits", (t) => {
  const root = fixture(t);
  for (let index = 0; index < 1030; index++) fs.writeFileSync(path.join(root, `noise-${index}.txt`), "", "utf8");
  assert.throws(() => captureExactSnapshot(root, patterns({ optionalIncludePatterns: ["**/*.secret"] }), { maxFiles: 1, maxBytes: 10 }), /traversal.*limit/i);
});
test("pattern traversal retains unsupported filename encoding refusal", { skip: process.platform === "win32" }, (t) => {
  const root = fixture(t);
  fs.writeFileSync(Buffer.concat([Buffer.from(`${root}${path.sep}`), Buffer.from([0xff])]), "bad");
  assert.throws(() => captureExactSnapshot(root, patterns({ optionalIncludePatterns: ["**/*.cjs"] })), /encoding/i);
});
