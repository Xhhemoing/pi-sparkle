import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main } from "../../../src/cli/main.js";
import { parseDevelopmentTaskSpec, type DevelopmentTaskSpec } from "../../../src/development/task-spec.js";

const REPO = process.cwd();
const retainedFixtureRoots = new Set<string>();
function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
async function fixture(body: (repo: string, root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "sparkle-task-cli-"));
  const repo = path.join(root, "source");
  await mkdir(path.join(repo, "src"), { recursive: true });
  await mkdir(path.join(repo, "test"));
  await writeFile(path.join(repo, "src/value.cjs"), "module.exports = 1;\n", "utf8");
  await writeFile(path.join(repo, "test/value.test.cjs"), "const assert=require('node:assert/strict');const {test}=require('node:test');test('value',()=>assert.equal(require('../src/value.cjs'),1));\n", "utf8");
  await writeFile(path.join(repo, "package.json"), JSON.stringify({ scripts: { test: "node --test test/value.test.cjs" } }), "utf8");
  await writeFile(path.join(repo, ".gitignore"), ".cache/\n", "utf8");
  git(repo, ["init"]); git(repo, ["config", "core.autocrlf", "false"]);
  git(repo, ["config", "user.name", "Task CLI fixture"]); git(repo, ["config", "user.email", "fixture@example.invalid"]);
  git(repo, ["add", "."]); git(repo, ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
  try { await body(repo, root); }
  finally {
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith("sparkle-task-cli-"));
    if (!retainedFixtureRoots.has(root)) await rm(root, { recursive: true, force: true });
  }
}
async function call(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = "", stderr = "";
  const code = await main(args, { stdout: (text) => { stdout += text; }, stderr: (text) => { stderr += text; } });
  return { code, stdout, stderr };
}
function spec(code: string): DevelopmentTaskSpec {
  return { version: 1, objective: "Check the fixture", context: ["package.json"], write: { allow: ["src"], protect: ["test", "package.json"] },
    prepare: [], checks: [{ id: "tests", command: process.execPath, args: ["-e", code], verifierVersion: "fixture-v1",
      protectedPaths: ["test", "package.json"], visibleToWorker: false, expect: { baseline: "pass" } }],
    budget: { totalSeconds: 30, prepareSeconds: 10, checkSeconds: 5, workerSeconds: 10 }, worker: { model: "inherit" } };
}
function entrypoint(args: string[], nodeArgs: string[] = []): { code: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [...nodeArgs, "--import", "tsx", "src/cli/main.ts", ...args],
    { cwd: REPO, encoding: "utf8", windowsHide: true, timeout: 30000 });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}
async function typescriptFixture(repo: string, extension: "ts" | "mts" | "cts"): Promise<void> {
  const source = extension === "cts" ? "const value: number = 7; module.exports = { value };\n" : "export const value: number = 7;\n";
  const header = extension === "cts"
    ? `const {test} = require('node:test'); const assert = require('node:assert/strict'); const result: {value: number} = require('../src/value.${extension}'); const value: number = result.value;`
    : `import {test} from 'node:test'; import assert from 'node:assert/strict'; import {value} from '../src/value.${extension}';`;
  await writeFile(path.join(repo, `src/value.${extension}`), source, "utf8");
  await writeFile(path.join(repo, `test/value.test.${extension}`), `${header}\nconst expected: number = 7; test('actual erasable TypeScript assertion', () => assert.equal(value, expected));\n`, "utf8");
  await writeFile(path.join(repo, "package.json"), JSON.stringify({ type: "module", scripts: { test: `node --test test/value.test.${extension}` } }), "utf8");
}

