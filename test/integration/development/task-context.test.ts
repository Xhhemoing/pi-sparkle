import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { ConversationSession } from "../../../src/conversation/session.js";
import type { TaskContextInput } from "../../../src/context/task-context.js";
import { startDevelopmentTask, type StartDevelopmentTaskInput } from "../../../src/development/start-task.js";
import { NativeWriteSession, type NativeWriteExecutorFactory } from "../../../src/native/write-session.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";

const BEFORE = "export const value = 'CONTEXT_REQUIRED_你好';\n";
const AFTER = "export const value = 'repaired';\n";
function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}
interface Fixture { sourceRepo: string; stateRoot: string; sandboxRoot: string; revision: string; }
async function fixture(body: (value: Fixture) => Promise<void>, invalidUtf8 = false): Promise<void> {
  const directory = path.resolve(".agent_workspace/staged-continuation");
  await mkdir(directory, { recursive: true });
  const root = await mkdtemp(path.join(directory, "m1-native-"));
  const sourceRepo = path.join(root, "source");
  const sandboxRoot = path.join(root, "candidates");
  try {
    await mkdir(sourceRepo); await mkdir(sandboxRoot);
    git(sourceRepo, ["init"]); git(sourceRepo, ["config", "core.autocrlf", "false"]);
    git(sourceRepo, ["config", "user.name", "Context fixture"]); git(sourceRepo, ["config", "user.email", "fixture@example.invalid"]);
    await writeFile(path.join(sourceRepo, "value.ts"), invalidUtf8 ? Buffer.from([0xff]) : BEFORE, "utf8");
    git(sourceRepo, ["add", "."]); git(sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
    await body({ sourceRepo, sandboxRoot, stateRoot: path.join(root, "state"), revision: git(sourceRepo, ["rev-parse", "HEAD"]) });
  } finally { await rm(root, { recursive: true, force: true }); }
}
function context(value: Fixture, overrides: Partial<TaskContextInput> = {}): TaskContextInput {
  return { requiredFiles: ["value.ts"], expectedSourceRevision: value.revision, tokenBudget: 4000, ...overrides };
}
function task(value: Fixture, executorFactory: NativeWriteExecutorFactory): StartDevelopmentTaskInput {
  return { sourceRepo: value.sourceRepo, stateRoot: value.stateRoot, sandboxRoot: value.sandboxRoot, objective: "Repair value.ts", executorFactory,
    verification: { command: process.execPath, args: ["-e", "process.exit(0)"] }, taskContext: context(value) };
}

test("direct context reaches the actual execution prompt and factory while host verifier remains authoritative", async () => fixture(async (value) => {
  let prompt = ""; let objective = "";
  const input = task(value, (prepared) => ({ async *execute(request, signal) {
    objective = prepared.objective; prompt = request.prompt;
    yield* new ProtocolChildExecutor().execute(request, signal);
  } }));
  const result = await startDevelopmentTask({ ...input, acceptanceCriteria: [{ id: "check", description: "Named host requirement", observableCheck: "real verifier decides" }],
    verification: { command: process.execPath, args: ["-e", "process.exit(1)"] } });
  assert.match(prompt, /CONTEXT_REQUIRED_你好/);
  assert.match(objective, /CONTEXT_REQUIRED_你好/);
  assert.match(prompt, /UNTRUSTED CANDIDATE SOURCE/);
  assert.match(prompt, /Named host requirement/);
  assert.equal(result.acceptance.accepted, false);
  assert.equal(result.acceptance.independentCheck?.exitCode, 1);
  assert.equal(await readFile(path.join(value.sourceRepo, "value.ts"), "utf8"), BEFORE);
  assert.equal(git(value.sourceRepo, ["status", "--porcelain=v1"]), "");
}));

for (const mode of ["missing", "stale", "budget", "utf8", "escaped"] as const) {
  test(`invalid ${mode} mandatory context refuses before factory/worker and disposes only unused candidate`, async () => fixture(async (value) => {
    let factories = 0; let workers = 0;
    const selected = context(value, mode === "missing" ? { requiredFiles: ["missing.ts"] } : mode === "stale" ? { expectedSourceRevision: "stale" } : mode === "budget" ? { tokenBudget: 1 } : mode === "escaped" ? { requiredFiles: ["../outside.ts"] } : {});
    const input = { ...task(value, () => { factories++; return { async *execute() { workers++; yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" }; } }; }), taskContext: selected };
    await assert.rejects(startDevelopmentTask(input), /context|revision|relative|UTF-8|budget/i);
    assert.equal(factories, 0); assert.equal(workers, 0);
    assert.deepEqual(await readdir(value.sandboxRoot), []);
    assert.equal(git(value.sourceRepo, ["status", "--porcelain=v1"]), "");
  }, mode === "utf8"));
}

for (const entry of ["direct", "native"] as const) {
  test(`${entry} snapshots task context before asynchronous work and rejects own/inherited accessors`, async () => fixture(async (value) => {
    let calls = 0; let prompt = "";
    const files = ["value.ts"];
    const input = { ...task(value, () => ({ async *execute(request, signal) { calls++; prompt = request.prompt; yield* new ProtocolChildExecutor().execute(request, signal); } })), taskContext: context(value, { requiredFiles: files }) };
    const session = new NativeWriteSession(input);
    try {
      const run = (selected: StartDevelopmentTaskInput) => entry === "direct" ? startDevelopmentTask(selected) : session.execute(selected);
      const pending = run(input);
      files[0] = "missing.ts";
      const result = await pending;
      assert.equal(result.acceptance.accepted, true, result.reason);
      assert.match(prompt, /CONTEXT_REQUIRED_你好/);
      let getters = 0;
      const getter = Object.defineProperty({ ...input }, "taskContext", { get() { getters++; return context(value); } });
      await assert.rejects(run(getter), /own data/);
      const inherited = Object.assign(Object.create({ taskContext: context(value) }) as StartDevelopmentTaskInput, input);
      delete (inherited as { taskContext?: TaskContextInput }).taskContext;
      await assert.rejects(run(inherited), /own data/);
      assert.equal(getters, 0); assert.equal(calls, 1);
    } finally { await session.shutdown(); }
  }));
}

test("repair rebuild reads current candidate bytes into the second actual prompt", async () => fixture(async (value) => {
  const prompts: string[] = []; const candidates: string[] = [];
  const result = await startDevelopmentTask({ ...task(value, ({ tools, candidatePath, attempt }) => ({ async *execute(request, signal) {
    prompts.push(request.prompt); candidates.push(candidatePath);
    await tools.find((tool) => tool.name === "sparkle_write_file")!.execute("write", { path: "value.ts", contents: attempt?.number === 1 ? "FIRST_REPAIR_BYTES" : AFTER });
    yield* new ProtocolChildExecutor().execute(request, signal);
  } })), maxAttempts: 2,
  verification: { command: process.execPath, args: ["-e", `process.exit(require('node:fs').readFileSync('value.ts','utf8') === ${JSON.stringify(AFTER)} ? 0 : 1)`] } });
  assert.equal(result.acceptance.accepted, true, result.reason);
  assert.equal(prompts.length, 2);
  assert.match(prompts[0]!, /CONTEXT_REQUIRED_你好/);
  assert.match(prompts[1]!, /FIRST_REPAIR_BYTES/);
  assert.deepEqual(candidates, [result.candidatePath, result.candidatePath]);
  assert.deepEqual(result.loop?.attempts.map((attempt) => attempt.accepted), [false, true]);
  assert.equal(await readFile(path.join(value.sourceRepo, "value.ts"), "utf8"), BEFORE);
}));

test("repair context failure retains previous candidate and check evidence without another worker", async () => fixture(async (value) => {
  let factories = 0;
  const counter = path.join(value.stateRoot, "checker-calls.txt");
  const result = await startDevelopmentTask({ ...task(value, ({ candidatePath }) => {
    factories++;
    return { async *execute(request, signal) {
      await writeFile(path.join(candidatePath, "value.ts"), Buffer.from([0xff]));
      yield* new ProtocolChildExecutor().execute(request, signal);
    } };
  }), maxAttempts: 2, verification: { command: process.execPath, args: ["-e", `require("node:fs").appendFileSync(${JSON.stringify(counter)}, "check\\n"); process.exit(1)`] } });
  assert.equal(factories, 1);
  assert.equal(result.status, "FAILED");
  assert.equal(result.acceptance.accepted, false);
  assert.match(result.reason, /context|UTF-8/i);
  assert.equal(result.loop?.attempts.length, 1);
  const prior = result.loop!.attempts[0]!;
  const priorEvidence = JSON.parse(await readFile(prior.artifact.path, "utf8")) as {
    runId: string; body: { kind: string; check: { checkId: string; exitCode: number; cwd: string; revision: string } };
  };
  const failure = JSON.parse(await readFile(result.artifact.path, "utf8")) as {
    runId: string; body: { kind: string; reason: string; candidatePath: string; sourceRevision: string };
  };
  const summary = JSON.parse(await readFile(result.loop!.artifact.path, "utf8")) as {
    runId: string; body: { kind: string; stopReason: string; candidatePath: string; attempts: unknown[] };
  };
  assert.equal(failure.runId, prior.runId);
  assert.equal(failure.body.kind, "native-write-failure");
  assert.match(failure.body.reason, /task context admission failed.*UTF-8/);
  assert.equal(failure.body.candidatePath, result.candidatePath);
  assert.equal(failure.body.sourceRevision, value.revision);
  assert.equal(summary.runId, prior.runId);
  assert.equal(summary.body.kind, "native-write-loop");
  assert.equal(summary.body.stopReason, "executor-failed");
  assert.equal(summary.body.candidatePath, result.candidatePath);
  assert.deepEqual(summary.body.attempts, result.loop!.attempts);
  assert.equal(priorEvidence.runId, prior.runId);
  assert.equal(priorEvidence.body.kind, "ps-p3-closed-loop");
  assert.ok(priorEvidence.body.check.checkId);
  assert.equal(priorEvidence.body.check.exitCode, 1);
  assert.equal(priorEvidence.body.check.cwd, result.candidatePath);
  assert.equal(priorEvidence.body.check.revision, value.revision);
  assert.equal(await readFile(counter, "utf8"), "check\n", "context failure must not invoke a second verifier");
  assert.deepEqual(await readFile(path.join(result.candidatePath, "value.ts")), Buffer.from([0xff]));
  assert.equal(await readFile(path.join(value.sourceRepo, "value.ts"), "utf8"), BEFORE);
}));

test("conversation snapshots host-selected context registration and refuses context supplied by a request", async () => fixture(async (value) => {
  const files = ["value.ts"]; let prompt = "";
  const binding = { ...task(value, () => ({ async *execute(request, signal) { prompt = request.prompt; yield* new ProtocolChildExecutor().execute(request, signal); } })), taskContext: context(value, { requiredFiles: files }) };
  const target = { projectRef: "project", taskRef: "task" };
  const session = new ConversationSession({ projects: [{ projectRef: "project" }], tasks: [{ ...target, input: binding }] });
  files[0] = "missing.ts";
  await session.handle({ kind: "focus", target, focus: session.focus().token, messageRef: "focus" });
  const request = { kind: "run-direct" as const, target, focus: session.focus().token, messageRef: "run", requestId: "request" };
  await assert.rejects(session.handle({ ...request, taskContext: context(value) } as typeof request), /unsupported/);
  const response = await session.handle(request);
  assert.equal(response.kind, "direct-result");
  if (response.kind === "direct-result") assert.equal(response.result.acceptance.accepted, true, response.result.reason);
  assert.match(prompt, /CONTEXT_REQUIRED_你好/);
}));
