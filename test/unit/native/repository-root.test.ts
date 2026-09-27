import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { prepareNativeWrite } from "../../../src/native/write-preflight.js";

const git = (cwd: string, args: string[]): string => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const preflight = (sourceRepo: string) => prepareNativeWrite({
  sourceRepo, objective: "inspect root", verification: { command: process.execPath, args: ["--version"] }
});
async function fixture(body: (root: string, repo: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "root-identity-"));
  const repo = path.join(root, "repo with spaces");
  try {
    await mkdir(repo);
    git(repo, ["init"]);
    git(repo, ["config", "user.name", "Root Test"]);
    git(repo, ["config", "user.email", "test@example.com"]);
    await writeFile(path.join(repo, "value.txt"), "before\n");
    git(repo, ["add", "value.txt"]);
    git(repo, ["commit", "-m", "fixture"]);
    await body(root, repo);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("native preflight accepts actual temporary root and returns its physical Git root", async (t) => {
  await fixture(async (_root, repo) => {
    const top = git(repo, ["rev-parse", "--show-toplevel"]);
    t.diagnostic(JSON.stringify({ requested: path.resolve(repo), top: path.resolve(top), real: realpathSync.native(repo) }));
    assert.equal(preflight(repo).sourceRepo, realpathSync.native(repo));
    assert.equal(preflight(`${repo}${path.sep}.`).sourceRepo, realpathSync.native(repo));
  });
});

test("native preflight refuses a subdirectory even in the same repository", async () => {
  await fixture(async (_root, repo) => {
    const sub = path.join(repo, "src");
    await mkdir(sub);
    assert.throws(() => preflight(sub), /toplevel|root/i);
  });
});

for (const ancestor of [false, true]) {
  test(`native preflight refuses ${ancestor ? "ancestor" : "root"} directory link aliases`, async () => {
    await fixture(async (root, repo) => {
      const link = path.join(root, "alias");
      await symlink(ancestor ? root : repo, link, process.platform === "win32" ? "junction" : "dir");
      const aliased = ancestor ? path.join(link, path.basename(repo)) : link;
      assert.throws(() => preflight(aliased), /alias|link|toplevel|root/i);
      assert.equal(git(repo, ["status", "--porcelain=v1", "-z", "--ignored"]), "");
    });
  });
}
