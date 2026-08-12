import assert from "node:assert/strict";
import { test } from "node:test";
import { createProjectId } from "../../../src/domain/ids.js";
import { validateProjectSnapshot } from "../../../src/domain/project.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

const snapshot = {
  id: createProjectId(UUID),
  rootPath: "/tmp/demo",
  gitRootPath: "/tmp/demo",
  discoveredAt: "2026-08-12T09:00:00.000Z",
  instructionFiles: [{ path: "/tmp/demo/AGENTS.md" }],
  manifests: [{ path: "/tmp/demo/package.json" }],
  commands: [{ name: "test", command: "pnpm test" }],
  facts: [{ key: "language", value: "typescript", confidence: "HIGH" }]
};

test("a valid project snapshot validates", () => {
  assert.deepEqual(validateProjectSnapshot(snapshot), snapshot);
});

test("a snapshot without an optional git root validates", () => {
  const { gitRootPath: _gitRootPath, ...withoutGit } = snapshot;
  assert.deepEqual(validateProjectSnapshot(withoutGit), withoutGit);
});

test("invalid project snapshots are rejected", () => {
  assert.throws(() => validateProjectSnapshot({ ...snapshot, id: "nope" }), /id/);
  assert.throws(() => validateProjectSnapshot({ ...snapshot, rootPath: "" }), /rootPath/);
  assert.throws(() => validateProjectSnapshot({ ...snapshot, gitRootPath: 42 }), /gitRootPath/);
  assert.throws(() => validateProjectSnapshot({ ...snapshot, discoveredAt: "yesterday" }), /discoveredAt/);
  assert.throws(() => validateProjectSnapshot({ ...snapshot, instructionFiles: [{ path: "" }] }), /instructionFiles/);
  assert.throws(() => validateProjectSnapshot({ ...snapshot, manifests: "none" }), /manifests/);
  assert.throws(() => validateProjectSnapshot({ ...snapshot, commands: [{ name: "", command: "x" }] }), /commands/);
  assert.throws(
    () => validateProjectSnapshot({ ...snapshot, facts: [{ key: "a", value: "b", confidence: "MAYBE" }] }),
    /facts/
  );
  assert.throws(() => validateProjectSnapshot({ ...snapshot, facts: undefined }), /facts/);
});
