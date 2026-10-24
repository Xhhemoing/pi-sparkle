import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { taskSpecPreflightCommand } from "../../../src/cli/task-spec.js";
import type { DevelopmentTaskSpec } from "../../../src/development/task-spec.js";

const sourceText = "hello 世界\n";
const protectedText = "protected λ\n";
function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
async function fixture(body: (root: string, source: string, spec: DevelopmentTaskSpec) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "sparkle-preflight-resources-"));
  const source = path.join(root, "source");
  await mkdir(path.join(source, "checks"), { recursive: true });
  await writeFile(path.join(source, "value.txt"), sourceText, "utf8");
  await writeFile(path.join(source, "checks/guard.txt"), protectedText, "utf8");
  git(source, ["init"]); git(source, ["config", "core.autocrlf", "false"]);
  git(source, ["config", "user.name", "Resource fixture"]); git(source, ["config", "user.email", "fixture@example.invalid"]);
  git(source, ["add", "."]); git(source, ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
  try {
    await body(root, source, { version: 1, objective: "Check selected inputs", context: ["value.txt"],
      write: { allow: ["value.txt", "future.txt"], protect: ["checks"] },
      prepare: [{ id: "prepare", command: process.execPath, args: ["-e", "setTimeout(()=>{},30)"] }],
      checks: [{ id: "check", command: process.execPath, args: ["-e", "console.log('PRIVATE_CHECK_OUTPUT')"],
        verifierVersion: "v1", protectedPaths: ["checks"], visibleToWorker: false, expect: { baseline: "pass" } }],
      budget: { totalSeconds: 30, prepareSeconds: 3, workerSeconds: 4, checkSeconds: 5, checkTotalSeconds: 1.5 },
      worker: { model: "inherit" } });
    assert.equal(await readFile(path.join(source, "value.txt"), "utf8"), sourceText);
    assert.equal(await readFile(path.join(source, "checks/guard.txt"), "utf8"), protectedText);
    assert.equal(git(source, ["status", "--porcelain=v1", "--ignored"]), "");
  } finally {
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith("sparkle-preflight-resources-"));
    await rm(root, { recursive: true, force: true });
  }
}
async function run(root: string, source: string, spec: DevelopmentTaskSpec) {
  const specPath = path.join(root, "task.json");
  await writeFile(specPath, JSON.stringify(spec), "utf8");
  let stdout = ""; let stderr = "";
  const exit = await taskSpecPreflightCommand([specPath, "--project", source, "--state-root", path.join(root, "state"), "--json"], {
    stdout(text) { stdout += text; }, stderr(text) { stderr += text; }
  });
  const output = JSON.parse(stdout);
  const artifact = JSON.parse(await readFile(output.artifactPath, "utf8"));
  assert.equal(stdout.includes("PRIVATE_"), false);
  assert.equal(stderr.includes("PRIVATE_"), false);
  return { exit, output, artifact };
}

test("preflight CLI reports actual selected snapshot bytes and separate phase budget ratios", async () => fixture(async (root, source, spec) => {
  const { exit, output, artifact } = await run(root, source, spec);
  assert.equal(exit, 0);
  assert.ok(output.resources, "resource report must be present in the actual CLI projection");
  assert.deepEqual(output.resources, artifact.resources);
  assert.deepEqual(output.resources.snapshot, { scope: "task-inputs", fileCount: 2,
    byteLength: Buffer.byteLength(sourceText) + Buffer.byteLength(protectedText) });
  assert.equal(output.resources.preparation.budgetMs, 3000);
  assert.equal(output.resources.checks.budgetMs, 1500);
  assert.ok(output.resources.preparation.elapsedMs >= 30);
  assert.ok(output.resources.checks.elapsedMs > 0);
  assert.equal(output.resources.preparation.elapsedMs, output.preparationMs);
  assert.equal(output.resources.checks.elapsedMs, output.checksMs);
  assert.equal(output.resources.preparation.budgetRatio, output.preparationMs / 3000);
  assert.equal(output.resources.checks.budgetRatio, output.checksMs / 1500);
  assert.match(artifact.checks[0].result.stdoutText, /PRIVATE_CHECK_OUTPUT/);
}));

test("preflight resource observations remain null when required context is unavailable", async () => fixture(async (root, source, spec) => {
  const { exit, output, artifact } = await run(root, source, { ...spec, context: ["missing.md"] });
  assert.notEqual(exit, 0);
  assert.ok(output.resources, "unreached resources must be explicit rather than fabricated zero observations");
  assert.deepEqual(output.resources, artifact.resources);
  assert.equal(output.resources.snapshot, null);
  assert.deepEqual(output.resources.preparation, { budgetMs: 3000, elapsedMs: null, budgetRatio: null });
  assert.deepEqual(output.resources.checks, { budgetMs: 1500, elapsedMs: null, budgetRatio: null });
  assert.equal(artifact.preparation.length, 0); assert.equal(artifact.checks.length, 0);
}));

test("failed preparation retains actual resource timing and leaves checks unobserved", async () => fixture(async (root, source, spec) => {
  const { exit, output, artifact } = await run(root, source, { ...spec,
    prepare: [{ id: "broken", command: process.execPath, args: ["-e", "console.error('PRIVATE_PREP_FAILURE');process.exit(4)"] }] });
  assert.notEqual(exit, 0);
  assert.ok(output.resources);
  assert.deepEqual(output.resources, artifact.resources);
  assert.equal(output.resources.snapshot.fileCount, 2);
  assert.ok(output.resources.preparation.elapsedMs > 0);
  assert.ok(output.resources.preparation.budgetRatio > 0);
  assert.deepEqual(output.resources.checks, { budgetMs: 1500, elapsedMs: null, budgetRatio: null });
  assert.equal(artifact.preparation[0].result.exitCode, 4);
  assert.equal(artifact.checks.length, 0);
}));