for (const extension of ["ts", "mts", "cts"] as const) {
  test(`TaskSpec TypeScript ${extension} draft runs actual typed tests through the real CLI`, async () => fixture(async (repo, root) => {
    await typescriptFixture(repo, extension);
    const initialized = entrypoint(["init", "--task", "--dir", repo, "--json"]);
    assert.equal(initialized.code, 0, initialized.stderr);
    assert.match(initialized.stdout, /type.check|type check/i);
    const file = path.join(repo, "sparkle.task.json");
    const draft = parseDevelopmentTaskSpec(await readFile(file, "utf8"));
    assert.deepEqual(draft.checks[0]!.args, ["--test", `test/value.test.${extension}`]);
    assert.equal(draft.checks[0]!.command, process.execPath);
    assert.ok(draft.write.protect.includes(`test/value.test.${extension}`));
    git(repo, ["add", "."]); git(repo, ["-c", "commit.gpgsign=false", "commit", "-m", "typed fixture"]);
    const revision = git(repo, ["rev-parse", "HEAD"]);
    const original = await readFile(path.join(repo, `src/value.${extension}`), "utf8");
    const checked = entrypoint(["preflight", file, "--project", repo, "--state-root", path.join(root, "state"), "--json"]);
    assert.equal(checked.code, 0, checked.stderr);
    const output = JSON.parse(checked.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.effectsSettled, true);
    assert.equal(output.candidateDisposition, "removed");
    assert.match(await readFile(output.artifactPath, "utf8"), /actual erasable TypeScript assertion/);
    assert.equal(git(repo, ["rev-parse", "HEAD"]), revision);
    assert.equal(git(repo, ["status", "--porcelain=v1"]), "");
    assert.equal(await readFile(path.join(repo, `src/value.${extension}`), "utf8"), original);
  }));
}

