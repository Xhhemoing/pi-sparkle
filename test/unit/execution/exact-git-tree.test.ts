import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  assertExactSnapshotMatchesGitTree,
  assertGitAttributesPreserveExactBytes,
  captureExactSnapshot
} from "../../../src/execution/exact-snapshot.js";

function git(root: string, args: string[], input?: Buffer | string): string {
  const result = spawnSync("git", ["-C", root, ...args], {
    input, encoding: "utf8", maxBuffer: 2 * 1024 * 1024, timeout: 10_000,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_ATTR_NOSYSTEM: "1" }
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixture(t: { after(fn: () => void): void }): string {
  const root = fs.mkdtempSync(path.join(tmpdir(), "sparkle-exact-tree-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.email", "fixture@example.invalid"]);
  git(root, ["config", "user.name", "Fixture"]);
  git(root, ["config", "core.autocrlf", "false"]);
  git(root, ["config", "core.eol", "lf"]);
  git(root, ["config", "core.attributesFile", path.join(root, ".git", "empty-attributes")]);
  fs.writeFileSync(path.join(root, "file"), "same");
  return root;
}

function stage(root: string): string {
  git(root, ["add", "--all"]);
  return git(root, ["write-tree"]);
}

function blob(root: string, bytes: Buffer | string): string {
  return git(root, ["hash-object", "-w", "--stdin"], bytes);
}

function rawTree(root: string, mode: string, type: string, object: string, name: Buffer | string): string {
  return git(root, ["mktree", "-z"], Buffer.concat([
    Buffer.from(`${mode} ${type} ${object}\t`), Buffer.from(name), Buffer.from([0])
  ]));
}

function attributes(root: string, beforeTree: string, afterTree = beforeTree): void {
  assertGitAttributesPreserveExactBytes(captureExactSnapshot(root), root, { beforeTree, afterTree });
}

test("raw tree equality supports binary, empty and nested UTF-8 files without exposing bytes", (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, "nested"));
  fs.writeFileSync(path.join(root, "nested", "中文 space.bin"), Buffer.from([0, 255, 1]));
  fs.writeFileSync(path.join(root, "empty"), "");
  const tree = stage(root);
  const snapshot = captureExactSnapshot(root);
  assert.doesNotThrow(() => assertExactSnapshotMatchesGitTree(snapshot, root, tree));
  assert.doesNotThrow(() => attributes(root, tree));
  assert.deepEqual(Object.keys(snapshot).sort(), ["byteLength", "fileCount"]);
  assert.equal(JSON.stringify(snapshot).includes("same"), false);
});

test("raw tree equality supports NUL-delimited tab and newline paths", { skip: process.platform === "win32" }, (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, "tab\tand\nnewline"), "data");
  const tree = stage(root);
  assert.doesNotThrow(() => assertExactSnapshotMatchesGitTree(captureExactSnapshot(root), root, tree));
  assert.doesNotThrow(() => attributes(root, tree));
});

test("raw tree equality rejects same-length blob differences", (t) => {
  const root = fixture(t);
  const snapshot = captureExactSnapshot(root);
  fs.writeFileSync(path.join(root, "file"), "evil");
  assert.throws(() => assertExactSnapshotMatchesGitTree(snapshot, root, stage(root)), /byte|content|match/i);
});

test("raw tree equality rejects duplicate path records", (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, "file"), "");
  const object = blob(root, "");
  const record = Buffer.from(`100644 blob ${object}\tfile\0`);
  const tree = git(root, ["mktree", "-z"], Buffer.concat([record, record]));
  assert.throws(() => assertExactSnapshotMatchesGitTree(captureExactSnapshot(root), root, tree), /duplicate|path|tree/i);
});

test("raw tree equality rejects missing, extra and ignored filesystem files", (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, ".gitignore"), "ignored\n");
  const tree = stage(root);
  fs.writeFileSync(path.join(root, "ignored"), "data");
  assert.throws(() => assertExactSnapshotMatchesGitTree(captureExactSnapshot(root), root, tree), /file|path|match/i);
  fs.rmSync(path.join(root, "ignored"));
  const snapshot = captureExactSnapshot(root);
  fs.writeFileSync(path.join(root, "extra"), "data");
  assert.throws(() => assertExactSnapshotMatchesGitTree(snapshot, root, stage(root)), /file|path|match/i);
  fs.rmSync(path.join(root, "extra"));
  fs.rmSync(path.join(root, "file"));
  assert.throws(() => assertExactSnapshotMatchesGitTree(snapshot, root, stage(root)), /file|path|match/i);
});

