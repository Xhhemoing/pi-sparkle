import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs, { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile, lstat } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { preflightDevelopmentTaskSpec, startDevelopmentTaskSpec } from "../../../src/development/start-task-spec.js";
import { snapshotDevelopmentTaskSpec, type DevelopmentTaskSpec } from "../../../src/development/task-spec.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";

// Acceptance probes for #126's preparation design, using existing public entrypoints.
// The installer is deliberately synthetic: successful stdout/exit is NOT installation evidence.
// Dependency/version probes below preserve GREEN legacy generic prepare behavior.
// Separate fixed-Node probes exercise its explicit declaration and actual admission;
// arbitrary legacy preparation commands remain compatible.
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

const explicitNodeLimits = { context: { tokenBudget: 4000, maxFiles: 2, maxBytes: 512 }, snapshot: { maxFiles: 16, maxBytes: 65536 } };
test("fixed Node offline preparation admits a declared recipe before checking installed dependency evidence", async t => {
  const declaration = { nodeVersion: process.versions.node, packageManagerVersion: "10.17.1", storePath: path.resolve(".agent_workspace/unused-offline-store"), readOnlySharedStores: [] };
  const basic = { version: 1, objective: "fixture", context: [], write: { allow: ["value.txt"], protect: [] },
    limits: explicitNodeLimits, prepare: [{ id: "offline", command: process.execPath, args: [], nodeOffline: declaration }],
    checks: [{ id: "business", command: process.execPath, args: ["-e", ""], verifierVersion: "v1", expect: { baseline: "pass" } }],
    budget: { totalSeconds: 60, prepareSeconds: 10, checkSeconds: 5, workerSeconds: 10 } };
  assert.doesNotThrow(() => snapshotDevelopmentTaskSpec(basic), "fixed Node recipe must be admitted before behavioral probes");
  const { limits: _limits, ...missing } = basic;
  assert.throws(() => snapshotDevelopmentTaskSpec(missing), /explicit.*limit|limit.*required/i);
  for (const mode of ["candidate", "ancestor", "wrong-version", "missing-manager", "missing-cache", "shared-store", "undeclared-shared", "escaped-entry", "missing-node", "changed-lock"] as const) {
    await t.test(mode, async () => fixture(async input => {
      const store = path.join(input.root, "offline-store");
      if (mode === "missing-cache") await mkdir(store);
      else await packageAt(store, mode === "wrong-version" ? "0.9.0" : "1.0.0");
      if (mode === "escaped-entry") {
        const escaped = path.join(input.root, "escaped-entry.cjs");
        await writeFile(escaped, "module.exports={usable:true,version:'1.0.0'}", "utf8");
        await writeFile(path.join(store, PACKAGE, "package.json"), JSON.stringify({ name: PACKAGE, version: "1.0.0", main: escaped }), "utf8");
      }
      if (mode === "ancestor") await packageAt(path.join(input.root, "node_modules"), "1.0.0");
      const manager = `const f=require('node:fs'),p=require('node:path');
if(process.argv[2]==='--version'){console.log(${JSON.stringify(mode === "missing-manager" ? "0.0.0" : "10.17.1")});process.exit(0)}
f.appendFileSync(${JSON.stringify(path.join(input.root, "install.jsonl"))},JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2)})+'\\n');
if(${JSON.stringify(mode)}==='missing-cache'){console.error('offline package version unavailable');process.exit(1)}
if(${JSON.stringify(mode)}!=='ancestor'){const target=p.join(process.cwd(),'node_modules','${PACKAGE}');f.mkdirSync(p.dirname(target),{recursive:true});
if(${JSON.stringify(mode)}==='shared-store'||${JSON.stringify(mode)}==='undeclared-shared')f.symlinkSync(${JSON.stringify(path.join(store, PACKAGE))},target,'junction');
else f.cpSync(${JSON.stringify(path.join(store, PACKAGE))},target,{recursive:true});}
if(${JSON.stringify(mode)}==='changed-lock')f.appendFileSync('pnpm-lock.yaml','\\n# mutated by installer');`;
      const managerPath = path.join(input.root, "pnpm.cjs");
      await writeFile(managerPath, manager, "utf8");
      const spec = snapshotDevelopmentTaskSpec({ ...input.spec, limits: explicitNodeLimits,
        prepare: [{ id: "offline", command: process.execPath, args: [managerPath], nodeOffline: { ...declaration, nodeVersion: mode === "missing-node" ? "0.0.0" : declaration.nodeVersion, storePath: store,
          readOnlySharedStores: mode === "shared-store" ? [store] : [] } }] });
      const standalone = await preflightDevelopmentTaskSpec({ sourceRepo: input.sourceRepo, stateRoot: input.stateRoot, sandboxRoot: input.sandboxRoot, spec });
      if (mode === "missing-cache") assert.deepEqual(await readdir(store), [], "the exact offline version is actually absent");
      else assert.equal(JSON.parse(await readFile(path.join(store, PACKAGE, "package.json"), "utf8")).version, mode === "wrong-version" ? "0.9.0" : "1.0.0", "standalone cleanup must preserve shared storage");
      const observed = await run(input, spec);
      if (mode === "missing-cache") assert.deepEqual(await readdir(store), [], "refusal must not populate the offline store");
      else assert.equal(JSON.parse(await readFile(path.join(store, PACKAGE, "package.json"), "utf8")).version, mode === "wrong-version" ? "0.9.0" : "1.0.0", "task-run must preserve shared storage");
      const valid = mode === "candidate" || mode === "shared-store";
      assert.equal(standalone.ok, valid, standalone.reason);
      assert.equal(observed.dispatches, valid ? 1 : 0, JSON.stringify(observed.outcome));
      assert.equal(accepted(observed), valid);
      const installs = await lines(path.join(input.root, "install.jsonl"));
      if (mode !== "missing-manager" && mode !== "missing-node") {
        assert.equal(installs.length, 2, "separate public invocations each install once");
        assert.notEqual(installs[0]!.cwd, installs[1]!.cwd);
        for (const row of installs) assert.deepEqual(row.args, ["install", "--offline", "--frozen-lockfile", "--ignore-scripts", "--store-dir", store, "--ignore-workspace"]);
      } else assert.equal(installs.length, 0, "wrong exact manager must refuse before installation");
      assert.equal(git(input.sourceRepo, ["status", "--porcelain=v1", "--ignored"]), "");
    }));
  }
});

