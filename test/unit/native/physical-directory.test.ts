import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { mkdtemp, mkdir, symlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { physicalDirectoryWithoutLinks } from "../../../src/native/physical-directory.js";

test("physical directory keeps native identity and equivalent syntax", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "physical-dir-"));
  try {
    const child = path.join(root, "directory with spaces");
    await mkdir(child);
    assert.equal(physicalDirectoryWithoutLinks(child), realpathSync.native(child));
    assert.equal(physicalDirectoryWithoutLinks(path.join(child, ".")), realpathSync.native(child));
  } finally { await rm(root, { recursive: true, force: true }); }
});
for (const ancestor of [false, true]) {
  test(`physical directory rejects a link at ${ancestor ? "ancestor" : "leaf"}`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "physical-dir-"));
    try {
      const child = path.join(root, "child");
      await mkdir(child);
      const alias = path.join(root, "alias");
      await symlink(ancestor ? root : child, alias, process.platform === "win32" ? "junction" : "dir");
      assert.throws(() => physicalDirectoryWithoutLinks(ancestor ? path.join(alias, "child") : alias), /link aliases/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
test("physical directory refuses missing and nondirectory paths", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "physical-dir-"));
  try {
    assert.throws(() => physicalDirectoryWithoutLinks(path.join(root, "missing")), /inaccessible/);
    await writeFile(path.join(root, "file"), "data");
    assert.throws(() => physicalDirectoryWithoutLinks(path.join(root, "file")), /directory/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
