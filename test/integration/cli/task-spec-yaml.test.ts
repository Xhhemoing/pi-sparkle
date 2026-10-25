import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { stringify } from "yaml";

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
async function fixture(extension: string) {
  const parent = path.resolve(".agent_workspace"); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "yml-")), repo = path.join(root, "source"), marker = path.join(root, "executed.txt");
  await mkdir(path.join(repo, "src"), { recursive: true }); await mkdir(path.join(repo, "checks"));
  await writeFile(path.join(repo, "src/value.txt"), "42\n", "utf8");
  await writeFile(path.join(repo, "checks/check.cjs"),
    "const f=require('node:fs');require('node:assert/strict').equal(f.readFileSync('src/value.txt','utf8'),'42\\n');" +
    "f.appendFileSync(process.argv[2],'check\\n');console.log('PRIVATE_CHECK_DATA');", "utf8");
  git(repo, ["init", "-b", "fixture"]); git(repo, ["config", "core.autocrlf", "false"]);
  git(repo, ["config", "user.name", "TaskSpec YAML fixture"]); git(repo, ["config", "user.email", "fixture@example.invalid"]);
  git(repo, ["add", "."]); git(repo, ["-c", "commit.gpgsign=false", "commit", "-m", "synthetic fixture"]);
  const revision = git(repo, ["rev-parse", "HEAD"]), file = path.join(root, "task." + extension), state = path.join(root, "state");
  const spec = { version: 1, objective: "Check literal source content", context: ["src/value.txt"],
    write: { allow: ["src"], protect: ["checks"] },
    prepare: [{ id: "prepare", command: process.execPath, args: ["-e", "require('node:fs').appendFileSync(process.argv[1],'prepare\\n')", marker] }],
    checks: [{ id: "value", command: process.execPath, args: ["checks/check.cjs", marker], verifierVersion: "v1",
      protectedPaths: ["checks"], visibleToWorker: false, expect: { baseline: "pass" } }],
    budget: { totalSeconds: 30, prepareSeconds: 10, checkSeconds: 8, workerSeconds: 10 } };
  await writeFile(file, "# explicit host-reviewed YAML\n" + stringify(spec), "utf8");
  return { root, repo, marker, file, state, revision };
}
function run(f: Awaited<ReturnType<typeof fixture>>) {
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/cli/main.ts", "preflight", f.file,
    "--project", f.repo, "--state-root", f.state, "--json"], {
    cwd: process.cwd(), encoding: "utf8", windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024
  });
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  return result;
}
for (const extension of ["yaml", "YML"]) test("actual preflight accepts ." + extension + " and executes private checks without source mutation", { timeout: 80000 }, async () => {
  const f = await fixture(extension), result = run(f);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout) as { ok: boolean; effectsSettled: boolean; candidateDisposition: string; artifactPath: string };
  assert.equal(output.ok, true); assert.equal(output.effectsSettled, true); assert.equal(output.candidateDisposition, "removed");
  assert.equal(await readFile(f.marker, "utf8"), "prepare\ncheck\n");
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_CHECK_DATA/);
  assert.match(await readFile(output.artifactPath, "utf8"), /PRIVATE_CHECK_DATA/);
  assert.equal(git(f.repo, ["rev-parse", "HEAD"]), f.revision);
  assert.equal(git(f.repo, ["status", "--porcelain=v1", "--untracked-files=all", "--ignored"]), "");
  assert.equal(await readFile(path.join(f.repo, "src/value.txt"), "utf8"), "42\n");
});
for (const invalid of ["multiple-documents", "duplicate-key", "JSON-extension", "private-key"] as const) test("actual preflight rejects " + invalid + " before preparation or state creation", async () => {
  const f = await fixture(invalid === "JSON-extension" ? "json" : "yaml");
  if (invalid !== "JSON-extension") {
    const extra = invalid === "multiple-documents" ? "---\nversion: 2\n" :
      invalid === "private-key" ? "PRIVATE_YAML_SOURCE_CONTENT_MUST_NOT_REACH_DIAGNOSTICS: true\n" : "version: 1\n";
    await writeFile(f.file, await readFile(f.file, "utf8") + extra, "utf8");
  }
  const result = run(f);
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_YAML_SOURCE_CONTENT_MUST_NOT_REACH_DIAGNOSTICS/);
  await assert.rejects(access(f.marker), { code: "ENOENT" }); await assert.rejects(access(f.state), { code: "ENOENT" });
  assert.equal(git(f.repo, ["rev-parse", "HEAD"]), f.revision);
  assert.equal(await readFile(path.join(f.repo, "src/value.txt"), "utf8"), "42\n");
});