test("raw tree equality binds owner execute mode and ignores non-Git permission bits", { skip: process.platform === "win32" }, (t) => {
  const root = fixture(t);
  fs.chmodSync(path.join(root, "file"), 0o600);
  const snapshot = captureExactSnapshot(root);
  const object = blob(root, "same");
  assert.doesNotThrow(() => assertExactSnapshotMatchesGitTree(snapshot, root, rawTree(root, "100644", "blob", object, "file")));
  assert.throws(() => assertExactSnapshotMatchesGitTree(snapshot, root, rawTree(root, "100755", "blob", object, "file")), /mode|execut/i);
  fs.chmodSync(path.join(root, "file"), 0o710);
  assert.doesNotThrow(() => assertExactSnapshotMatchesGitTree(captureExactSnapshot(root), root, rawTree(root, "100755", "blob", object, "file")));
});

test("Windows raw tree comparison refuses executable trees", { skip: process.platform !== "win32" }, (t) => {
  const root = fixture(t);
  const tree = rawTree(root, "100755", "blob", blob(root, "same"), "file");
  assert.throws(() => assertExactSnapshotMatchesGitTree(captureExactSnapshot(root), root, tree), /mode|execut|Windows/i);
});

test("raw tree equality rejects symlink and submodule entries", (t) => {
  const root = fixture(t);
  const snapshot = captureExactSnapshot(root);
  const link = rawTree(root, "120000", "blob", blob(root, "same"), "file");
  assert.throws(() => assertExactSnapshotMatchesGitTree(snapshot, root, link), /mode|link|regular|unsupported/i);
  const commit = git(root, ["commit-tree", stage(root), "-m", "fixture"]);
  const submodule = rawTree(root, "160000", "commit", commit, "file");
  assert.throws(() => assertExactSnapshotMatchesGitTree(snapshot, root, submodule), /mode|module|regular|unsupported/i);
});

test("raw tree equality refuses filesystem and Git empty directories", (t) => {
  const root = fixture(t);
  const tree = stage(root);
  fs.mkdirSync(path.join(root, "empty"));
  assert.throws(() => assertExactSnapshotMatchesGitTree(captureExactSnapshot(root), root, tree), /director|path|match/i);
  fs.rmdirSync(path.join(root, "empty"));
  const emptyTree = git(root, ["mktree"], "");
  const treeWithEmpty = git(root, ["mktree"], `040000 tree ${emptyTree}\tempty\n100644 blob ${blob(root, "same")}\tfile\n`);
  assert.throws(() => assertExactSnapshotMatchesGitTree(captureExactSnapshot(root), root, treeWithEmpty), /director|path|match/i);
});

test("raw tree equality refuses invalid UTF-8 and unsafe raw names", (t) => {
  const root = fixture(t);
  for (const name of [Buffer.from([0xff]), Buffer.from("bad\\name"), Buffer.from(".git")]) {
    const tree = rawTree(root, "100644", "blob", blob(root, "same"), name);
    assert.throws(() => assertExactSnapshotMatchesGitTree(captureExactSnapshot(root), root, tree), /path|encoding|unsupported/i);
  }
});

test("both boundaries refuse copied handles and partial snapshot scopes", (t) => {
  const root = fixture(t);
  const tree = stage(root);
  const snapshot = captureExactSnapshot(root);
  const invalid = [{ ...snapshot }, JSON.parse(JSON.stringify(snapshot)), captureExactSnapshot(root, { includePrefixes: ["file"] }), captureExactSnapshot(root, { excludePrefixes: ["unused"] })];
  for (const value of invalid) {
    assert.throws(() => assertExactSnapshotMatchesGitTree(value, root, tree), /handle|whole|scope|snapshot/i);
    assert.throws(() => assertGitAttributesPreserveExactBytes(value, root, { beforeTree: tree, afterTree: tree }), /handle|whole|scope|snapshot/i);
  }
});