test("fixed Node version lookup and install disable online bootstrap in the actual command environment", async () => fixture(async input => {
  const store = path.join(input.root, "offline-store"); await packageAt(store, "1.0.0");
  const manager = path.join(input.root, "pnpm-offline.cjs");
  await writeFile(manager, `const f=require('node:fs'),p=require('node:path');
if(process.env.COREPACK_ENABLE_NETWORK!=='0'||process.env.npm_config_offline!=='true'){console.error('offline bootstrap guard absent');process.exit(1)}
if(process.argv[2]==='--version'){console.log('10.17.1');process.exit(0)}
const target=p.join(process.cwd(),'node_modules','${PACKAGE}');f.mkdirSync(p.dirname(target),{recursive:true});f.cpSync(${JSON.stringify(path.join(store, PACKAGE))},target,{recursive:true});`, "utf8");
  const spec = snapshotDevelopmentTaskSpec({ ...input.spec, limits: explicitNodeLimits,
    prepare: [{ id: "offline", command: process.execPath, args: [manager], nodeOffline: { nodeVersion: process.versions.node, packageManagerVersion: "10.17.1", storePath: store, readOnlySharedStores: [] } }] });
  const result = await preflightDevelopmentTaskSpec({ sourceRepo: input.sourceRepo, stateRoot: input.stateRoot, sandboxRoot: input.sandboxRoot, spec });
  assert.equal(result.ok, true, result.reason);
}));

test("standalone cleanup refuses a redirected installation parent and preserves the moved external dependency link", async () => fixture(async input => {
  const store = path.join(input.root, "offline-store"); await packageAt(store, "1.0.0");
  const external = path.join(input.root, "external-installation");
  const manager = path.join(input.root, "pnpm-linked.cjs");
  await writeFile(manager, `const f=require('node:fs'),p=require('node:path');
if(process.argv[2]==='--version'){console.log('10.17.1');process.exit(0)}
const target=p.join(process.cwd(),'node_modules','${PACKAGE}');f.mkdirSync(p.dirname(target),{recursive:true});f.symlinkSync(${JSON.stringify(path.join(store, PACKAGE))},target,'junction');`, "utf8");
  const checker = `const f=require('node:fs');f.renameSync('node_modules',${JSON.stringify(external)});f.symlinkSync(${JSON.stringify(external)},'node_modules','junction');process.stdout.write(JSON.stringify({assertion:'${ASSERTION}',outcome:'failed'}));process.exit(1)`;
  const spec = snapshotDevelopmentTaskSpec({ ...input.spec, limits: explicitNodeLimits,
    checks: [{ ...input.spec.checks[0]!, args: ["-e", checker] }],
    prepare: [{ id: "offline", command: process.execPath, args: [manager], nodeOffline: { nodeVersion: process.versions.node, packageManagerVersion: "10.17.1", storePath: store, readOnlySharedStores: [store] } }] });
  const outcome = await preflightDevelopmentTaskSpec({ sourceRepo: input.sourceRepo, stateRoot: input.stateRoot, sandboxRoot: input.sandboxRoot, spec })
    .then(result => ({ result }), (error: unknown) => ({ error }));
  assert.ok("error" in outcome, "redirected cleanup must remain refused rather than publish standalone success");
  assert.match(String(outcome.error), /cleanup|retained/i);
  const artifacts = await readdir(path.join(input.stateRoot, "preflight"));
  assert.equal(artifacts.length, 1);
  const artifactPath = path.join(input.stateRoot, "preflight", artifacts[0]!);
  const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
  const leaf = await lstat(path.join(external, PACKAGE)).then(value => value, (error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  });
  assert.equal(leaf?.isSymbolicLink(), true, "cleanup must not unlink the original leaf through a redirected installation parent");
  assert.ok(leaf);
  assert.equal(leaf.ino, artifact.nodeInstallationLinks[0].inode, "the actual moved leaf retains its original identity");
  assert.equal((await lstat(artifact.candidatePath)).isDirectory(), true, "uncertain cleanup retains the allocated candidate");
  assert.ok(String(outcome.error).includes(artifactPath), "cleanup refusal retains the original observation locator");
  assert.equal(artifact.modelInvocations, 0);
  assert.equal(await readFile(path.join(store, PACKAGE, "index.cjs"), "utf8"), 'module.exports={usable:true,version:"1.0.0"}');
  assert.equal(git(input.sourceRepo, ["status", "--porcelain=v1", "--ignored"]), "");
}));

