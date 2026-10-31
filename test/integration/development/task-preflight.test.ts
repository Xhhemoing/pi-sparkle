import assert from "node:assert/strict";
import cp, { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runTaskSpecPreflight } from "../../../src/development/task-preflight.js";
import { DomainValidationError } from "../../../src/domain/errors.js";
import type { DevelopmentTaskSpec } from "../../../src/development/task-spec.js";
import { CommandCleanupIncompleteError, type AuthorizedCommandRunResult } from "../../../src/execution/command-runner.js";
import { readLoopArtifact } from "../../../src/execution/loop-artifact.js";
function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
async function fixture(body: (cwd: string, stateRoot: string, revision: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "sparkle-spec-preflight-"));
  const cwd = path.join(root, "candidate");
  await mkdir(path.join(cwd, "checks"), { recursive: true });
  await mkdir(path.join(root, "candidates"));
  await writeFile(path.join(cwd, "value.txt"), "original", "utf8");
  await writeFile(path.join(cwd, "checks", "guard.txt"), "protected", "utf8");
  await writeFile(path.join(cwd, ".gitignore"), ".cache/\n", "utf8");
  git(cwd, ["init"]); git(cwd, ["config", "core.autocrlf", "false"]);
  git(cwd, ["config", "user.name", "Preflight fixture"]); git(cwd, ["config", "user.email", "fixture@example.invalid"]);
  git(cwd, ["add", "."]); git(cwd, ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
  const revision = git(cwd, ["rev-parse", "HEAD"]);
  try { await body(cwd, path.join(root, "state"), revision); }
  finally {
    await stopOwnedProcesses(root);
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith("sparkle-spec-preflight-"));
    await rm(root, { recursive: true, force: true });
  }
}
function spec(code: string, fail = false): DevelopmentTaskSpec {
  return { version: 1, objective: "Repair the selected value", context: ["value.txt"],
    write: { allow: ["value.txt", "future.txt"], protect: ["checks"] }, prepare: [],
    checks: [{ id: "business", command: process.execPath, args: ["-e", code], verifierVersion: "fixture-v1",
      protectedPaths: ["checks"], expect: fail ? { baseline: "fail", failureAssertion: "value-regression" } : { baseline: "pass" } }],
    budget: { totalSeconds: 30, prepareSeconds: 10, checkSeconds: 5, workerSeconds: 10 }, worker: { model: "inherit" } };
}
const assertion = "process.stdout.write(JSON.stringify({assertion:'value-regression',outcome:'failed'}));";
test("zero-model preflight actually prepares a warm candidate and verifies a named business failure", async () => fixture(async (candidatePath, stateRoot, sourceRevision) => {
  const definition = spec("const f=require('node:fs');if(f.readFileSync('.cache/ready','utf8')!=='ready')throw Error('cold');" + assertion + "process.exit(1)", true);
  const result = await runTaskSpecPreflight({ candidatePath, stateRoot, sourceRevision, spec: { ...definition,
    prepare: [{ id: "warm", command: process.execPath, args: ["-e", "const f=require('node:fs');f.mkdirSync('.cache');f.writeFileSync('.cache/ready','ready');"] }] } });
  assert.equal(result.ok, true, result.reason);
  assert.equal(await readFile(path.join(candidatePath, ".cache/ready"), "utf8"), "ready");
  const evidence = JSON.parse(await readFile(result.artifactPath, "utf8"));
  assert.equal(evidence.checks[0].result.exitCode, 1);
  assert.equal(evidence.checks[0].expected, true);
  assert.equal(git(candidatePath, ["rev-parse", "HEAD"]), sourceRevision);
  assert.equal(git(candidatePath, ["status", "--porcelain=v1"]), "");
}));
for (const code of ["require('./missing-dependency.cjs')", assertion + "require('./missing-dependency.cjs')", "process.exit(1)"] ) {
  test(`zero-model preflight refuses infrastructure or undescribed RED: ${code}`, async () => fixture(async (candidatePath, stateRoot, sourceRevision) => {
    const result = await runTaskSpecPreflight({ candidatePath, stateRoot, sourceRevision, spec: spec(code, true) });
    assert.equal(result.ok, false, "exit 1 alone must not prove the selected business regression");
    assert.equal(result.effectsSettled, true);
    const evidence = JSON.parse(await readFile(result.artifactPath, "utf8"));
    assert.equal(evidence.checks[0].expected, false);
  }));
}
test("preparation changing observed source refuses before any worker allocation", async () => fixture(async (candidatePath, stateRoot, sourceRevision) => {
  const definition = spec("");
  const result = await runTaskSpecPreflight({ candidatePath, stateRoot, sourceRevision, spec: { ...definition,
    prepare: [{ id: "mutate", command: process.execPath, args: ["-e", "require('node:fs').writeFileSync('value.txt','changed')"] }] } });
  assert.equal(result.ok, false);
  assert.match(result.reason, /changed|mutat/i);
  assert.equal(await readFile(path.join(candidatePath, "value.txt"), "utf8"), "changed", "failed candidate evidence must not be reset");
  assert.equal(git(candidatePath, ["rev-parse", "HEAD"]), sourceRevision);
}));
test("missing mandatory context is refused before preparation can run", async () => fixture(async (candidatePath, stateRoot, sourceRevision) => {
  const definition = spec("");
  const result = await runTaskSpecPreflight({ candidatePath, stateRoot, sourceRevision, spec: { ...definition, context: ["missing.md"],
    prepare: [{ id: "marker", command: process.execPath, args: ["-e", "require('node:fs').writeFileSync('marker','ran')"] }] } });
  assert.equal(result.ok, false);
  await assert.rejects(readFile(path.join(candidatePath, "marker"), "utf8"), { code: "ENOENT" });
}));