test("TaskSpec TypeScript init refuses a runtime without native stripping before writing", async () => fixture(async (repo) => {
  await typescriptFixture(repo, "ts");
  const result = entrypoint(["init", "--task", "--dir", repo, "--json"], ["--no-experimental-strip-types"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /native.*TypeScript|TypeScript.*strip/i);
  await assert.rejects(lstat(path.join(repo, "sparkle.task.json")), { code: "ENOENT" });
}));

test("TaskSpec TypeScript preflight refuses syntax requiring transformation rather than type erasure", async () => fixture(async (repo, root) => {
  await typescriptFixture(repo, "mts");
  await writeFile(path.join(repo, "src/value.mts"), "enum Value { Seven = 7 }; export const value: number = Value.Seven;\n", "utf8");
  const initialized = entrypoint(["init", "--task", "--dir", repo, "--json"]);
  assert.equal(initialized.code, 0, initialized.stderr);
  git(repo, ["add", "."]); git(repo, ["-c", "commit.gpgsign=false", "commit", "-m", "unsupported typed fixture"]);
  const revision = git(repo, ["rev-parse", "HEAD"]);
  const checked = entrypoint(["preflight", path.join(repo, "sparkle.task.json"), "--project", repo, "--state-root", path.join(root, "state"), "--json"]);
  assert.equal(checked.code, 1);
  const output = JSON.parse(checked.stdout);
  assert.equal(output.ok, false);
  assert.equal(output.effectsSettled, true);
  assert.match(await readFile(output.artifactPath, "utf8"), /ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX|enum.*not supported/i);
  assert.equal(git(repo, ["rev-parse", "HEAD"]), revision);
  assert.equal(git(repo, ["status", "--porcelain=v1"]), "");
}));

test("TaskSpec init creates a parser-valid draft without executing the real Node test", async () => fixture(async (repo, root) => {
  const marker = path.join(root, "test-ran");
  await writeFile(path.join(repo, "test/value.test.cjs"), `require('node:test').test('actual test',()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'ran'));\n`, "utf8");
  const result = await call(["init", "--task", "--dir", repo, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "draft");
  const draft = parseDevelopmentTaskSpec(await readFile(path.join(repo, "sparkle.task.json"), "utf8"));
  assert.equal(draft.checks[0]!.command, process.execPath);
  assert.deepEqual(draft.checks[0]!.args, ["--test", "test/value.test.cjs"]);
  assert.deepEqual(draft.checks[0]!.expect, { baseline: "pass" });
  assert.ok(draft.write.protect.includes("sparkle.task.json"));
  await assert.rejects(lstat(marker), { code: "ENOENT" });
}));

test("TaskSpec init rejects repeated task mode before writing a draft", async () => fixture(async (repo) => {
  const result = await call(["init", "--task", "--task", "--dir", repo, "--json"]);
  await assert.rejects(lstat(path.join(repo, "sparkle.task.json")), { code: "ENOENT" });
  assert.equal(result.code, 1, result.stderr);
}));

test("TaskSpec init refuses implicit Node test discovery with potentially unprotected source tests", async () => fixture(async (repo) => {
  await writeFile(path.join(repo, "src/other.test.cjs"), "require('node:test').test('source test',()=>{});\n", "utf8");
  await writeFile(path.join(repo, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }), "utf8");
  const result = await call(["init", "--task", "--dir", repo, "--json"]);
  await assert.rejects(lstat(path.join(repo, "sparkle.task.json")), { code: "ENOENT" });
  assert.equal(result.code, 1, result.stderr);
  assert.match(result.stderr, /explicit.*test.*file|implicit.*discovery/i);
}));

test("TaskSpec real entrypoint executes preparation and hidden checks only in its candidate", async () => fixture(async (repo, root) => {
  const definition = { ...spec("const f=require('node:fs');if(f.readFileSync('.cache/ready','utf8')!=='ready')throw Error('cold');console.log('CLI_HOST_ONLY_MARKER')"),
    prepare: [{ id: "warm", command: process.execPath, args: ["-e", "const f=require('node:fs');f.mkdirSync('.cache');f.writeFileSync('.cache/ready','ready')"] }] };
  const file = path.join(root, "task.json");
  await writeFile(file, JSON.stringify(definition), "utf8");
  const revision = git(repo, ["rev-parse", "HEAD"]);
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/cli/main.ts", "preflight", file, "--project", repo, "--state-root", path.join(root, "state"), "--json"],
    { cwd: REPO, encoding: "utf8", windowsHide: true, timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.effectsSettled, true);
  assert.equal(output.candidateDisposition, "removed");
  assert.doesNotMatch(result.stdout + result.stderr, /CLI_HOST_ONLY_MARKER/);
  assert.match(await readFile(output.artifactPath, "utf8"), /CLI_HOST_ONLY_MARKER/);
  assert.equal(git(repo, ["rev-parse", "HEAD"]), revision);
  assert.equal(git(repo, ["status", "--porcelain=v1"]), "");
  await assert.rejects(lstat(path.join(repo, ".cache")), { code: "ENOENT" });
}));

test("TaskSpec timeout keeps command output private and truthfully retains unsettled candidate", async () => fixture(async (repo, root) => {
  const definition = { ...spec(""), budget: { totalSeconds: 15, prepareSeconds: 0.5, checkSeconds: 5, workerSeconds: 5 },
    prepare: [{ id: "bounded", command: process.execPath, args: ["-e", "const f=require('node:fs');f.mkdirSync('.cache');f.writeFileSync('.cache/pid',String(process.pid));console.log('CLI_UNSETTLED_HOST_ONLY');setInterval(()=>{},1000)"] }] };
  const file = path.join(root, "task.json");
  await writeFile(file, JSON.stringify(definition), "utf8");
  retainedFixtureRoots.add(root);
  const result = await call(["preflight", file, "--project", repo, "--state-root", path.join(root, "state"), "--json"]);
  const output = JSON.parse(result.stdout);
  assert.equal(result.code, 1);
  assert.equal(output.effectsSettled, false);
  assert.equal(output.candidateDisposition, "retained-unsettled");
  assert.match(await readFile(output.artifactPath, "utf8"), /CLI_UNSETTLED_HOST_ONLY/);
  // This exact fixture starts only one process and no descendants. Reconcile
  // its recorded PID before cleaning the otherwise-retained candidate.
  const pid = Number(await readFile(path.join(output.candidatePath, ".cache/pid"), "utf8"));
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  let alive = false;
  try { process.kill(pid, 0); alive = true; }
  catch (error) { assert.equal((error as NodeJS.ErrnoException).code, "ESRCH"); }
  assert.equal(alive, false, `fixture process ${pid} remains; retained recovery root ${root}`);
  const worktrees = git(repo, ["worktree", "list", "--porcelain"]);
  assert.ok(worktrees.split("\n").includes(`worktree ${output.candidatePath.replaceAll("\\", "/")}`));
  git(repo, ["worktree", "remove", "--force", output.candidatePath]);
  retainedFixtureRoots.delete(root);
  assert.doesNotMatch(result.stdout + result.stderr, /CLI_UNSETTLED_HOST_ONLY/);
  assert.equal(Object.hasOwn(output, "unsettledCommand"), false);
}));

for (const code of ["process.exit(1)", "require('./missing-cli-dependency.cjs')"]) {
  test(`TaskSpec preflight refuses unsuccessful host checks: ${code}`, async () => fixture(async (repo, root) => {
    const file = path.join(root, "task.json");
    await writeFile(file, JSON.stringify(spec(code)), "utf8");
    const result = await call(["preflight", file, "--project", repo, "--state-root", path.join(root, "state"), "--json"]);
    assert.equal(result.code, 1);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, false);
    assert.equal(output.effectsSettled, true);
    assert.equal(output.candidateDisposition, "removed");
    assert.ok(await readFile(output.artifactPath, "utf8"));
  }));
}

