import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { preflightDevelopmentTaskSpec, startDevelopmentTaskSpec } from "../../../src/development/start-task-spec.js";
import type { DevelopmentTaskSpec } from "../../../src/development/task-spec.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";

// Acceptance probes for #126's preparation design, using existing public entrypoints.
// The installer is deliberately synthetic: successful stdout/exit is NOT installation evidence.
// Dependency/version probes below preserve GREEN legacy generic prepare behavior.
// Their TODOs record the fixed-Node admission gap; implementation must connect a real
// fixed wrapper/entry and test it, never reject arbitrary legacy prepare commands to turn them GREEN.
// The recipe ID is only a label, not evidence that a fixed wrapper was selected.
// These probes do not claim arbitrary trusted commands are an OS security sandbox.
const PACKAGE = "sparkle-preparation-fixture";
const ASSERTION = "selected-value-regression";
function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
interface Fixture { root: string; sourceRepo: string; stateRoot: string; sandboxRoot: string; revision: string; spec: DevelopmentTaskSpec; }
async function fixture(body: (input: Fixture) => Promise<void>): Promise<void> {
  const parent = path.resolve(".agent_workspace/task-preparation-red/fixtures");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "case-"));
  const sourceRepo = path.join(root, "source"), stateRoot = path.join(root, "state"), sandboxRoot = path.join(root, "candidates");
  await mkdir(path.join(sourceRepo, "checks"), { recursive: true });
  await mkdir(sandboxRoot);
  await writeFile(path.join(sourceRepo, "value.txt"), "before", "utf8");
  await writeFile(path.join(sourceRepo, ".gitignore"), "node_modules/\n.cache/\n", "utf8");
  await writeFile(path.join(sourceRepo, "package.json"), JSON.stringify({ private: true, packageManager: "pnpm@10.17.1", dependencies: { [PACKAGE]: "1.0.0" } }), "utf8");
  await writeFile(path.join(sourceRepo, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      sparkle-preparation-fixture:\n        specifier: 1.0.0\n        version: 1.0.0\n", "utf8");
  await writeFile(path.join(sourceRepo, "checks/business.cjs"), `const f=require('node:fs');
const resolved=require.resolve('${PACKAGE}'); const dependency=require('${PACKAGE}');
if(dependency.usable!==true)throw Error('fixture package unusable');
f.appendFileSync(process.argv[2],JSON.stringify({cwd:process.cwd(),resolved,version:dependency.version})+'\\n');
if(f.readFileSync('value.txt','utf8')==='before'){process.stdout.write(JSON.stringify({assertion:'${ASSERTION}',outcome:'failed'}));process.exit(1);}`, "utf8");
  // An actual local copy, never npm/pnpm install, a network request, or a real user's dependency tree.
  await writeFile(path.join(sourceRepo, "checks/prepare.cjs"), `const f=require('node:fs'),p=require('node:path');
const [mode,source,store,trace]=process.argv.slice(2);
let target=p.join(process.cwd(),'node_modules','${PACKAGE}');
if(mode==='source')target=p.join(source,'node_modules','${PACKAGE}');
if(mode!=='ancestor'){f.mkdirSync(p.dirname(target),{recursive:true});f.cpSync(p.join(store,'${PACKAGE}'),target,{recursive:true});}
f.appendFileSync(trace,JSON.stringify({cwd:process.cwd(),target:mode==='ancestor'?null:target})+'\\n');
console.log('synthetic preparation completed');`, "utf8");
  git(sourceRepo, ["init", "-b", "fixture"]);
  git(sourceRepo, ["config", "core.autocrlf", "false"]);
  git(sourceRepo, ["config", "user.name", "Preparation synthetic fixture"]);
  git(sourceRepo, ["config", "user.email", "fixture@example.invalid"]);
  git(sourceRepo, ["add", "."]);
  git(sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "synthetic source"]);
  const revision = git(sourceRepo, ["rev-parse", "HEAD"]);
  const spec: DevelopmentTaskSpec = { version: 1, objective: "Repair the selected value", context: ["value.txt"],
    write: { allow: ["value.txt"], protect: ["checks", "package.json", "pnpm-lock.yaml"] }, prepare: [],
    checks: [{ id: "business", command: process.execPath, args: ["checks/business.cjs", path.join(root, "checks.jsonl")],
      verifierVersion: "synthetic-v1", protectedPaths: ["checks"], visibleToWorker: true,
      expect: { baseline: "fail", failureAssertion: ASSERTION } }],
    budget: { totalSeconds: 60, prepareSeconds: 10, checkSeconds: 5, workerSeconds: 10 }, worker: { model: "inherit" } };
  try { await body({ root, sourceRepo, stateRoot, sandboxRoot, revision, spec }); }
  finally {
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith("case-"));
    await rm(root, { recursive: true, force: true });
  }
}
async function packageAt(directory: string, version: string): Promise<void> {
  const destination = path.join(directory, PACKAGE);
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, "package.json"), JSON.stringify({ name: PACKAGE, version, main: "index.cjs" }), "utf8");
  await writeFile(path.join(destination, "index.cjs"), `module.exports={usable:true,version:${JSON.stringify(version)}}`, "utf8");
}
async function lines(file: string): Promise<Record<string, unknown>[]> {
  try { return (await readFile(file, "utf8")).trim().split("\n").map(line => JSON.parse(line) as Record<string, unknown>); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
function prepared(input: Fixture, mode: string): DevelopmentTaskSpec {
  return { ...input.spec, prepare: [{ id: "node-preparation", command: process.execPath,
    args: ["checks/prepare.cjs", mode, input.sourceRepo, path.join(input.root, "offline-store"), path.join(input.root, "prepare.jsonl")] }] };
}
async function run(input: Fixture, spec: DevelopmentTaskSpec) {
  let factories = 0, dispatches = 0;
  const outcome = await startDevelopmentTaskSpec({ sourceRepo: input.sourceRepo, stateRoot: input.stateRoot, sandboxRoot: input.sandboxRoot, spec,
    executorFactory: context => {
      factories++;
      return { async *execute(request, signal) {
        dispatches++;
        await context.tools.find(tool => tool.name === "sparkle_write_file")!.execute("fix", { path: "value.txt", contents: "after" }, signal);
        yield* new ProtocolChildExecutor().execute(request, signal);
      } };
    } }).then(result => ({ result }), (error: unknown) => {
      assert.ok(error instanceof DomainValidationError, `unexpected infrastructure failure: ${String(error)}`);
      return { error };
    });
  return { outcome, factories, dispatches };
}
async function assertSuccessfulPreparationAndExactRed(artifactPath: string): Promise<void> {
  const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
  assert.equal(artifact.modelInvocations, 0);
  assert.equal(artifact.preparation.length, 1);
  assert.equal(artifact.preparation[0].expected, true);
  assert.equal(artifact.preparation[0].result.status, "completed");
  assert.equal(artifact.preparation[0].result.exitCode, 0);
  assert.equal(artifact.checks.length, 1);
  assert.equal(artifact.checks[0].expected, true);
  assert.equal(artifact.checks[0].result.status, "completed");
  assert.equal(artifact.checks[0].result.exitCode, 1);
  assert.equal(artifact.checks[0].result.signal, null);
  assert.equal(artifact.checks[0].result.stderrByteLength, 0);
  assert.deepEqual(JSON.parse(artifact.checks[0].result.stdoutText), { assertion: ASSERTION, outcome: "failed" });
}
function accepted(observed: Awaited<ReturnType<typeof run>>): boolean {
  return "result" in observed.outcome && observed.outcome.result.execution.acceptance.accepted;
}

for (const mode of ["ancestor", "wrong-offline-version", "unavailable-package-manager"] as const) {
  test(`legacy generic prepare observes ${mode} without fixed Node admission, at both public seams`, async () => fixture(async input => {
    await packageAt(path.join(input.root, "offline-store"), mode === "wrong-offline-version" ? "0.9.0" : "1.0.0");
    if (mode === "ancestor") await packageAt(path.join(input.root, "node_modules"), "1.0.0");
    if (mode === "unavailable-package-manager") {
      const manifest = JSON.parse(await readFile(path.join(input.sourceRepo, "package.json"), "utf8"));
      manifest.packageManager = "pnpm@0.0.0-synthetic-unavailable";
      await writeFile(path.join(input.sourceRepo, "package.json"), JSON.stringify(manifest), "utf8");
      git(input.sourceRepo, ["add", "package.json"]);
      git(input.sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "synthetic unavailable exact manager"]);
    }
    const definition = prepared(input, mode === "ancestor" ? "ancestor" : "candidate");
    const standalone = await preflightDevelopmentTaskSpec({ sourceRepo: input.sourceRepo, stateRoot: input.stateRoot, sandboxRoot: input.sandboxRoot, spec: definition });
    // A separate task-run must make its own decision, not inherit a standalone pass.
    const observed = await run(input, definition);
    const preparation = await lines(path.join(input.root, "prepare.jsonl"));
    const checks = await lines(path.join(input.root, "checks.jsonl"));
    assert.equal(preparation.length, 2, "both invocations must actually execute the legacy preparation");
    assert.equal(checks.length, 3, "both baseline checks and the final checker must actually resolve the dependency");
    assert.ok("result" in observed.outcome, "the task-run must publish actual preflight evidence");
    assert.ok(observed.outcome.result.preflight, "the task-run must reach its actual baseline checker");
    await assertSuccessfulPreparationAndExactRed(standalone.artifactPath);
    await assertSuccessfulPreparationAndExactRed(observed.outcome.result.preflight.artifactPath);
    if (mode === "ancestor") {
      assert.ok(checks.every(row => !String(row.resolved).startsWith(String(row.cwd) + path.sep)), "fixture really resolves outside its allocated candidate");
    } else if (mode === "wrong-offline-version") {
      assert.deepEqual(await readdir(path.join(input.root, "offline-store")), [PACKAGE]);
      assert.ok(checks.every(row => row.version === "0.9.0"), "only the wrong offline version is actually installed");
    }
    assert.equal(git(input.sourceRepo, ["status", "--porcelain=v1", "--ignored"]), "");
    assert.deepEqual({ standaloneOk: standalone.ok, factories: observed.factories, dispatches: observed.dispatches, accepted: accepted(observed) },
      { standaloneOk: true, factories: 1, dispatches: 1, accepted: true },
      "legacy arbitrary prepare remains valid; this observation does not establish fixed-recipe offline admission");
  }));
  test.todo(`new fixed Node preparation recipe refuses ${mode} before dispatch; legacy generic prepare remains compatible`);
}

test("standalone preflight refuses preparation installing into its clean source", async () => fixture(async input => {
  await packageAt(path.join(input.root, "offline-store"), "1.0.0");
  // Resolve from source deliberately so the checker completes a genuine business assertion.
  const definition = prepared(input, "source");
  const checker = `const f=require('node:fs');require(${JSON.stringify(path.join(input.sourceRepo, "node_modules", PACKAGE))});process.stdout.write(JSON.stringify({assertion:'${ASSERTION}',outcome:'failed'}));process.exit(1)`;
  const spec = { ...definition, checks: [{ ...definition.checks[0]!, args: ["-e", checker] }] };
  const standalone = await preflightDevelopmentTaskSpec({ sourceRepo: input.sourceRepo, stateRoot: input.stateRoot, sandboxRoot: input.sandboxRoot, spec });
  if ((await lines(path.join(input.root, "prepare.jsonl"))).length > 0) {
    assert.equal(JSON.parse(await readFile(path.join(input.sourceRepo, "node_modules", PACKAGE, "package.json"), "utf8")).version, "1.0.0");
  }
  if (standalone.ok) await assertSuccessfulPreparationAndExactRed(standalone.artifactPath);
  if (!standalone.ok) assert.match(standalone.reason, /source.*(?:clean|changed|modified|revision|fresh)|(?:fresh|dirty|changed).*source/i);
  assert.equal(standalone.ok, false, "source freshness must also be checked after standalone preparation, before a success receipt");
}));

test("standalone preflight cleanup followed by task-run prepares a fresh local candidate exactly once", async () => fixture(async input => {
  await packageAt(path.join(input.root, "offline-store"), "1.0.0");
  const definition = prepared(input, "candidate");
  const standalone = await preflightDevelopmentTaskSpec({ sourceRepo: input.sourceRepo, stateRoot: input.stateRoot, sandboxRoot: input.sandboxRoot, spec: definition });
  assert.equal(standalone.ok, true, standalone.reason);
  assert.equal(standalone.candidateDisposition, "removed");
  await assert.rejects(stat(standalone.candidatePath), { code: "ENOENT" });
  const observed = await run(input, definition);
  assert.equal(accepted(observed), true, JSON.stringify(observed.outcome));
  assert.equal(observed.factories, 1); assert.equal(observed.dispatches, 1);
  const preparation = await lines(path.join(input.root, "prepare.jsonl"));
  assert.equal(preparation.length, 2, "each public invocation prepares once, final checking does not repeat it");
  assert.notEqual(preparation[0]!.cwd, preparation[1]!.cwd);
  const checked = await lines(path.join(input.root, "checks.jsonl"));
  assert.equal(checked.length, 3, "standalone baseline, task baseline and final checker must all actually execute");
  assert.equal(checked[0]!.cwd, preparation[0]!.cwd);
  assert.equal(checked[1]!.cwd, preparation[1]!.cwd); assert.equal(checked[2]!.cwd, preparation[1]!.cwd);
  for (const row of checked) assert.ok(String(row.resolved).startsWith(String(row.cwd) + path.sep + "node_modules" + path.sep));
  assert.equal(await readFile(path.join(input.sourceRepo, "value.txt"), "utf8"), "before");
  assert.equal(git(input.sourceRepo, ["rev-parse", "HEAD"]), input.revision);
  assert.equal(git(input.sourceRepo, ["status", "--porcelain=v1", "--ignored"]), "");
}));

for (const [name, code] of [
  ["import", "require('./absent-fixture-package.cjs')"],
  ["incidental", "process.exit(1)"],
  ["exact stdout plus import", `process.stdout.write(JSON.stringify({assertion:'${ASSERTION}',outcome:'failed'}));require('./absent-fixture-package.cjs')`],
  ["timeout", "setTimeout(()=>{},10000)"],
] as const) {
  test(`public preflight and task-run refuse ${name} instead of declared behavioral RED without dispatch`, async () => fixture(async input => {
    const spec = { ...input.spec, checks: [{ ...input.spec.checks[0]!, args: ["-e", code], timeoutMs: name === "timeout" ? 200 : 5000 }] };
    const standalone = await preflightDevelopmentTaskSpec({ sourceRepo: input.sourceRepo, stateRoot: input.stateRoot, sandboxRoot: input.sandboxRoot, spec });
    const observed = await run(input, spec);
    assert.equal(standalone.ok, false);
    assert.deepEqual({ factories: observed.factories, dispatches: observed.dispatches, accepted: accepted(observed) }, { factories: 0, dispatches: 0, accepted: false });
    assert.ok("result" in observed.outcome, "task-run refusal must retain an actual preflight result");
    assert.ok(observed.outcome.result.preflight, "task-run must reach the declared checker before refusing it");
    for (const artifactPath of [standalone.artifactPath, observed.outcome.result.preflight.artifactPath]) {
      const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
      assert.equal(artifact.modelInvocations, 0);
      assert.equal(artifact.checks.length, 1);
      assert.equal(artifact.checks[0].expected, false);
      assert.equal(artifact.checks[0].result.spawned, true);
      assert.equal(artifact.checks[0].result.status, name === "timeout" ? "timed_out" : "completed");
      if (name !== "timeout") {
        assert.equal(artifact.checks[0].result.exitCode, 1);
        assert.equal(artifact.checks[0].result.signal, null);
        if (name === "incidental") assert.equal(artifact.checks[0].result.stderrByteLength, 0);
        else assert.match(artifact.checks[0].result.stderrText, /Cannot find module|MODULE_NOT_FOUND/);
      }
    }
  }));
}

for (const dirty of ["tracked", "ignored"] as const) {
  test(`both public entrypoints reject ${dirty} source without preparing or dispatching`, async () => fixture(async input => {
    if (dirty === "tracked") await writeFile(path.join(input.sourceRepo, "value.txt"), "dirty", "utf8");
    else { await mkdir(path.join(input.sourceRepo, "node_modules")); await writeFile(path.join(input.sourceRepo, "node_modules", "synthetic.txt"), "ignored", "utf8"); }
    const before = git(input.sourceRepo, ["status", "--porcelain=v1", "--ignored"]);
    await assert.rejects(preflightDevelopmentTaskSpec({ sourceRepo: input.sourceRepo, stateRoot: input.stateRoot, sandboxRoot: input.sandboxRoot, spec: input.spec }), DomainValidationError);
    const observed = await run(input, input.spec);
    assert.equal(accepted(observed), false); assert.equal(observed.factories, 0); assert.equal(observed.dispatches, 0);
    assert.equal(git(input.sourceRepo, ["status", "--porcelain=v1", "--ignored"]), before);
    await assert.rejects(stat(path.join(input.root, "prepare.jsonl")), { code: "ENOENT" });
  }));
}

for (const entry of ["standalone preflight", "task-run"] as const) {
test(`${entry} refuses a committed stale source after preparation without dispatch`, async () => fixture(async input => {
  const mutate = `const c=require('node:child_process'),f=require('node:fs');const cwd=${JSON.stringify(input.sourceRepo)};
f.writeFileSync(require('node:path').join(cwd,'value.txt'),'new committed source');
for(const args of [['add','value.txt'],['-c','commit.gpgsign=false','commit','-m','synthetic freshness change']]){const r=c.spawnSync('git',args,{cwd,encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(r.stderr);}`;
  const spec = { ...input.spec, prepare: [{ id: "source-change", command: process.execPath, args: ["-e", mutate] }],
    checks: [{ ...input.spec.checks[0]!, args: ["-e", `process.stdout.write(JSON.stringify({assertion:'${ASSERTION}',outcome:'failed'}));process.exit(1)`] }] };
  const observed = entry === "task-run" ? await run(input, spec) : undefined;
  const standalone = entry === "standalone preflight" ? await preflightDevelopmentTaskSpec({ sourceRepo: input.sourceRepo, stateRoot: input.stateRoot, sandboxRoot: input.sandboxRoot, spec }) : undefined;
  assert.notEqual(git(input.sourceRepo, ["rev-parse", "HEAD"]), input.revision, "fixture must really commit a new source revision");
  assert.equal(git(input.sourceRepo, ["status", "--porcelain=v1", "--ignored"]), "");
  if (observed !== undefined) { assert.equal(observed.factories, 0); assert.equal(observed.dispatches, 0); assert.equal(accepted(observed), false); }
  if (standalone !== undefined) {
    if (!standalone.ok) assert.match(standalone.reason, /source.*(?:clean|changed|modified|revision|fresh)|(?:fresh|dirty|changed).*source/i);
    assert.equal(standalone.ok, false, "a clean new source commit must not leave the old candidate preflight successful");
  }
}));
}