test("both boundaries require full immutable tree object addresses", (t) => {
  const root = fixture(t);
  const tree = stage(root);
  const snapshot = captureExactSnapshot(root);
  const commit = git(root, ["commit-tree", tree, "-m", "fixture"]);
  for (const invalid of ["HEAD", tree.slice(0, 12), `${tree}^{tree}`, "--all", "0".repeat(40), blob(root, "same"), commit]) {
    assert.throws(() => assertExactSnapshotMatchesGitTree(snapshot, root, invalid), /tree|object|address|Git/i);
    assert.throws(() => assertGitAttributesPreserveExactBytes(snapshot, root, { beforeTree: invalid, afterTree: tree }), /tree|object|address|Git/i);
  }
});

test("Git tree reads retain capture-time file and byte limits despite caller mutation", (t) => {
  const root = fixture(t);
  const limits = { maxFiles: 1, maxBytes: 4 };
  const snapshot = captureExactSnapshot(root, {}, limits);
  limits.maxFiles = 100;
  limits.maxBytes = 100_000;
  fs.writeFileSync(path.join(root, "extra"), "x");
  assert.throws(() => assertExactSnapshotMatchesGitTree(snapshot, root, stage(root)), /file.*limit|limit.*file/i);
  fs.rmSync(path.join(root, "extra"));
  fs.writeFileSync(path.join(root, "file"), "large");
  assert.throws(() => assertExactSnapshotMatchesGitTree(snapshot, root, stage(root)), /byte.*limit|limit.*byte/i);
});

test("Git tree path-list output is capped before unbounded parsing", (t) => {
  const root = fixture(t);
  const snapshot = captureExactSnapshot(root, {}, { maxFiles: 1, maxBytes: 4 });
  const object = blob(root, "same");
  const entries = Array.from({ length: 100 }, (_, i) => `100644 blob ${object}\t${String(i).padStart(3, "0")}${"x".repeat(180)}\n`).join("");
  const tree = git(root, ["mktree"], entries);
  assert.throws(() => assertExactSnapshotMatchesGitTree(snapshot, root, tree), /bound|limit|Git.*read/i);
});

test("raw object reads disable Git replacement refs", (t) => {
  const root = fixture(t);
  const good = blob(root, "same");
  const bad = blob(root, "evil");
  const tree = rawTree(root, "100644", "blob", bad, "file");
  git(root, ["replace", bad, good]);
  assert.equal(git(root, ["cat-file", "blob", bad]), "same");
  assert.throws(() => assertExactSnapshotMatchesGitTree(captureExactSnapshot(root), root, tree), /byte|content|match/i);
});

test("attribute boundary rejects every active conversion attribute in current worktree", (t) => {
  const root = fixture(t);
  const tree = stage(root);
  for (const value of ["filter=example", "text", "text=auto", "eol=lf", "ident", "working-tree-encoding=UTF-16", "crlf"]) {
    fs.writeFileSync(path.join(root, ".gitattributes"), `file ${value}\n`);
    assert.throws(() => attributes(root, tree), /attribute|transform/i);
  }
});

test("attribute boundary accepts explicit disabling and binary macros without an encoding override", (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, ".gitattributes"), "file -filter -text -eol -ident -crlf binary\n");
  const tree = stage(root);
  assert.doesNotThrow(() => attributes(root, tree));
});

test("attribute boundary rejects cached attributes masked by current worktree", (t) => {
  const root = fixture(t);
  const before = stage(root);
  fs.writeFileSync(path.join(root, ".gitattributes"), "file text\n");
  stage(root);
  fs.writeFileSync(path.join(root, ".gitattributes"), "file -text\n");
  assert.throws(() => attributes(root, before), /attribute|transform/i);
});

test("attribute boundary checks both immutable old and new trees despite current/cache masking", (t) => {
  const root = fixture(t);
  const safe = stage(root);
  fs.writeFileSync(path.join(root, ".gitattributes"), "file text\n");
  const transformed = stage(root);
  fs.writeFileSync(path.join(root, ".gitattributes"), "file -text\n");
  stage(root);
  assert.throws(() => attributes(root, transformed, safe), /attribute|transform/i);
  assert.throws(() => attributes(root, safe, transformed), /attribute|transform/i);
});

test("attribute queries include old-tree-only and target-tree-only paths", (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, "removed"), "data");
  const before = stage(root);
  fs.rmSync(path.join(root, "removed"));
  const after = stage(root);
  fs.writeFileSync(path.join(root, ".git", "info", "attributes"), "removed text\n");
  assert.throws(() => attributes(root, before, after), /attribute|transform/i);
  assert.throws(() => attributes(root, after, before), /attribute|transform/i);
});