import { preflightDevelopmentTaskSpec, startDevelopmentTaskSpec } from "../../../src/development/start-task-spec.js";
import { GatedExecutor, ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";

for (const withTotals of [true, false]) {
test(`cumulative TaskSpec repair prepares once and keeps the warm candidate and visible feedback (${withTotals ? "explicit totals" : "omitted totals"})`, async () => fixture(async (sourceRepo, stateRoot, revision) => {
  const definition = spec("const f=require('node:fs');if(f.readFileSync('.cache/ready','utf8')!=='warm')throw Error('cold');if(f.readFileSync('value.txt','utf8')!=='fixed'){" + assertion + "process.exit(1)}", true);
  const contexts: string[] = [];
  const result = await startDevelopmentTaskSpec({ sourceRepo, stateRoot, sandboxRoot: path.join(path.dirname(sourceRepo), "candidates"),
    spec: { ...definition, worker: { model: "inherit", maxAttempts: 3 },
      budget: { ...definition.budget, ...(withTotals ? { workerTotalSeconds: 4, checkTotalSeconds: 8 } : {}) },
      checks: [{ ...definition.checks[0]!, visibleToWorker: true }, { id: "hidden", command: process.execPath,
        args: ["-e", "console.error('HIDDEN_BUDGET_SECRET')"], verifierVersion: "v1", protectedPaths: ["checks"], visibleToWorker: false, expect: { baseline: "pass" } }],
      prepare: [{ id: "warm", command: process.execPath, args: ["-e", "const f=require('node:fs');f.mkdirSync('.cache');f.writeFileSync('.cache/ready','warm');"] }] },
    executorFactory(context) {
      contexts.push(context.candidatePath);
      assert.equal(JSON.stringify(context).includes("HIDDEN_BUDGET_SECRET"), false);
      if (contexts.length === 2) assert.ok(context.attempt?.checkFeedback);
      return { async *execute(request, signal) {
        assert.equal(await readFile(path.join(context.candidatePath, ".cache/ready"), "utf8"), "warm");
        await context.tools.find((tool) => tool.name === "sparkle_write_file")!.execute("repair", {
          path: "value.txt", contents: contexts.length === 1 ? "needs repair" : "fixed" }, signal);
        yield* new ProtocolChildExecutor().execute(request, signal);
      } };
    } });
  assert.equal(result.execution.acceptance.accepted, true, result.execution.reason);
  assert.equal(contexts.length, 2); assert.equal(contexts[0], contexts[1]);
  assert.equal(JSON.parse(await readFile(result.preflight!.artifactPath, "utf8")).preparation.length, 1);
  assert.equal(await readFile(path.join(sourceRepo, "value.txt"), "utf8"), "original");
  assert.equal(await readFile(path.join(result.execution.candidatePath, "checks/guard.txt"), "utf8"), "protected");
  assert.equal(git(sourceRepo, ["rev-parse", "HEAD"]), revision);
  assert.equal(git(sourceRepo, ["status", "--porcelain=v1", "--ignored"]), "");
}));
}

test("cumulative TaskSpec worker allowance excludes slow first-factory preparation", async () => fixture(async (sourceRepo, stateRoot) => {
  const definition = spec("");
  const result = await startDevelopmentTaskSpec({ sourceRepo, stateRoot, sandboxRoot: path.join(path.dirname(sourceRepo), "candidates"),
    spec: { ...definition, budget: { ...definition.budget, workerTotalSeconds: 1 },
      prepare: [{ id: "slow", command: process.execPath, args: ["-e", "setTimeout(()=>{},1200)"] }] },
    executorFactory: () => new ProtocolChildExecutor() });
  assert.equal(result.preflight?.ok, true);
  assert.equal(result.execution.acceptance.accepted, true, result.execution.reason);
}));

test("cumulative TaskSpec check pool charges base checks before its final phase", async () => fixture(async (sourceRepo, stateRoot) => {
  const definition = spec("const value=require('node:fs').readFileSync('value.txt','utf8');setTimeout(()=>process.exit(0),value==='original'?300:2000)");
  let factories = 0;
  const result = await startDevelopmentTaskSpec({ sourceRepo, stateRoot, sandboxRoot: path.join(path.dirname(sourceRepo), "candidates"),
    spec: { ...definition, worker: { model: "inherit", maxAttempts: 3 }, budget: { ...definition.budget, checkTotalSeconds: 1.5 } },
    executorFactory(context) { factories++; return { async *execute(request, signal) {
      await context.tools.find((tool) => tool.name === "sparkle_write_file")!.execute("change", { path: "value.txt", contents: "fixed" }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    } }; } });
  assert.equal(result.preflight?.ok, true, result.preflight?.reason ?? "preflight did not run");
  assert.ok(result.preflight.checksMs >= 300);
  assert.equal(result.execution.acceptance.accepted, false);
  assert.equal(factories, 1);
  assert.equal(result.execution.loop?.stopReason, result.execution.effectsSettled === false ? "verification-unavailable" : "time-budget");
  assert.equal(await readFile(path.join(sourceRepo, "value.txt"), "utf8"), "original");
}));
test("TaskSpec run prepares once then actual worker and final checker reuse the warm isolated candidate", async () => fixture(async (sourceRepo, stateRoot, revision) => {
  const definition = spec("const f=require('node:fs');if(f.readFileSync('.cache/ready','utf8')!=='ready')throw Error('cold');if(f.readFileSync('value.txt','utf8')==='original'){" + assertion + "process.exit(1)}", true);
  let calls = 0;
  let workerCandidate = "";
  const result = await startDevelopmentTaskSpec({ sourceRepo, stateRoot, sandboxRoot: path.join(path.dirname(sourceRepo), "candidates"), spec: { ...definition,
    prepare: [{ id: "warm", command: process.execPath, args: ["-e", "const f=require('node:fs');f.mkdirSync('.cache');f.writeFileSync('.cache/ready','ready');"] }] },
  executorFactory: async (context) => {
    calls++;
    workerCandidate = context.candidatePath;
    assert.equal(await readFile(path.join(context.candidatePath, ".cache/ready"), "utf8"), "ready");
    return { async *execute(request, signal) {
      await context.tools.find((tool) => tool.name === "sparkle_write_file")!.execute("fix", { path: "value.txt", contents: "fixed" }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    } };
  } });
  assert.equal(calls, 1);
  assert.equal(result.preflight?.ok, true);
  assert.equal(result.execution.acceptance.accepted, true, result.execution.reason);
  assert.equal(result.execution.candidatePath, workerCandidate);
  assert.equal(JSON.parse(await readFile(result.preflight!.artifactPath, "utf8")).candidatePath, workerCandidate);
  assert.notEqual(workerCandidate, sourceRepo);
  assert.equal(await readFile(path.join(sourceRepo, "value.txt"), "utf8"), "original");
  assert.equal(git(sourceRepo, ["rev-parse", "HEAD"]), revision);
  assert.equal(git(sourceRepo, ["status", "--porcelain=v1", "--ignored"]), "");
}));
test("TaskSpec run never creates a real worker for unavailable base dependencies", async () => fixture(async (sourceRepo, stateRoot) => {
  let factories = 0;
  const result = await startDevelopmentTaskSpec({ sourceRepo, stateRoot, sandboxRoot: path.join(path.dirname(sourceRepo), "candidates"), spec: spec("require('./missing-dependency.cjs')", true),
    executorFactory: () => { factories++; return new ProtocolChildExecutor(); } });
  assert.equal(factories, 0);
  assert.equal(result.preflight?.ok, false);
  assert.equal(result.execution.acceptance.accepted, false);
}));
test("TaskSpec run enforces the worker allowance separately from preparation and the overall deadline", async () => fixture(async (sourceRepo, stateRoot) => {
  const definition = spec("");
  const executor = new GatedExecutor();
  const started = performance.now();
  const result = await startDevelopmentTaskSpec({ sourceRepo, stateRoot, sandboxRoot: path.join(path.dirname(sourceRepo), "candidates"), spec: { ...definition,
    budget: { ...definition.budget, workerSeconds: 0.1, totalSeconds: 20 } }, executorFactory: () => executor });
  assert.equal(executor.sawAbort, true);
  assert.equal(result.execution.acceptance.accepted, false);
  assert.ok(performance.now() - started < 15000, "worker must not run until the overall deadline");
}));

test("standalone TaskSpec preflight runs actual warm preparation and base checks without a worker and removes its settled candidate", async () => fixture(async (sourceRepo, stateRoot, revision) => {
  const marker = "STANDALONE_BASE_CHECK_PASSED";
  const definition = spec(`const fs=require('node:fs');if(fs.readFileSync('.cache/ready','utf8')!=='warm')process.exit(1);process.stdout.write(${JSON.stringify(marker)});`);
  const result = await preflightDevelopmentTaskSpec({ sourceRepo, stateRoot,
    sandboxRoot: path.join(path.dirname(stateRoot), "standalone-candidates"), spec: { ...definition,
      prepare: [{ id: "warm", command: process.execPath, args: ["-e", "const fs=require('node:fs');fs.mkdirSync('.cache');fs.writeFileSync('.cache/ready','warm');"] }] } });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.effectsSettled, true);
  assert.equal(result.candidateDisposition, "removed");
  assert.notEqual(result.candidatePath, sourceRepo);
  await assert.rejects(stat(result.candidatePath), { code: "ENOENT" });
  const evidence = JSON.parse(await readFile(result.artifactPath, "utf8"));
  assert.equal(evidence.modelInvocations, 0);
  assert.equal(evidence.candidatePath, result.candidatePath);
  assert.equal(evidence.preparation.length, 1);
  assert.equal(evidence.preparation[0].result.status, "completed");
  assert.equal(evidence.preparation[0].result.exitCode, 0);
  assert.equal(evidence.checks[0].expected, true);
  assert.equal(evidence.checks[0].result.stdoutText, marker);
  assert.equal(await readFile(path.join(sourceRepo, "value.txt"), "utf8"), "original");
  assert.equal(await readFile(path.join(sourceRepo, "checks", "guard.txt"), "utf8"), "protected");
  assert.equal(git(sourceRepo, ["rev-parse", "HEAD"]), revision);
  assert.equal(git(sourceRepo, ["status", "--porcelain=v1", "--ignored"]), "");
}));

const ownedProcessFiles = new Map<string, Set<string>>();
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function slowCommand(stateRoot: string, label: string): { code: string; readyPath: string } {
  const root = path.dirname(stateRoot);
  const readyPath = path.join(root, `owned-process-${label}.json`);
  const files = ownedProcessFiles.get(root) ?? new Set<string>();
  files.add(readyPath); ownedProcessFiles.set(root, files);
  return { readyPath, code: `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(readyPath)},JSON.stringify({pid:process.pid}));setTimeout(()=>process.exit(79),9000);setInterval(()=>{},1000);` };
}
async function processReady(file: string): Promise<number> {
  for (let n = 0; n < 400; n++) {
    try {
      const value = JSON.parse(await readFile(file, "utf8")) as { pid: number };
      assert.ok(Number.isSafeInteger(value.pid) && value.pid > 1 && value.pid !== process.pid);
      return value.pid;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await pause(20);
  }
  throw new Error(`owned fixture process never reported its identity; retain evidence at ${file}`);
}
function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; }
}
async function stopOwnedProcesses(root: string): Promise<void> {
  const files = ownedProcessFiles.get(root);
  if (files === undefined) return;
  try {
    for (const file of files) {
      const pid = await processReady(file);
      if (processAlive(pid)) {
        try { process.kill(pid, "SIGKILL"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
      }
      for (let n = 0; n < 100 && processAlive(pid); n++) await pause(20);
      assert.equal(processAlive(pid), false, `do not remove fixture while owned process ${pid} remains alive`);
    }
  } finally { ownedProcessFiles.delete(root); }
}
async function sandbox(stateRoot: string): Promise<string> {
  const result = path.join(path.dirname(stateRoot), "owned-candidates");
  await mkdir(result, { recursive: true });
  return result;
}

test("cumulative TaskSpec retains actual unknown base-check cleanup before any repair factory", async () => fixture(async (sourceRepo, stateRoot, revision) => {
  const slow = slowCommand(stateRoot, "cumulative-check");
  const definition = spec(slow.code);
  let factories = 0;
  const pending = startDevelopmentTaskSpec({ sourceRepo, stateRoot, sandboxRoot: await sandbox(stateRoot),
    spec: { ...definition, worker: { model: "inherit", maxAttempts: 3 },
      budget: { ...definition.budget, checkTotalSeconds: 1.5, workerTotalSeconds: 2 } },
    executorFactory: () => { factories++; return new ProtocolChildExecutor(); } });
  await processReady(slow.readyPath);
  const result = await pending;
  assert.equal(factories, 0);
  assert.equal(result.preflight?.ok, false);
  assert.equal(result.execution.acceptance.accepted, false);
  const report = JSON.parse(await readFile(result.preflight!.artifactPath, "utf8"));
  assert.equal(report.checks[0].result.spawned, true);
  assert.equal(report.checks[0].result.status, "timed_out");
  if (process.platform === "win32" || result.execution.effectsSettled === false) {
    assert.equal(result.execution.effectsSettled, false);
    assert.equal(result.execution.loop?.stopReason, "verification-unavailable");
    assert.match(result.execution.reason, /cleanup unsettled/i);
    assert.ok((await stat(result.execution.candidatePath)).isDirectory());
  } else assert.equal(result.execution.loop?.stopReason, "time-budget");
  assert.equal(await readFile(path.join(sourceRepo, "value.txt"), "utf8"), "original");
  assert.equal(git(sourceRepo, ["rev-parse", "HEAD"]), revision);
  assert.equal(git(sourceRepo, ["status", "--porcelain=v1", "--ignored"]), "");
}));

test("persistence cancellation returns refused evidence and preserves the superseded successful artifact", async () => fixture(async (candidatePath, stateRoot, sourceRevision) => {
  const cancellation = new AbortController();
  const originalWrite = fs.writeFile;
  let intercepted = false;
  fs.writeFile = (async (...args: Parameters<typeof fs.writeFile>) => {
    await originalWrite(...args);
    if (!intercepted && String(args[0]).includes(`${path.sep}preflight${path.sep}`)) {
      intercepted = true; cancellation.abort();
    }
  }) as typeof fs.writeFile;
  syncBuiltinESMExports();
  let result: Awaited<ReturnType<typeof runTaskSpecPreflight>>;
  try { result = await runTaskSpecPreflight({ candidatePath, stateRoot, sourceRevision, spec: spec("process.exit(0)"), signal: cancellation.signal }); }
  finally { fs.writeFile = originalWrite; syncBuiltinESMExports(); }
  assert.equal(intercepted, true); assert.equal(cancellation.signal.aborted, true);
  assert.equal(result.ok, false); assert.equal(result.effectsSettled, true);
  const corrected = JSON.parse(await readFile(result.artifactPath, "utf8"));
  assert.equal(corrected.ok, false); assert.match(corrected.reason, /persist|cancel|budget/i);
  assert.equal(typeof corrected.supersedesArtifactPath, "string");
  assert.notEqual(corrected.supersedesArtifactPath, result.artifactPath);
  const originalBytes = await readFile(corrected.supersedesArtifactPath, "utf8");
  assert.equal(JSON.parse(originalBytes).ok, true, "the original completed evidence must not be rewritten");
  assert.equal(await readFile(corrected.supersedesArtifactPath, "utf8"), originalBytes);
  assert.equal(git(candidatePath, ["rev-parse", "HEAD"]), sourceRevision);
  assert.equal(git(candidatePath, ["status", "--porcelain=v1", "--ignored"]), "");
}));

test("actual timed-out preparation retains cleanup uncertainty when artifact persistence also fails", async () => fixture(async (candidatePath, stateRoot, sourceRevision) => {
  const slow = slowCommand(stateRoot, "persistence-timeout");
  const badState = path.join(path.dirname(stateRoot), "state-is-a-file");
  await writeFile(badState, "obstruct the artifact directory", "utf8");
  let unsettled: AuthorizedCommandRunResult | undefined;
  const definition = spec("");
  const pending = runTaskSpecPreflight({ candidatePath, stateRoot: badState, sourceRevision,
    spec: { ...definition, prepare: [{ id: "slow", command: process.execPath, args: ["-e", slow.code] }],
      budget: { ...definition.budget, prepareSeconds: 1.5 } }, onCommandCleanupUnsettled: (result) => { unsettled = result; } })
    .then((result) => ({ result }), (error: unknown) => ({ error }));
  await processReady(slow.readyPath);
  const outcome = await pending;
  assert.ok("error" in outcome);
  if (process.platform === "win32" || unsettled !== undefined) {
    assert.ok(outcome.error instanceof CommandCleanupIncompleteError, "FS failure must not erase an unsettled command receipt");
    assert.equal(outcome.error.result.status, "timed_out");
    assert.equal(outcome.error.result.cleanupUnsettled, true);
    assert.ok(outcome.error.cause instanceof Error);
  } else {
    assert.ok(outcome.error instanceof Error);
    assert.ok(!(outcome.error instanceof CommandCleanupIncompleteError), "a settled POSIX command retains an ordinary FS error");
    assert.match(String(outcome.error), /ENOTDIR|EEXIST|not a directory/i);
  }
  assert.equal(git(candidatePath, ["rev-parse", "HEAD"]), sourceRevision);
  assert.equal(git(candidatePath, ["status", "--porcelain=v1", "--ignored"]), "");
}));

for (const phase of ["preparation allowance", "total deadline"] as const) {
  test(`actual ${phase} stops preparation before the real executor factory`, async () => fixture(async (sourceRepo, stateRoot, revision) => {
    const slow = slowCommand(stateRoot, phase === "total deadline" ? "total" : "prepare");
    const definition = spec(""); let factories = 0;
    const pending = startDevelopmentTaskSpec({ sourceRepo, stateRoot, sandboxRoot: await sandbox(stateRoot),
      spec: { ...definition, prepare: [{ id: "slow", command: process.execPath, args: ["-e", slow.code] }],
        budget: { ...definition.budget, prepareSeconds: phase === "preparation allowance" ? 1.5 : 15,
          totalSeconds: phase === "total deadline" ? 6 : 30 } },
      executorFactory: () => { factories++; return new ProtocolChildExecutor(); } });
    await processReady(slow.readyPath);
    const result = await pending;
    assert.equal(factories, 0); assert.equal(result.execution.acceptance.accepted, false);
    assert.equal(result.preflight?.ok, false);
    const evidence = JSON.parse(await readFile(result.preflight!.artifactPath, "utf8"));
    assert.equal(evidence.preparation[0].result.spawned, true);
    assert.equal(evidence.preparation[0].result.status, phase === "preparation allowance" ? "timed_out" : "cancelled");
    assert.equal(await readFile(path.join(sourceRepo, "value.txt"), "utf8"), "original");
    assert.equal(git(sourceRepo, ["rev-parse", "HEAD"]), revision);
    assert.equal(git(sourceRepo, ["status", "--porcelain=v1", "--ignored"]), "");
  }));
}

for (const target of ["protected candidate", "allowed candidate", "original source"] as const) {
  test(`preparation mutating ${target} refuses before the real executor factory`, async () => fixture(async (sourceRepo, stateRoot, revision) => {
    const mutated = target === "original source" ? path.join(sourceRepo, "value.txt") : target === "protected candidate" ? "checks/guard.txt" : "value.txt";
    const definition = spec(""); let factories = 0;
    const result = await startDevelopmentTaskSpec({ sourceRepo, stateRoot, sandboxRoot: await sandbox(stateRoot),
      spec: { ...definition, prepare: [{ id: "mutate", command: process.execPath,
        args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(mutated)},'preparation mutation');`] }] },
      executorFactory: () => { factories++; return new ProtocolChildExecutor(); } });
    assert.equal(factories, 0); assert.equal(result.execution.acceptance.accepted, false);
    const changedPath = target === "original source" ? mutated : path.join(result.execution.candidatePath, mutated);
    assert.equal(await readFile(changedPath, "utf8"), "preparation mutation", "retain the actual failed candidate/source evidence");
    assert.equal(git(sourceRepo, ["rev-parse", "HEAD"]), revision);
    if (target !== "original source") {
      assert.equal(await readFile(path.join(sourceRepo, "value.txt"), "utf8"), "original");
      assert.equal(await readFile(path.join(sourceRepo, "checks", "guard.txt"), "utf8"), "protected");
      assert.equal(git(sourceRepo, ["status", "--porcelain=v1", "--ignored"]), "");
    } else assert.match(git(sourceRepo, ["status", "--porcelain=v1"]), /value\.txt/);
  }));
}

test("TaskSpec final checker uses checkSeconds after a fast base pass and records an actual timed_out result", async () => fixture(async (sourceRepo, stateRoot, revision) => {
  const slow = slowCommand(stateRoot, "final-check");
  const definition = spec(`if(require('node:fs').readFileSync('value.txt','utf8')!=='original'){${slow.code}}`);
  let factories = 0;
  const started = performance.now();
  const pending = startDevelopmentTaskSpec({ sourceRepo, stateRoot, sandboxRoot: await sandbox(stateRoot),
    spec: { ...definition, checks: [{ ...definition.checks[0]!, timeoutMs: 15000 }],
      budget: { ...definition.budget, checkSeconds: 2.5, totalSeconds: 20 } },
    executorFactory: (context) => { factories++; return { async *execute(request, signal) {
      await context.tools.find((tool) => tool.name === "sparkle_write_file")!.execute("change", { path: "value.txt", contents: "fixed" }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    } }; } });
  await processReady(slow.readyPath);
  const result = await pending;
  assert.equal(factories, 1); assert.equal(result.preflight?.ok, true);
  assert.equal(result.execution.acceptance.accepted, false);
  const body = await readLoopArtifact(stateRoot, result.execution.runId, result.execution.artifact.id) as {
    check?: { processStatus: string }; processCleanup?: { status: string }
  };
  assert.equal(body.check?.processStatus ?? body.processCleanup?.status, "timed_out");
  assert.ok(performance.now() - started < 15000, "final checking must stop at checkSeconds rather than the 20-second total budget");
  assert.equal(await readFile(path.join(sourceRepo, "value.txt"), "utf8"), "original");
  assert.equal(git(sourceRepo, ["rev-parse", "HEAD"]), revision);
  assert.equal(git(sourceRepo, ["status", "--porcelain=v1", "--ignored"]), "");
}));

test("TaskSpec host signal accessor cannot swap initially cancelled authority for a live signal", async () => fixture(async (sourceRepo, stateRoot, revision) => {
  const cancelled = new AbortController(); cancelled.abort();
  const live = new AbortController(); let reads = 0; let factories = 0;
  const input = Object.defineProperty({ sourceRepo, stateRoot, sandboxRoot: path.join(path.dirname(sourceRepo), "candidates"), spec: spec(""), executorFactory: () => {
    factories++; return new ProtocolChildExecutor();
  } }, "signal", { enumerable: true, get() { return ++reads === 1 ? cancelled.signal : live.signal; } });
  const outcome = await startDevelopmentTaskSpec(input).then((result) => ({ result }), (error: unknown) => ({ error }));
  assert.equal(reads, 0); assert.equal(factories, 0); assert.ok("error" in outcome);
  assert.equal(await readFile(path.join(sourceRepo, "value.txt"), "utf8"), "original");
  assert.equal(git(sourceRepo, ["rev-parse", "HEAD"]), revision);
  assert.equal(git(sourceRepo, ["status", "--porcelain=v1", "--ignored"]), "");
}));

for (const mode of ["cancel during disposal", "failed disposal"] as const) {
  test(`standalone preflight ${mode} refuses success and retains its actual observation locator`, async () => fixture(async (sourceRepo, stateRoot, revision) => {
    const cancellation = new AbortController();
    const originalSpawn = cp.spawnSync; const originalRemove = fs.rm;
    let candidatePath = ""; let removals = 0; let locked = false; let failedGitRemove = false; let blockedFsRemove = false;
    cp.spawnSync = ((...call: Parameters<typeof cp.spawnSync>) => {
      const command = call[0]; const argv = call[1];
      if (command === "git" && Array.isArray(argv) && argv[0] === "worktree" && argv[1] === "remove") {
        removals++;
        candidatePath = String(argv[argv.length - 1]);
        if (mode === "cancel during disposal") cancellation.abort();
        else if (!locked) {
          const options = call[2] as cp.SpawnSyncOptions | undefined;
          const lock = originalSpawn("git", ["worktree", "lock", candidatePath], options ?? {});
          assert.equal(lock.status, 0, String(lock.stderr)); locked = true;
        }
        const result = originalSpawn(...call);
        failedGitRemove ||= result.status !== 0;
        return result;
      }
      return originalSpawn(...call);
    }) as typeof cp.spawnSync;
    fs.rm = (async (...call: Parameters<typeof fs.rm>) => {
      if (mode === "failed disposal" && path.resolve(String(call[0])) === path.resolve(candidatePath)) {
        blockedFsRemove = true;
        throw Object.assign(new Error("injected actual candidate-directory access denial"), { code: "EACCES" });
      }
      return originalRemove(...call);
    }) as typeof fs.rm;
    syncBuiltinESMExports();
    let outcome: { result: Awaited<ReturnType<typeof preflightDevelopmentTaskSpec>> } | { error: unknown };
    try {
      outcome = await preflightDevelopmentTaskSpec({ sourceRepo, stateRoot, sandboxRoot: path.join(path.dirname(sourceRepo), "candidates"),
        spec: spec("process.stdout.write('DISPOSAL_BASE_CHECK_COMPLETED');"), signal: cancellation.signal })
        .then((result) => ({ result }), (error: unknown) => ({ error }));
    } finally { cp.spawnSync = originalSpawn; fs.rm = originalRemove; syncBuiltinESMExports(); }
    assert.ok(removals > 0, "the actual Git worktree disposal must execute");
    assert.ok(candidatePath);
    if (mode === "failed disposal") {
      assert.equal(locked, true); assert.equal(failedGitRemove, true); assert.equal(blockedFsRemove, true);
      assert.ok((await stat(candidatePath)).isDirectory(), "failed cleanup must leave the candidate available for reconciliation");
    } else {
      assert.equal(cancellation.signal.aborted, true);
      await assert.rejects(stat(candidatePath), { code: "ENOENT" });
    }
    assert.ok("error" in outcome, "cancellation or failed cleanup must not issue a successful standalone result");
    assert.ok(outcome.error instanceof DomainValidationError);
    const artifacts = (await fs.readdir(path.join(stateRoot, "preflight"))).filter((name) => name.endsWith(".json"));
    assert.ok(artifacts.length > 0);
    const artifactPath = path.join(stateRoot, "preflight", artifacts[0]!);
    const evidence = JSON.parse(await readFile(artifactPath, "utf8"));
    assert.equal(evidence.candidatePath, candidatePath); assert.equal(evidence.modelInvocations, 0);
    assert.equal(evidence.checks[0].result.stdoutText, "DISPOSAL_BASE_CHECK_COMPLETED");
    const error = outcome.error as DomainValidationError & { artifactPath?: unknown; candidatePath?: unknown };
    assert.ok(error.candidatePath === candidatePath || error.message.includes(candidatePath), "failure must identify the actual candidate path");
    assert.ok(error.artifactPath === artifactPath || error.message.includes(artifactPath), "failure must carry the existing host observation locator");
    assert.equal(git(sourceRepo, ["rev-parse", "HEAD"]), revision);
    assert.equal(git(sourceRepo, ["status", "--porcelain=v1", "--ignored"]), "");
  }));
}

test("Windows standalone state aliases and ..state child paths cannot write inside the original source", { skip: process.platform !== "win32" }, async () => fixture(async (sourceRepo, stateRoot, revision) => {
  const entries = (await fs.readdir(sourceRepo)).sort();
  const sandboxRoot = path.join(path.dirname(sourceRepo), "candidates");
  for (const insideState of [path.join(sourceRepo.toUpperCase(), ".state"), path.join(sourceRepo, "..state")]) {
    await assert.rejects(preflightDevelopmentTaskSpec({ sourceRepo, stateRoot: insideState, sandboxRoot, spec: spec("") }), DomainValidationError);
    assert.deepEqual((await fs.readdir(sourceRepo)).sort(), entries, "rejection must not create any state under the original source");
    assert.deepEqual(await fs.readdir(sandboxRoot), [], "invalid state containment must refuse before candidate allocation");
  }
  const outsideState = path.join(path.dirname(stateRoot), "..state");
  const result = await preflightDevelopmentTaskSpec({ sourceRepo, stateRoot: outsideState, sandboxRoot, spec: spec("") });
  assert.equal(result.ok, true, result.reason); assert.equal(result.candidateDisposition, "removed");
  assert.ok(result.artifactPath.startsWith(outsideState + path.sep));
  assert.deepEqual((await fs.readdir(sourceRepo)).sort(), entries);
  assert.equal(await readFile(path.join(sourceRepo, "value.txt"), "utf8"), "original");
  assert.equal(git(sourceRepo, ["rev-parse", "HEAD"]), revision);
  assert.equal(git(sourceRepo, ["status", "--porcelain=v1", "--ignored"]), "");
}));

test("TaskSpec delivery rechecks its total deadline after real accepted artifact publication and run-lock cleanup", async () => fixture(async (sourceRepo, stateRoot, revision) => {
  const totalSeconds = 15;
  const sandboxRoot = await sandbox(stateRoot);
  const originalRename = fs.rename; const originalRemove = fs.rm;
  let terminalPublished = false; let blocked = false; let nativeArtifactPath = "";
  let factories = 0; let requests = 0;
  const started = performance.now();
  fs.rename = (async (...call: Parameters<typeof fs.rename>) => {
    let selected = false;
    if (String(call[1]).includes(`${path.sep}loop-artifacts${path.sep}`)) {
      try {
        const envelope = JSON.parse(readFileSync(call[0], "utf8"));
        selected = envelope.body?.kind === "native-write-loop" && envelope.body.stopReason === "accepted";
      } catch { /* unrelated atomic publication is outside the injection seam */ }
    }
    await originalRename(...call);
    if (selected) { terminalPublished = true; nativeArtifactPath = String(call[1]); }
  }) as typeof fs.rename;
  fs.rm = (async (...call: Parameters<typeof fs.rm>) => {
    await originalRemove(...call);
    if (terminalPublished && !blocked && String(call[0]).endsWith(".lock")) {
      blocked = true;
      // One bounded synchronous wait lets monotonic time pass while preventing
      // timer callbacks. The underlying successful artifact and lock are real.
      const remaining = Math.max(1, started + totalSeconds * 1000 + 100 - performance.now());
      assert.ok(remaining <= totalSeconds * 1000 + 100);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, remaining);
    }
  }) as typeof fs.rm;
  syncBuiltinESMExports();
  let outcome: { result: Awaited<ReturnType<typeof startDevelopmentTaskSpec>> } | { error: unknown };
  try {
    const definition = spec("process.stdout.write('FINAL_REAL_CHECK_PASSED');");
    outcome = await startDevelopmentTaskSpec({ sourceRepo, stateRoot, sandboxRoot,
      spec: { ...definition, budget: { ...definition.budget, totalSeconds } }, executorFactory: () => {
        factories++;
        return { async *execute(request, signal) { requests++; yield* new ProtocolChildExecutor().execute(request, signal); } };
      } }).then((result) => ({ result }), (error: unknown) => ({ error }));
  } finally { fs.rename = originalRename; fs.rm = originalRemove; syncBuiltinESMExports(); }
  assert.equal(factories, 1); assert.equal(requests, 1);
  assert.equal(terminalPublished, true, "the test must reach the actual successful Native loop artifact");
  assert.equal(blocked, true, "the actual post-publication lock cleanup must cross the delivery deadline");
  assert.ok(performance.now() - started >= totalSeconds * 1000);
  const loop = JSON.parse(await readFile(nativeArtifactPath, "utf8")).body;
  assert.equal(loop.stopReason, "accepted");
  const attempt = loop.attempts[0];
  const verified = await readLoopArtifact(stateRoot, attempt.runId, attempt.artifact.id) as {
    check: { ok: boolean; exitCode: number; stdoutText: string; trustedVerification: { ok: boolean } }
  };
  assert.equal(verified.check.ok, true); assert.equal(verified.check.exitCode, 0); assert.equal(verified.check.trustedVerification.ok, true);
  assert.ok(verified.check.stdoutText.includes("FINAL_REAL_CHECK_PASSED"));
  assert.ok("error" in outcome, "an accepted Native artifact cannot authorize TaskSpec delivery after its total deadline");
  assert.ok(outcome.error instanceof DomainValidationError);
  const message = outcome.error.message;
  for (const locator of [attempt.runId, attempt.artifact.id, loop.candidatePath]) {
    assert.ok(message.includes(locator), "deadline refusal must retain the real run, artifact and candidate locators");
  }
  assert.equal(await readFile(path.join(sourceRepo, "value.txt"), "utf8"), "original");
  assert.equal(git(sourceRepo, ["rev-parse", "HEAD"]), revision);
  assert.equal(git(sourceRepo, ["status", "--porcelain=v1", "--ignored"]), "");
}));
