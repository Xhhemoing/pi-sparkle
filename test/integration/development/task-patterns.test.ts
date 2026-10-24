import { startDevelopmentTask } from "../../../src/development/start-task.js";
import { prepareScopedDevelopmentVerification } from "../../../src/development/task-policy.js";
import { prepareDevelopmentCheckPlan } from "../../../src/development/check-plan.js";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { startDevelopmentTaskSpec } from "../../../src/development/start-task-spec.js";
import { snapshotDevelopmentTaskSpec, type DevelopmentTaskSpec } from "../../../src/development/task-spec.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
async function fixture(body: (sourceRepo: string, stateRoot: string, sandboxRoot: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "sparkle-spec-pattern-"));
  const sourceRepo = path.join(root, "source");
  await mkdir(path.join(sourceRepo, "src"), { recursive: true });
  await mkdir(path.join(root, "candidates"));
  await writeFile(path.join(sourceRepo, "value.txt"), "before", "utf8");
  await writeFile(path.join(sourceRepo, "src/guard.ts"), "protected", "utf8");
  await writeFile(path.join(sourceRepo, ".gitignore"), "src/**/*.tmp\n", "utf8");
  git(sourceRepo, ["init"]); git(sourceRepo, ["config", "core.autocrlf", "false"]);
  git(sourceRepo, ["config", "user.name", "Pattern fixture"]); git(sourceRepo, ["config", "user.email", "fixture@example.invalid"]);
  git(sourceRepo, ["add", "."]); git(sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
  const revision = git(sourceRepo, ["rev-parse", "HEAD"]);
  try { await body(sourceRepo, path.join(root, "state"), path.join(root, "candidates")); }
  finally {
    assert.equal(git(sourceRepo, ["rev-parse", "HEAD"]), revision);
    assert.equal(git(sourceRepo, ["status", "--porcelain=v1", "--ignored"]), "");
    assert.equal(await readFile(path.join(sourceRepo, "value.txt"), "utf8"), "before");
    assert.equal(await readFile(path.join(sourceRepo, "src/guard.ts"), "utf8"), "protected");
    assert.equal(path.dirname(root), path.resolve(tmpdir())); assert.ok(path.basename(root).startsWith("sparkle-spec-pattern-"));
    await rm(root, { recursive: true, force: true });
  }
}
function spec(finalCode = ""): DevelopmentTaskSpec {
  return { version: 1, objective: "Change the allowed value and future TypeScript file", context: ["value.txt"],
    write: { allow: ["value.txt", "src/**/*.ts"], protect: ["src/**/guard*"] }, prepare: [],
    checks: [{ id: "real", command: process.execPath, args: ["-e", `const fs=require('node:fs'); if(fs.readFileSync('value.txt','utf8')==='after'){${finalCode}}`],
      verifierVersion: "v1", protectedPaths: ["src/guard.ts"], expect: { baseline: "pass" } }],
    budget: { totalSeconds: 60, prepareSeconds: 10, checkSeconds: 10, workerSeconds: 15 }, worker: { model: "inherit" } };
}

test("TaskSpec preserves bounded write patterns while context and checker declarations stay literal", () => {
  assert.deepEqual(snapshotDevelopmentTaskSpec(spec()).write, spec().write);
  assert.throws(() => snapshotDevelopmentTaskSpec({ ...spec(), context: ["src/**/*.ts"] }));
  assert.throws(() => snapshotDevelopmentTaskSpec({ ...spec(), checks: [{ ...spec().checks[0], protectedPaths: ["src/**"] }] }));
});

