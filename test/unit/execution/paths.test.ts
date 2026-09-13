import assert from "node:assert/strict";
import { mkdtempSync, symlinkSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { isPathInside, resolveInsideRoot } from "../../../src/execution/paths.js";

test("isPathInside accepts root and nested paths", () => {
  const root = path.resolve("/tmp/wt-root");
  assert.equal(isPathInside(root, root), true);
  assert.equal(isPathInside(path.join(root, "src/a.ts"), root), true);
});

test("isPathInside rejects siblings and escapes", () => {
  const root = path.resolve("/tmp/wt-root");
  assert.equal(isPathInside(path.resolve("/tmp/wt-root-other/x"), root), false);
  assert.equal(isPathInside(path.resolve("/tmp/other"), root), false);
});

test("resolveInsideRoot refuses .. escape", () => {
  const root = path.resolve("/tmp/wt-root");
  assert.throws(() => resolveInsideRoot(root, "../secret"), /path escape refused/);
  assert.throws(() => resolveInsideRoot(root, "/etc/passwd"), /path escape refused/);
});

test("resolveInsideRoot accepts relative inside", () => {
  const root = path.resolve("/tmp/wt-root");
  assert.equal(resolveInsideRoot(root, "src/a.ts"), path.join(root, "src/a.ts"));
});

test("resolveInsideRoot refuses symlink to outside file", () => {
  const root = mkdtempSync(path.join(tmpdir(), "g1b-path-"));
  const outside = mkdtempSync(path.join(tmpdir(), "g1b-out-"));
  try {
    const sentinel = path.join(outside, "secret.txt");
    writeFileSync(sentinel, "SENSITIVE\n", "utf8");
    const link = path.join(root, "leak.txt");
    try {
      symlinkSync(sentinel, link);
    } catch (err) {
      // Windows may lack symlink privilege — skip with explicit marker (plan: cannot close by skip alone;
      // record and still assert lexical escapes work). Soft-skip only this case.
      const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
      if (code === "EPERM" || code === "EACCES") {
        assert.ok(true, `symlink skipped on this host (${code})`);
        return;
      }
      throw err;
    }
    assert.throws(() => resolveInsideRoot(root, "leak.txt"), /path escape refused|symlink/);
    assert.equal(readFileSync(sentinel, "utf8"), "SENSITIVE\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("resolveInsideRoot refuses parent-dir symlink then nested create path", () => {
  const root = mkdtempSync(path.join(tmpdir(), "g1b-path-"));
  const outside = mkdtempSync(path.join(tmpdir(), "g1b-out-"));
  try {
    writeFileSync(path.join(outside, "secret.txt"), "SENSITIVE\n", "utf8");
    const linkedParent = path.join(root, "ext");
    try {
      symlinkSync(outside, linkedParent);
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
      if (code === "EPERM" || code === "EACCES") {
        assert.ok(true, `symlink skipped on this host (${code})`);
        return;
      }
      throw err;
    }
    assert.throws(() => resolveInsideRoot(root, "ext/secret.txt"), /path escape refused|symlink/);
    assert.equal(readFileSync(path.join(outside, "secret.txt"), "utf8"), "SENSITIVE\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
