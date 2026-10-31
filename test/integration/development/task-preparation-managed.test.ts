import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { TaskSpecSession } from "../../../src/development/task-session.js";
import { snapshotDevelopmentTaskSpec, type DevelopmentTaskSpec } from "../../../src/development/task-spec.js";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";

const PACKAGE = "sparkle-managed-fixture", ASSERTION = "selected-value-regression";
function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
async function lines(file: string): Promise<Record<string, unknown>[]> {
  return (await readFile(file, "utf8")).trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>);
}
interface Fixture {
  root: string; source: string; store: string; revision: string; session: TaskSpecSession; spec: DevelopmentTaskSpec;
  files: ReadonlyMap<string, Buffer>; sharedFiles: ReadonlyMap<string, Buffer>;
}
async function fixture(options: { layout: "linked" | "regular"; generic?: boolean; unknownCache?: boolean }, body: (input: Fixture) => Promise<void>): Promise<void> {
  const parent = path.resolve(".agent_workspace/task-preparation-managed"); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "case-"));
  const source = path.join(root, "source"), store = path.join(root, "shared-store"), stateRoot = path.join(root, "state");
  const packageRoot = path.join(store, PACKAGE), manager = path.join(root, "pnpm.cjs");
  await mkdir(path.join(source, "checks"), { recursive: true }); await mkdir(packageRoot, { recursive: true });
  const sharedFiles = new Map<string, Buffer>([
    ["package.json", Buffer.from(JSON.stringify({ name: PACKAGE, version: "1.0.0", main: "index.cjs" }))],
    ["index.cjs", Buffer.from("module.exports={usable:true,version:'1.0.0'}")]
  ]);
  for (const [file, bytes] of sharedFiles) await writeFile(path.join(packageRoot, file), bytes);
  const files = new Map<string, Buffer>([
    ["value.txt", Buffer.from("before")], [".gitignore", Buffer.from("node_modules/\n.cache/\n")],
    ["package.json", Buffer.from(JSON.stringify({ private: true, packageManager: "pnpm@10.17.1", dependencies: { [PACKAGE]: "1.0.0" } }))],
    ["pnpm-lock.yaml", Buffer.from(`lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      ${PACKAGE}:\n        specifier: 1.0.0\n        version: 1.0.0\n`)],
    ["checks/business.cjs", Buffer.from(`const f=require('node:fs');const dependency=require('${PACKAGE}');
if(dependency.usable!==true||dependency.version!=='1.0.0')throw Error('installed package unusable');
const value=f.readFileSync('value.txt','utf8');
f.appendFileSync(${JSON.stringify(path.join(root, "checks.jsonl"))},JSON.stringify({cwd:process.cwd(),resolved:require.resolve('${PACKAGE}'),version:dependency.version,value})+'\\n');
if(value==='before'){process.stdout.write(JSON.stringify({assertion:'${ASSERTION}',outcome:'failed'}));process.exit(1)}
if(value!=='after')throw Error('unexpected candidate value');`)]
  ]);
  for (const [file, bytes] of files) await writeFile(path.join(source, file), bytes);
  // A real local installation structure from a synthetic CLI: no network or host package store.
  await writeFile(manager, `const a=require('node:assert/strict'),f=require('node:fs'),p=require('node:path');
if(process.argv[2]==='--version'){console.log('10.17.1');process.exit(0)}
a.deepEqual(process.argv.slice(2).filter(arg=>arg!=='--package-import-method=copy'),['install','--offline','--frozen-lockfile','--ignore-scripts','--store-dir',${JSON.stringify(store)},'--ignore-workspace']);
const modules=p.join(process.cwd(),'node_modules');
const target=${JSON.stringify(options.layout)}==='linked'?p.join(modules,'.pnpm','${PACKAGE}@1.0.0','node_modules','${PACKAGE}'):p.join(modules,'${PACKAGE}');
f.mkdirSync(p.dirname(target),{recursive:true});f.cpSync(${JSON.stringify(packageRoot)},target,{recursive:true});
if(${JSON.stringify(options.layout)}==='linked')f.symlinkSync(target,p.join(modules,'${PACKAGE}'),'junction');
f.writeFileSync(p.join(modules,'.modules.yaml'),'layoutVersion: 5\\n');
if(${options.unknownCache === true}){f.mkdirSync('.cache');f.writeFileSync('.cache/unowned.txt','unowned ignored output');}
f.appendFileSync(${JSON.stringify(path.join(root, "install.jsonl"))},JSON.stringify({cwd:process.cwd()})+'\\n');`, "utf8");
  git(source, ["init", "-b", "fixture"]); git(source, ["config", "core.autocrlf", "false"]);
  git(source, ["config", "user.name", "Managed preparation synthetic fixture"]);
  git(source, ["config", "user.email", "fixture@example.invalid"]); git(source, ["add", "."]);
  git(source, ["-c", "commit.gpgsign=false", "commit", "-m", "synthetic source"]);
  const revision = git(source, ["rev-parse", "HEAD"]);
  const installArgs = ["install", "--offline", "--frozen-lockfile", "--ignore-scripts", "--store-dir", store, "--ignore-workspace"];
  const spec = snapshotDevelopmentTaskSpec({ version: 1, objective: "Repair only the selected value", context: ["value.txt"],
    write: { allow: ["value.txt"], protect: ["checks", "package.json", "pnpm-lock.yaml"] },
    prepare: [{ id: "offline", command: process.execPath, args: [manager, ...(options.generic ? installArgs : [])],
      ...(options.generic ? {} : { nodeOffline: { nodeVersion: process.versions.node, packageManagerVersion: "10.17.1", storePath: store, readOnlySharedStores: [store] } }) }],
    checks: [{ id: "business", command: process.execPath, args: ["checks/business.cjs"], verifierVersion: "synthetic-managed-v1", protectedPaths: ["checks"],
      expect: { baseline: "fail", failureAssertion: ASSERTION } }],
    limits: { context: { tokenBudget: 4000, maxFiles: 2, maxBytes: 512 }, snapshot: { maxFiles: 32, maxBytes: 65536 } },
    budget: { totalSeconds: 60, prepareSeconds: 10, checkSeconds: 5, workerSeconds: 10 }, worker: { model: "inherit" } });
  const session = new TaskSpecSession({ stateRoot, sandboxRoot: path.join(root, "candidates") });
  let passed = false;
  try { await body({ root, source, store, revision, session, spec, files, sharedFiles }); passed = true; }
  finally {
    await session.shutdown();
    assert.equal(path.dirname(root), parent); assert.ok(path.basename(root).startsWith("case-"));
    if (passed) await rm(root, { recursive: true, force: true });
    else console.error(`Managed preparation failure evidence retained: ${root}`);
  }
}
async function assertSharedUnchanged(input: Fixture): Promise<void> {
  assert.deepEqual(await readdir(input.store), [PACKAGE]);
  assert.deepEqual((await readdir(path.join(input.store, PACKAGE))).sort(), ["index.cjs", "package.json"]);
  for (const [file, bytes] of input.sharedFiles) assert.deepEqual(await readFile(path.join(input.store, PACKAGE, file)), bytes);
}
async function assertSourceUnchanged(input: Fixture): Promise<void> {
  assert.equal(git(input.source, ["rev-parse", "HEAD"]), input.revision);
  assert.equal(git(input.source, ["status", "--porcelain=v1", "--ignored"]), "");
  for (const [file, bytes] of input.files) assert.deepEqual(await readFile(path.join(input.source, file)), bytes);
  await assertSharedUnchanged(input);
}
async function run(input: Fixture) {
  let factories = 0, dispatches = 0;
  const result = await input.session.run({ sourceRepo: input.source, spec: input.spec, executorFactory: context => {
    factories++; return { async *execute(request, signal) {
      dispatches++;
      await context.tools.find(tool => tool.name === "sparkle_write_file")!.execute("fix", { path: "value.txt", contents: "after" }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    } };
  } });
  return { result, factories, dispatches };
}

for (const layout of ["linked", "regular"] as const) {
  test(`fixed Node ${layout} installation stays managed and applies only the checked source change`, async () => fixture({ layout }, async input => {
    const { result, factories, dispatches } = await run(input);
    assert.equal(result.status, "COMPLETED"); assert.equal(result.accepted, true); assert.equal(result.effectsSettled, true);
    assert.deepEqual({ factories, dispatches }, { factories: 1, dispatches: 1 });
    await assertSourceUnchanged(input);
    const installations = await lines(path.join(input.root, "install.jsonl"));
    assert.deepEqual(installations, [{ cwd: result.candidatePath }]);
    const beforeApply = await lines(path.join(input.root, "checks.jsonl"));
    assert.deepEqual(beforeApply.map(row => row.value), ["before", "after"]);
    assert.ok(beforeApply.every(row => row.cwd === result.candidatePath && row.version === "1.0.0" && String(row.resolved).startsWith(result.candidatePath + path.sep + "node_modules" + path.sep)));
    assert.equal((await lstat(path.join(result.candidatePath, "node_modules", PACKAGE))).isSymbolicLink(), layout === "linked");
    const preflight = JSON.parse(await readFile(result.preflightArtifactPath!, "utf8"));
    assert.equal(preflight.ok, true); assert.equal(preflight.modelInvocations, 0);
    assert.equal(preflight.nodeInstallations[0].package, PACKAGE); assert.equal(preflight.nodeInstallations[0].version, "1.0.0");
    assert.deepEqual(JSON.parse(preflight.checks[0].result.stdoutText), { assertion: ASSERTION, outcome: "failed" });
    assert.equal(result.managed, true, "genuine fixed Node installation artifacts must not strand an accepted candidate outside managed apply");
    const outcome = await input.session.apply(result.runId).then(applied => ({ applied }), (error: unknown) => ({ error }));
    assert.ok("applied" in outcome, `same-session apply must freshly check and apply only value.txt: ${"error" in outcome ? String(outcome.error) : ""}`);
    assert.equal(outcome.applied.status, "APPLIED"); assert.equal(outcome.applied.reverified, true);
    assert.equal(outcome.applied.sourceRevision, input.revision);
    assert.equal(git(input.source, ["rev-parse", "HEAD"]), outcome.applied.appliedRevision);
    assert.equal(git(input.source, ["diff", "--name-only", input.revision, "HEAD"]), "value.txt");
    assert.equal(await readFile(path.join(input.source, "value.txt"), "utf8"), "after");
    for (const [file, bytes] of input.files) if (file !== "value.txt") assert.deepEqual(await readFile(path.join(input.source, file)), bytes);
    assert.equal(git(input.source, ["status", "--porcelain=v1", "--ignored"]), "");
    await assert.rejects(lstat(path.join(input.source, "node_modules")), { code: "ENOENT" });
    await assertSharedUnchanged(input);
    const checked = await lines(path.join(input.root, "checks.jsonl"));
    assert.deepEqual(checked.map(row => row.value), ["before", "after", "after"], "apply must execute a fresh checker after acceptance");
    assert.ok(checked.every(row => row.cwd === result.candidatePath && String(row.resolved).startsWith(result.candidatePath + path.sep + "node_modules" + path.sep)));
    assert.deepEqual(await lines(path.join(input.root, "install.jsonl")), installations, "apply must not reinstall or refresh the prepared artifact");
  }));
}

for (const generic of [false, true]) {
  test(generic ? "legacy generic preparation cannot acquire fixed Node artifact apply authority" : "fixed Node preparation cannot exclude an unknown ignored cache output", async () => fixture({ layout: "regular", generic, unknownCache: !generic }, async input => {
    const outcome = await run(input).then(observed => ({ observed }), (error: unknown) => {
      assert.ok(error instanceof DomainValidationError); return { error };
    });
    const installed = await lines(path.join(input.root, "install.jsonl")); assert.equal(installed.length, 1);
    if (!generic) assert.equal(await readFile(path.join(String(installed[0]!.cwd), ".cache/unowned.txt"), "utf8"), "unowned ignored output");
    if ("observed" in outcome) await assert.rejects(input.session.apply(outcome.observed.result.runId), DomainValidationError,
      "ignored filenames alone must never supply prepared artifact exclusion authority");
    await assertSourceUnchanged(input);
  }));
}