for (const toolName of ["sparkle_write_file", "sparkle_patch_file"] as const) {
  test(`TaskSpec ${toolName} refuses protected matches and accepts a future glob-allowed file`, async () => fixture(async (sourceRepo, stateRoot, sandboxRoot) => {
    let refused: unknown; let calls = 0;
    const result = await startDevelopmentTaskSpec({ sourceRepo, stateRoot, sandboxRoot, spec: spec("if(fs.readFileSync('src/new.ts','utf8')!=='new')process.exit(2);"),
      executorFactory: ({ tools }) => ({ async *execute(request, signal) {
        calls++;
        try { await tools.find((tool) => tool.name === toolName)!.execute("protected", toolName === "sparkle_write_file"
          ? { path: "src/guard.ts", contents: "bad" } : { path: "src/guard.ts", oldText: "protected", newText: "bad" }, signal); }
        catch (error) { refused = error; }
        const write = tools.find((tool) => tool.name === "sparkle_write_file")!;
        await write.execute("future", { path: "src/new.ts", contents: "new" }, signal);
        await write.execute("value", { path: "value.txt", contents: "after" }, signal);
        yield* new ProtocolChildExecutor().execute(request, signal);
      } }) });
    assert.equal(calls, 1); assert.ok(refused instanceof Error);
    assert.equal(result.preflight?.ok, true);
    assert.equal(result.execution.acceptance.accepted, true, result.execution.reason);
    assert.equal(await readFile(path.join(result.execution.candidatePath, "src/guard.ts"), "utf8"), "protected");
    assert.equal(await readFile(path.join(result.execution.candidatePath, "src/new.ts"), "utf8"), "new");
  }));
}

test("every required protection pattern must match before the real factory", async () => fixture(async (sourceRepo, stateRoot, sandboxRoot) => {
  let factories = 0; const definition = spec();
  const result = await startDevelopmentTaskSpec({ sourceRepo, stateRoot, sandboxRoot,
    spec: { ...definition, write: { ...definition.write, protect: [...definition.write.protect, "missing/**/checker.ts"] } },
    executorFactory: () => { factories++; return new ProtocolChildExecutor(); } });
  assert.equal(factories, 0); assert.equal(result.execution.acceptance.accepted, false);
  assert.match(result.execution.reason, /required.*(?:pattern|selector).*missing|missing.*(?:pattern|selector)/i);
}));

for (const actor of ["worker", "checker"] as const) {
  test(`TaskSpec detects a newly created ignored protected match from the real ${actor}`, async () => fixture(async (sourceRepo, stateRoot, sandboxRoot) => {
    let calls = 0;
    const result = await startDevelopmentTaskSpec({ sourceRepo, stateRoot, sandboxRoot,
      spec: spec(actor === "checker" ? "fs.writeFileSync('src/guard-new.tmp','new protected');" : ""),
      executorFactory: ({ tools, candidatePath }) => ({ async *execute(request, signal) {
        calls++;
        if (actor === "worker") await writeFile(path.join(candidatePath, "src/guard-new.tmp"), "new protected", "utf8");
        await tools.find((tool) => tool.name === "sparkle_write_file")!.execute("value", { path: "value.txt", contents: "after" }, signal);
        yield* new ProtocolChildExecutor().execute(request, signal);
      } }) });
    assert.equal(calls, 1, "the actual worker must execute"); assert.equal(result.preflight?.ok, true);
    assert.equal(await readFile(path.join(result.execution.candidatePath, "src/guard-new.tmp"), "utf8"), "new protected");
    assert.equal(git(result.execution.candidatePath, ["check-ignore", "src/guard-new.tmp"]), "src/guard-new.tmp");
    assert.equal(result.execution.acceptance.accepted, false, "dynamic matching must prevent acceptance");
  }));
}

test("glob protection must cover an entire declared checker prefix, not only existing child files", () => {
  const checks = [{ id: "check", command: process.execPath, args: ["-e", ""], verifierVersion: "v1", protectedPaths: ["checks"] }];
  assert.throws(() => prepareDevelopmentCheckPlan({ checks, scopePolicy: { allowedScope: ["src/**"], protectedPaths: ["checks/*.ts"] } }), /not covered/);
  assert.doesNotThrow(() => prepareDevelopmentCheckPlan({ checks, scopePolicy: { allowedScope: ["src/**"], protectedPaths: ["checks/**"] } }));
});