test("TaskSpec init refuses shell scripts and multi-language ambiguity without writing a draft", async () => fixture(async (repo) => {
  await writeFile(path.join(repo, "package.json"), JSON.stringify({ scripts: { test: "node --test test/value.test.cjs && echo success" } }), "utf8");
  let result = await call(["init", "--task", "--dir", repo]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /simple node --test|shell|unsupported/i);
  await assert.rejects(lstat(path.join(repo, "sparkle.task.json")), { code: "ENOENT" });
  await writeFile(path.join(repo, "Cargo.toml"), "[package]\nname='fixture'\nversion='0.1.0'\n", "utf8");
  result = await call(["init", "--task", "--dir", repo]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /ambiguous|multiple|language/i);
}));

test("TaskSpec init requires source and real test inputs, preserves existing files and only force-overwrites regular files", async () => fixture(async (repo) => {
  const target = path.join(repo, "sparkle.task.json");
  await writeFile(target, "keep", "utf8");
  assert.equal((await call(["init", "--task", "--dir", repo])).code, 1);
  assert.equal(await readFile(target, "utf8"), "keep");
  assert.equal((await call(["init", "--task", "--dir", repo, "--force"])).code, 0);
  await rm(target);
  await mkdir(target);
  assert.equal((await call(["init", "--task", "--dir", repo, "--force"])).code, 1);
  await rm(target, { recursive: true });
  await rm(path.join(repo, "test"), { recursive: true });
  assert.equal((await call(["init", "--task", "--dir", repo])).code, 1);
  await assert.rejects(lstat(target), { code: "ENOENT" });
}));

test("TaskSpec CLI rejects duplicate flags, oversized input, extra positionals and unsupported flags", async () => fixture(async (repo, root) => {
  const file = path.join(root, "task.json");
  await writeFile(file, " ".repeat(65537), "utf8");
  for (const args of [
    ["preflight", file, "--project", repo, "--state-root", path.join(root, "state")],
    ["preflight", file, "extra", "--project", repo],
    ["preflight", file, "--project", repo, "--project", repo],
    ["init", "--task", "--dir", repo, "--dir", repo],
    ["init", "--task", "--unknown"]
  ]) assert.equal((await call(args)).code, 1, args.join(" "));
  const valid = JSON.stringify(spec(""));
  await writeFile(file, Buffer.concat([Buffer.from(valid.slice(0, -1)), Buffer.from([0xff]), Buffer.from("}")]));
  const malformed = await call(["preflight", file, "--project", repo, "--state-root", path.join(root, "state")]);
  assert.equal(malformed.code, 1);
  assert.match(malformed.stderr, /UTF-8/);
}));

test("TaskSpec input and init target reject symlinks", async (t) => fixture(async (repo, root) => {
  const file = path.join(root, "task.json");
  await writeFile(file, JSON.stringify(spec("")), "utf8");
  const link = path.join(root, "linked.json");
  try { await symlink(file, link, "file"); }
  catch (error) { if (["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) { t.skip("file symlink creation unavailable"); return; } throw error; }
  assert.equal((await call(["preflight", link, "--project", repo, "--state-root", path.join(root, "state")])).code, 1);
  await symlink(file, path.join(repo, "sparkle.task.json"), "file");
  assert.equal((await call(["init", "--task", "--dir", repo, "--force"])).code, 1);
}));

test("TaskSpec init refuses an explicit test below an internal junction or symlink", async (t) => fixture(async (repo) => {
  const alias = path.join(repo, "alias");
  try { await symlink(path.join(repo, "test"), alias, process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { if (["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) { t.skip("directory links unavailable"); return; } throw error; }
  assert.equal((await lstat(alias)).isSymbolicLink(), true);
  assert.equal((await lstat(path.join(alias, "value.test.cjs"))).isFile(), true);
  await writeFile(path.join(repo, "package.json"), JSON.stringify({ scripts: { test: "node --test alias/value.test.cjs" } }), "utf8");
  const result = await call(["init", "--task", "--dir", repo, "--json"]);
  await assert.rejects(lstat(path.join(repo, "sparkle.task.json")), { code: "ENOENT" });
  assert.equal(result.code, 1, result.stderr);
  assert.match(result.stderr, /link|junction|physical/i);
}));
