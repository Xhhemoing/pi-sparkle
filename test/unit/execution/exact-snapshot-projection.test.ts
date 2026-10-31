import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import * as exact from "../../../src/execution/exact-snapshot.js";

function git(root: string, args: string[]): string {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8", timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_ATTR_NOSYSTEM: "1" }
  });
  assert.equal(result.error, undefined, result.error?.message ?? result.stderr);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixture(t: { after(fn: () => void): void }): string {
  const root = fs.mkdtempSync(path.join(tmpdir(), "sparkle-projection-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  git(root, ["init", "--quiet"]);
  git(root, ["config", "core.autocrlf", "false"]);
  git(root, ["config", "core.attributesFile", path.join(root, ".git", "empty-attributes")]);
  fs.writeFileSync(path.join(root, ".gitignore"), "node_modules/\n", "utf8");
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "index.ts"), "export const answer = 42;\n", "utf8");
  fs.mkdirSync(path.join(root, "node_modules", "fixture", "nested"), { recursive: true });
  fs.writeFileSync(path.join(root, "node_modules", "fixture", "nested", "dependency.js"), "private prepared bytes", "utf8");
  return root;
}

function stage(root: string): string {
  git(root, ["add", "--all"]);
  return git(root, ["write-tree"]);
}

function projection(root: string): exact.ExactSnapshot {
  return exact.captureExactSnapshot(root, { excludePrefixes: ["node_modules"] });
}

test("delivery projection matches the complete Git tree while ignored prepared bytes remain excluded", (t) => {
  const root = fixture(t);
  const tree = stage(root);
  const snapshot = projection(root);
  assert.equal(snapshot.fileCount, 2);
  assert.doesNotThrow(() => exact.assertExactProjectionMatchesCompleteGitTree(snapshot, root, tree));
  assert.doesNotThrow(() => exact.assertProjectionGitAttributesPreserveBytes(snapshot, root, { beforeTree: tree, afterTree: tree }));
});

test("whole-worktree binding and attribute entrypoints still refuse delivery projections", (t) => {
  const root = fixture(t);
  const tree = stage(root);
  const snapshot = projection(root);
  assert.throws(() => exact.assertExactSnapshotMatchesGitTree(snapshot, root, tree), /whole-worktree/i);
  assert.throws(() => exact.assertGitAttributesPreserveExactBytes(snapshot, root, { beforeTree: tree, afterTree: tree }), /whole-worktree/i);
});

test("projection equality refuses an omitted ordinary file even when selected bytes match", (t) => {
  const root = fixture(t);
  const tree = stage(root);
  const snapshot = exact.captureExactSnapshot(root, { includePrefixes: [".gitignore"], excludePrefixes: ["node_modules"] });
  assert.throws(() => exact.assertExactProjectionMatchesCompleteGitTree(snapshot, root, tree), { name: "DomainValidationError", message: /path|file|match/i });
});

test("projection equality refuses a tree missing a captured source file", (t) => {
  const root = fixture(t);
  stage(root);
  const snapshot = projection(root);
  git(root, ["rm", "--cached", "src/index.ts"]);
  const tree = git(root, ["write-tree"]);
  assert.throws(() => exact.assertExactProjectionMatchesCompleteGitTree(snapshot, root, tree), { name: "DomainValidationError", message: /path|file|match/i });
});

test("projection equality refuses an extra complete-tree file", (t) => {
  const root = fixture(t);
  const snapshot = projection(root);
  fs.writeFileSync(path.join(root, "extra.ts"), "unobserved", "utf8");
  const tree = stage(root);
  assert.throws(() => exact.assertExactProjectionMatchesCompleteGitTree(snapshot, root, tree), { name: "DomainValidationError", message: /path|file|match/i });
});

test("projection equality refuses source bytes changed after capture", (t) => {
  const root = fixture(t);
  const snapshot = projection(root);
  fs.writeFileSync(path.join(root, "src", "index.ts"), "export const answer = 43;\n", "utf8");
  const tree = stage(root);
  assert.throws(() => exact.assertExactProjectionMatchesCompleteGitTree(snapshot, root, tree), { name: "DomainValidationError", message: /byte|content|match/i });
});