test("glob repair retains the initial protected observation across actual failed-check feedback", async () => fixture(async (sourceRepo, stateRoot, sandboxRoot) => {
  const scopePolicy = { allowedScope: ["value.txt", "src/**/*.ts"], protectedPaths: ["src/**/guard*"] };
  const verification = prepareScopedDevelopmentVerification({ scopePolicy, command: process.execPath,
    args: ["-e", "process.exit(require('node:fs').readFileSync('value.txt','utf8')==='after'?0:1)"] });
  let factories = 0; let analyses = 0; let candidate = "";
  const result = await startDevelopmentTask({ sourceRepo, stateRoot, sandboxRoot, scopePolicy,
    objective: "Repair within the original pattern protection", verification: { ...verification, repairableExitCodes: [1] }, maxAttempts: 2,
    executorFactory: ({ candidatePath, tools, attempt }) => {
      factories++; candidate = candidatePath;
      return { async *execute(request, signal) {
        await tools.find((tool) => tool.name === "sparkle_write_file")!.execute("value", { path: "value.txt", contents: attempt?.number === 1 ? "needs repair" : "after" }, signal);
        yield* new ProtocolChildExecutor().execute(request, signal);
      } };
    }, checkFindingAnalysis: { analyze: async ({ feedback }) => {
      analyses++; assert.equal(feedback.exitCode, 1); assert.ok(candidate);
      await writeFile(path.join(candidate, "src/guard-new.tmp"), "after first check", "utf8");
      return { summary: "keep the original protection across repair" };
    } } });
  assert.equal(analyses, 1); assert.equal(result.loop?.attempts.length, 2); assert.equal(factories, 1);
  assert.equal(result.acceptance.accepted, false);
  assert.equal(await readFile(path.join(result.candidatePath, "src/guard-new.tmp"), "utf8"), "after first check");
}));

test("glob scope checks include candidate-committed paths outside the allowed pattern", async () => fixture(async (sourceRepo, stateRoot, sandboxRoot) => {
  let called = false;
  const result = await startDevelopmentTaskSpec({ sourceRepo, stateRoot, sandboxRoot, spec: spec(),
    executorFactory: ({ candidatePath, tools }) => ({ async *execute(request, signal) {
      called = true;
      await writeFile(path.join(candidatePath, "src/outside.js"), "not allowed", "utf8");
      git(candidatePath, ["add", "src/outside.js"]);
      git(candidatePath, ["-c", "commit.gpgsign=false", "commit", "-m", "candidate outside pattern"]);
      await tools.find((tool) => tool.name === "sparkle_write_file")!.execute("value", { path: "value.txt", contents: "after" }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    } }) });
  assert.equal(called, true); assert.equal(result.execution.acceptance.accepted, false);
  assert.equal(await readFile(path.join(result.execution.candidatePath, "src/outside.js"), "utf8"), "not allowed");
}));

test("broad glob scope cannot grant access to the candidate Git control file", async () => fixture(async (sourceRepo, stateRoot, sandboxRoot) => {
  let refused: unknown; let before = "";
  const definition = spec();
  const result = await startDevelopmentTaskSpec({ sourceRepo, stateRoot, sandboxRoot,
    spec: { ...definition, write: { ...definition.write, allow: ["**"] } },
    executorFactory: ({ candidatePath, tools }) => ({ async *execute(request, signal) {
      before = await readFile(path.join(candidatePath, ".git"), "utf8");
      try { await tools.find((tool) => tool.name === "sparkle_write_file")!.execute("git-control", { path: ".git", contents: "bad" }, signal); }
      catch (error) { refused = error; }
      await tools.find((tool) => tool.name === "sparkle_write_file")!.execute("value", { path: "value.txt", contents: "after" }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    } }) });
  assert.ok(refused instanceof Error); assert.equal(result.execution.acceptance.accepted, true, result.execution.reason);
  assert.equal(await readFile(path.join(result.execution.candidatePath, ".git"), "utf8"), before);
}));
test("TaskSpec preflight requires every literal checker dependency even when its protection glob matches another file", async () => fixture(async (sourceRepo, stateRoot, sandboxRoot) => {
  let factories = 0; const definition = spec();
  const result = await startDevelopmentTaskSpec({ sourceRepo, stateRoot, sandboxRoot,
    spec: { ...definition, write: { ...definition.write, protect: ["src/**"] },
      checks: [{ ...definition.checks[0]!, protectedPaths: ["src/missing.ts"] }] },
    executorFactory: () => { factories++; return new ProtocolChildExecutor(); } });
  assert.equal(factories, 0, "a different glob match cannot replace the declared required checker dependency");
  assert.equal(result.execution.acceptance.accepted, false);
  assert.equal(result.preflight?.ok, false);
  assert.match(result.preflight!.reason, /required include prefix is missing/);
}));