test("attribute queries observe repository info and configured external attribute sources", (t) => {
  const root = fixture(t);
  const tree = stage(root);
  const info = path.join(root, ".git", "info", "attributes");
  fs.writeFileSync(info, "file ident\n");
  assert.throws(() => attributes(root, tree), /attribute|transform/i);
  fs.rmSync(info);
  fs.writeFileSync(path.join(root, ".git", "empty-attributes"), "file text\n");
  assert.throws(() => attributes(root, tree), /attribute|transform/i);
});

test("attribute queries refuse a nested Git working directory", (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, "nested"));
  fs.writeFileSync(path.join(root, "nested", "other"), "data");
  const tree = stage(root);
  fs.writeFileSync(path.join(root, ".gitattributes"), "file text\n");
  assert.throws(() => assertGitAttributesPreserveExactBytes(captureExactSnapshot(root), path.join(root, "nested"), { beforeTree: tree, afterTree: tree }), /root|repository|attribute|transform/i);
});

test("CRLF normalization cannot bind a checked worktree to a different raw tree", (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, ".gitattributes"), "file text eol=lf\n");
  fs.writeFileSync(path.join(root, "file"), "one\r\ntwo\r\n");
  const snapshot = captureExactSnapshot(root);
  const tree = stage(root);
  assert.throws(() => assertExactSnapshotMatchesGitTree(snapshot, root, tree), /byte|content|match/i);
  assert.throws(() => attributes(root, tree), /attribute|transform/i);
});

test("attribute assertions inspect rules without executing configured clean filters", (t) => {
  const root = fixture(t);
  const tree = stage(root);
  git(root, ["config", "filter.reject.clean", "exit 42"]);
  git(root, ["config", "filter.reject.required", "true"]);
  fs.writeFileSync(path.join(root, ".gitattributes"), "file filter=reject\n");
  assert.throws(() => attributes(root, tree), /attribute|transform/i);
});

test("attribute sentinel filter drivers are refused before a clean filter can execute", (t) => {
  const root = fixture(t);
  const before = stage(root);
  fs.writeFileSync(path.join(root, ".git", "filter.cjs"), "const fs = require('node:fs'); fs.writeFileSync('.git/filter-ran', 'yes'); process.stdout.write(fs.readFileSync(0, 'utf8').replace('same', 'evil'));\n");
  for (const driver of ["unset", "unspecified"]) {
    git(root, ["config", `filter.${driver}.clean`, "node .git/filter.cjs"]);
    fs.writeFileSync(path.join(root, ".gitattributes"), `file filter=${driver}\n`);
    // Force a real worktree/index content transition; Git may otherwise skip
    // the clean driver when the file's bytes and stat cache are unchanged.
    fs.writeFileSync(path.join(root, "file"), "same!");
    const transformed = stage(root);
    assert.equal(git(root, ["cat-file", "blob", `${transformed}:file`]), "evil!");
    assert.equal(fs.readFileSync(path.join(root, ".git", "filter-ran"), "utf8"), "yes");
    fs.rmSync(path.join(root, ".git", "filter-ran"));
    assert.throws(() => attributes(root, before), /attribute|filter|transform/i);
    assert.equal(fs.existsSync(path.join(root, ".git", "filter-ran")), false);
    git(root, ["config", "--unset", `filter.${driver}.clean`]);
  }
});

test("encoding sentinel assignments are conservatively refused, including explicit disabling", (t) => {
  const root = fixture(t);
  const tree = stage(root);
  for (const value of ["working-tree-encoding=unset", "working-tree-encoding=unspecified", "-working-tree-encoding"]) {
    fs.writeFileSync(path.join(root, ".gitattributes"), `file ${value}\n`);
    assert.throws(() => attributes(root, tree), /attribute|encoding|transform/i);
  }
});

test("raw tree comparison preserves BOM and Unicode normalization distinctions", (t) => {
  const root = fixture(t);
  const snapshot = captureExactSnapshot(root);
  const tree = rawTree(root, "100644", "blob", blob(root, "same"), "\ufefffile");
  assert.throws(() => assertExactSnapshotMatchesGitTree(snapshot, root, tree), /path|file|match/i);
  fs.rmSync(path.join(root, "file"));
  fs.writeFileSync(path.join(root, "\ufefffile"), "same");
  assert.doesNotThrow(() => assertExactSnapshotMatchesGitTree(captureExactSnapshot(root), root, tree));
});