for (const cancellationAtPersistence of [false, true]) {
  test(`fixed preparation persistence failure retains the full candidate without cleanup through redirected parents (cancellation=${cancellationAtPersistence})`, async () => fixture(async input => {
    const store = path.join(input.root, "offline-store"); await packageAt(store, "1.0.0");
    const external = path.join(input.root, "external-installation"), trace = path.join(input.root, "installation.json");
    const manager = path.join(input.root, "pnpm-persistence.cjs");
    await writeFile(manager, `const f=require('node:fs'),p=require('node:path');
if(process.argv[2]==='--version'){console.log('10.17.1');process.exit(0)}
const target=p.join(process.cwd(),'node_modules','${PACKAGE}');f.mkdirSync(p.dirname(target),{recursive:true});f.symlinkSync(${JSON.stringify(path.join(store, PACKAGE))},target,'junction');
f.writeFileSync(${JSON.stringify(trace)},JSON.stringify({candidate:process.cwd(),leafInode:f.lstatSync(target).ino}));`, "utf8");
    const checker = `const f=require('node:fs');f.renameSync('node_modules',${JSON.stringify(external)});f.symlinkSync(${JSON.stringify(external)},'node_modules','junction');process.stdout.write(JSON.stringify({assertion:'${ASSERTION}',outcome:'failed'}));process.exit(1)`;
    const spec = snapshotDevelopmentTaskSpec({ ...input.spec, limits: explicitNodeLimits,
      checks: [{ ...input.spec.checks[0]!, args: ["-e", checker] }],
      prepare: [{ id: "offline", command: process.execPath, args: [manager], nodeOffline: { nodeVersion: process.versions.node, packageManagerVersion: "10.17.1", storePath: store, readOnlySharedStores: [store] } }] });
    await mkdir(input.stateRoot);
    const blocked = path.join(input.stateRoot, "preflight"); await writeFile(blocked, "actual artifact-directory obstruction", "utf8");
    const cancellation = new AbortController(), originalMkdir = fs.mkdir;
    let interceptedPersistence = false;
    fs.mkdir = (async (...args: Parameters<typeof fs.mkdir>) => {
      if (path.resolve(String(args[0])) === blocked) {
        interceptedPersistence = true;
        if (cancellationAtPersistence) cancellation.abort();
      }
      return originalMkdir(...args);
    }) as typeof fs.mkdir;
    syncBuiltinESMExports();
    let outcome: { error: unknown } | { result: unknown };
    try {
      outcome = await preflightDevelopmentTaskSpec({ sourceRepo: input.sourceRepo, stateRoot: input.stateRoot, sandboxRoot: input.sandboxRoot, spec, signal: cancellation.signal })
        .then(result => ({ result }), (error: unknown) => ({ error }));
    } finally { fs.mkdir = originalMkdir; syncBuiltinESMExports(); }
    assert.equal(interceptedPersistence, true, "the actual artifact mkdir must be reached");
    assert.equal(cancellation.signal.aborted, cancellationAtPersistence);
    assert.ok("error" in outcome, "failed persistence cannot publish a successful standalone result");
    const installation = JSON.parse(await readFile(trace, "utf8")) as { candidate: string; leafInode: number };
    const candidateValue = await readFile(path.join(installation.candidate, "value.txt"), "utf8").catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    });
    assert.equal(candidateValue, "before", "without the completed preparation result, cleanup must retain all allocated candidate bytes");
    assert.equal((await lstat(path.join(external, PACKAGE))).ino, installation.leafInode, "the redirected external leaf stays untouched");
    assert.ok(git(input.sourceRepo, ["worktree", "list", "--porcelain"]).replaceAll("\\", "/").includes(installation.candidate.replaceAll("\\", "/")), "unknown cleanup must retain the managed worktree registration");
    assert.match(String(outcome.error), /retain|reconcil/i);
    assert.ok(String(outcome.error).includes(installation.candidate), "failure identifies its retained candidate");
    assert.ok(String(outcome.error).includes(input.stateRoot), "failure identifies the attempted evidence location");
    assert.equal(await readFile(path.join(store, PACKAGE, "index.cjs"), "utf8"), 'module.exports={usable:true,version:"1.0.0"}');
    assert.equal(git(input.sourceRepo, ["status", "--porcelain=v1", "--ignored"]), "");
  }));
}
