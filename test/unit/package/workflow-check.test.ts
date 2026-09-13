import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(new URL("../../..", import.meta.url).pathname.replace(/^\/(.:)/, "$1"));
const checker = join(repoRoot, "scripts", "workflow-check.mjs");

async function runChecker(root: string) {
  try {
    const result = await execFileAsync(process.execPath, [checker, "--root", root], {
      cwd: repoRoot
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return {
      exitCode: failure.code ?? 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? ""
    };
  }
}

test("workflow check reports missing governance files", async () => {
  const root = await mkdtemp(join(tmpdir(), "sparkle-workflow-"));
  try {
    await writeFile(join(root, "package.json"), "{}\n", "utf8");
    const result = await runChecker(root);

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /missing required file: AGENTS\.md/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repository workflow contract is complete", async () => {
  const result = await runChecker(repoRoot);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /workflow-check: ok/);
});
