import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const script = fileURLToPath(new URL("../../../scripts/status.mjs", import.meta.url));

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "sparkle-status-"));
  await mkdir(join(root, "tasks"));
  await writeFile(join(root, "package.json"), JSON.stringify({
    version: "1.2.3-preview.4", private: true,
    repository: { url: "git+https://github.com/example/project.git" }
  }), "utf8");
  await writeFile(join(root, "tasks/todo.md"), "# Tasks\n- [ ] 未完成工作 [details](../docs/detail.md#next)\n- [x] Finished\n", "utf8");
  return root;
}

test("status reflects Git and package metadata, keeps open tasks, and regenerates deterministically", async () => {
  const root = await fixture();
  try {
    await exec("git", ["init", "--initial-branch=sample"], { cwd: root });
    await exec("git", ["-c", "user.name=Status Test", "-c", "user.email=status@example.invalid",
      "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "fixture"], { cwd: root });
    const { stdout: commit } = await exec("git", ["rev-parse", "HEAD"], { cwd: root });
    await exec(process.execPath, [script, "--root", root]);
    const first = await readFile(join(root, "STATUS.md"), "utf8");
    assert.match(first, /1\.2\.3-preview\.4/);
    assert.match(first, /private: true/);
    assert.match(first, /sample/);
    assert.ok(first.includes(commit.trim()));
    assert.match(first, /未完成工作/);
    assert.ok(first.includes("[details](docs/detail.md#next)"));
    assert.doesNotMatch(first, /Finished/);
    assert.match(first, /CI: unknown/);
    assert.match(first, /https:\/\/github\.com\/example\/project\/actions/);
    await exec(process.execPath, [script, "--root", root]);
    assert.equal(await readFile(join(root, "STATUS.md"), "utf8"), first);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("status creates nested output parents and resolves links without creating a root snapshot", async () => {
  const root = await fixture();
  try {
    await exec(process.execPath, [script, "--root", root, "--output", ".agent_workspace/ci/STATUS.md"]);
    const result = await readFile(join(root, ".agent_workspace/ci/STATUS.md"), "utf8");
    assert.match(result, /Branch: unknown/);
    assert.match(result, /Commit: unknown/);
    assert.ok(result.includes("[status matrix](../../docs/status-matrix.md)"));
    assert.ok(result.includes("[checklist](../../tasks/todo.md)"));
    assert.ok(result.includes("[details](../../docs/detail.md#next)"));
    await assert.rejects(access(join(root, "STATUS.md")), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
});