test("projection equality refuses a Git executable-mode change", (t) => {
  const root = fixture(t);
  stage(root);
  const snapshot = projection(root);
  git(root, ["update-index", "--chmod=+x", "src/index.ts"]);
  const tree = git(root, ["write-tree"]);
  assert.throws(() => exact.assertExactProjectionMatchesCompleteGitTree(snapshot, root, tree), { name: "DomainValidationError", message: /mode|execut/i });
});

test("projection attributes refuse active conversion from repository metadata", (t) => {
  const root = fixture(t);
  const tree = stage(root);
  const snapshot = projection(root);
  for (const attribute of ["text", "eol=lf", "filter=fixture", "ident", "working-tree-encoding=UTF-16", "crlf"]) {
    fs.writeFileSync(path.join(root, ".git", "info", "attributes"), `src/index.ts ${attribute}\n`, "utf8");
    assert.throws(() => exact.assertProjectionGitAttributesPreserveBytes(snapshot, root, { beforeTree: tree, afterTree: tree }), { name: "DomainValidationError", message: /attribute|transform/i });
  }
});

test("projection attributes inspect both immutable trees despite worktree and index masking", (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, ".gitattributes"), "src/index.ts text\n", "utf8");
  const transformed = stage(root);
  fs.writeFileSync(path.join(root, ".gitattributes"), "src/index.ts -text\n", "utf8");
  const safe = stage(root);
  const snapshot = projection(root);
  assert.throws(() => exact.assertProjectionGitAttributesPreserveBytes(snapshot, root, { beforeTree: transformed, afterTree: safe }), { name: "DomainValidationError", message: /attribute|transform/i });
  assert.throws(() => exact.assertProjectionGitAttributesPreserveBytes(snapshot, root, { beforeTree: safe, afterTree: transformed }), { name: "DomainValidationError", message: /attribute|transform/i });
});

test("traversal metadata counts excluded children without descending into prepared subtrees", (t) => {
  const root = fixture(t);
  const snapshot = projection(root);
  // Root observes .git, .gitignore, node_modules and src; src observes index.ts.
  assert.equal(exact.exactSnapshotTraversalEntries(snapshot), 5);
  assert.deepEqual(Object.keys(snapshot).sort(), ["byteLength", "fileCount"]);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), { fileCount: 2, byteLength: 40 });
  fs.mkdirSync(path.join(root, "node_modules", "another", "deeper"), { recursive: true });
  fs.writeFileSync(path.join(root, "node_modules", "another", "deeper", "dependency"), "excluded", "utf8");
  assert.equal(exact.exactSnapshotTraversalEntries(projection(root)), 5);
  assert.equal(exact.exactSnapshotTraversalEntries(snapshot), 5);
});

test("projection operations and traversal metadata reject copied snapshot handles", (t) => {
  const root = fixture(t);
  const tree = stage(root);
  const snapshot = projection(root);
  for (const copied of [{ ...snapshot }, JSON.parse(JSON.stringify(snapshot))]) {
    assert.throws(() => exact.exactSnapshotTraversalEntries(copied), { name: "DomainValidationError", message: /genuine|handle/i });
    assert.throws(() => exact.assertExactProjectionMatchesCompleteGitTree(copied, root, tree), { name: "DomainValidationError", message: /genuine|handle/i });
    assert.throws(() => exact.assertProjectionGitAttributesPreserveBytes(copied, root, { beforeTree: tree, afterTree: tree }), { name: "DomainValidationError", message: /genuine|handle/i });
  }
});

test("projection content operations keep repository-root identity checks", (t) => {
  const root = fixture(t);
  const other = fixture(t);
  const tree = stage(other);
  const snapshot = projection(root);
  assert.throws(() => exact.assertExactProjectionMatchesCompleteGitTree(snapshot, other, tree), { name: "DomainValidationError", message: /repository|root/i });
  assert.throws(() => exact.assertProjectionGitAttributesPreserveBytes(snapshot, other, { beforeTree: tree, afterTree: tree }), { name: "DomainValidationError", message: /repository|root/i });
});
