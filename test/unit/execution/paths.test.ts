import assert from "node:assert/strict";
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
