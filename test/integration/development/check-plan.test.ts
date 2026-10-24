import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { startDevelopmentTask } from "../../../src/development/start-task.js";
import { prepareDevelopmentCheckPlan } from "../../../src/development/check-plan.js";
import { prepareWorkItemRecipes, type WorkItemRecipe } from "../../../src/development/work-items.js";
import { prepareTrustedVerification } from "../../../src/execution/trusted-verification.js";
import { readLoopArtifact } from "../../../src/execution/loop-artifact.js";
import { NativeWriteSession, type NativeWriteExecutorFactory, type NativeWriteExecutorFactoryInput } from "../../../src/native/write-session.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";

const BEFORE = "original source";
const AFTER = "repaired value";
const VISIBLE_ID = "visible_value_check";
const VISIBLE_HINT = "VISIBLE_REPAIR_HINT_SET_VALUE_TO_REPAIRED";
const HIDDEN_ID = "private_host_check_7c62";
const HIDDEN_ARGV = "HOST_ONLY_COMMAND_ARGUMENT_91da";
const HIDDEN_STDOUT = "HOST_ONLY_STDOUT_MARKER_f310";
const HIDDEN_STDERR = "HOST_ONLY_STDERR_MARKER_09af";
interface Fixture { root: string; sourceRepo: string; stateRoot: string; sandboxRoot: string; revision: string; }
interface FixedCheck extends WorkItemRecipe { readonly visibleToWorker?: boolean; }
interface WorkerObservation { objective: string; attempt: Record<string, unknown> | undefined; acceptanceCriteria: unknown; preparedContext: unknown; }

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}
async function fixture(body: (f: Fixture) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "sparkle-check-plan-"));
  const sourceRepo = path.join(root, "source");
  const sandboxRoot = path.join(root, "candidates");
  await mkdir(path.join(sourceRepo, "checks"), { recursive: true });
  await mkdir(sandboxRoot);
  git(sourceRepo, ["init"]);
  git(sourceRepo, ["config", "core.autocrlf", "false"]);
  git(sourceRepo, ["config", "user.name", "Check plan fixture"]);
  git(sourceRepo, ["config", "user.email", "fixture@example.invalid"]);
  await writeFile(path.join(sourceRepo, "value.txt"), BEFORE, "utf8");
  await writeFile(path.join(sourceRepo, "checks", "guard.txt"), "protected checker input", "utf8");
  git(sourceRepo, ["add", "."]);
  git(sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
  const revision = git(sourceRepo, ["rev-parse", "HEAD"]);
  try { await body({ root, sourceRepo, sandboxRoot, revision, stateRoot: path.join(root, "state") }); }
  finally {
    try {
      assert.equal(git(sourceRepo, ["rev-parse", "HEAD"]), revision);
      assert.equal(git(sourceRepo, ["status", "--porcelain=v1", "--untracked-files=all", "--ignored"]), "");
      assert.equal(await readFile(path.join(sourceRepo, "value.txt"), "utf8"), BEFORE);
      assert.equal(await readFile(path.join(sourceRepo, "checks", "guard.txt"), "utf8"), "protected checker input");
    } finally {
      assert.equal(path.dirname(root), path.resolve(tmpdir()));
      assert.ok(path.basename(root).startsWith("sparkle-check-plan-"));
      await rm(root, { recursive: true, force: true });
    }
  }
}

function hostInput(f: Fixture, checks: readonly FixedCheck[], executorFactory: NativeWriteExecutorFactory) {
  // Keep the original RED fixtures on manually issued matching descriptors;
  // their compatibility assertions remain independent of the new host helper.
  const recipes = prepareWorkItemRecipes(checks.map(({ visibleToWorker: _visibility, ...recipe }) => recipe));
  const checker = fileURLToPath(new URL("../../../src/development/recipe-check.ts", import.meta.url));
  const command = process.execPath;
  const args = ["--import", import.meta.resolve("tsx"), checker, JSON.stringify(recipes), "--structured"];
  const scopePolicy = { allowedScope: ["value.txt"], protectedPaths: ["checks"] };
  const trustedVerification = prepareTrustedVerification({ command, args,
    checkerFiles: [checker,
      fileURLToPath(new URL("../../../src/execution/command-runner.ts", import.meta.url)),
      fileURLToPath(new URL("../../../src/development/work-items.ts", import.meta.url)),
      fileURLToPath(new URL("../../../src/domain/errors.ts", import.meta.url))],
    snapshotManifest: { includePrefixes: scopePolicy.protectedPaths, optionalIncludePrefixes: scopePolicy.allowedScope },
    maxSnapshotFiles: 1024, maxSnapshotBytes: 16 * 1024 * 1024 });
  return { sourceRepo: f.sourceRepo, stateRoot: f.stateRoot, sandboxRoot: f.sandboxRoot,
    objective: "Repair the allowed value using only worker-visible check feedback", scopePolicy,
    verification: { command, args, trustedVerification, repairableExitCodes: [1], unsettledExitCodes: [3] },
    checkPlan: { checks }, executorFactory, maxAttempts: 2,
    taskContext: { requiredFiles: ["value.txt"], expectedSourceRevision: f.revision, tokenBudget: 16000 } };
}
function observe(context: NativeWriteExecutorFactoryInput): WorkerObservation {
  return JSON.parse(JSON.stringify({ objective: context.objective, attempt: context.attempt,
    acceptanceCriteria: context.acceptanceCriteria, preparedContext: context.preparedContext })) as WorkerObservation;
}
function recipe(id: string, code: string, rest: readonly string[] = []): WorkItemRecipe {
  return { id, command: process.execPath, args: ["-e", code, ...rest], verifierVersion: "v1", protectedPaths: ["checks"] };
}

// These are host checks, not held-out benchmark scores. The test isolates the
// feedback channel; it makes no OS secrecy claim about source-contained scripts.
test("fixed check plan keeps hidden host diagnostics out of the second real worker while retaining host evidence", async () => fixture(async (f) => {
  const visible = recipe(VISIBLE_ID, "process.stdout.write('VISIBLE_CHECK_PASSED');");
  const hidden = recipe(HIDDEN_ID,
    `process.stdout.write(${JSON.stringify(`${HIDDEN_STDOUT} ${HIDDEN_ID} ${HIDDEN_ARGV}`)}); process.stderr.write(${JSON.stringify(HIDDEN_STDERR)}); process.exit(1);`,
    [HIDDEN_ARGV]);
  const checks: readonly FixedCheck[] = [{ ...visible, visibleToWorker: true }, { ...hidden, visibleToWorker: false }];
  const observations: WorkerObservation[] = [];
  const prompts: string[] = [];
  const factory: NativeWriteExecutorFactory = (context) => {
    observations.push(observe(context));
    return { async *execute(request, signal) {
      prompts.push(request.prompt);
      await context.tools.find((tool) => tool.name === "sparkle_write_file")!.execute("legal-change", {
        path: "value.txt", contents: context.attempt?.number === 1 ? "first candidate" : "second candidate"
      }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    } };
  };
  const input = hostInput(f, checks, factory);
  const result = await startDevelopmentTask(input);
  assert.equal(observations.length, 2, "both real executor factories must run; do not downgrade requested attempts");
  assert.equal(prompts.length, 2, "both real worker requests must execute");
  assert.equal(result.loop?.maxAttempts, 2);
  assert.equal(result.loop?.attempts.length, 2);
  assert.equal(result.acceptance.accepted, false, "the actual hidden failure must still decide host acceptance");
  const first = result.loop!.attempts[0]!;
  const body = await readLoopArtifact(f.stateRoot, first.runId, first.artifact.id) as {
    check: { exitCode: number; processStatus: string; stdoutText: string; stderrText: string; trustedVerification: { ok: boolean } }
  };
  assert.equal(body.check.exitCode, 1);
  assert.equal(body.check.processStatus, "completed");
  assert.equal(body.check.trustedVerification.ok, true);
  assert.ok(body.check.stdoutText.includes(VISIBLE_ID), "the visible checker must actually be attempted");
  const hostDiagnostics = `${body.check.stdoutText}\n${body.check.stderrText}`;
  for (const marker of [HIDDEN_ID, HIDDEN_ARGV, HIDDEN_STDOUT, HIDDEN_STDERR]) {
    assert.ok(hostDiagnostics.includes(marker), `bounded host evidence must retain ${marker}`);
  }
  const surfaces = [
    ...prompts.map((value, index) => ({ name: `request ${index + 1}`, value })),
    ...observations.map((value, index) => ({ name: `factory ${index + 1}`, value: JSON.stringify(value) }))
  ];
  const privateValues = [HIDDEN_ID, HIDDEN_ARGV, HIDDEN_STDOUT, HIDDEN_STDERR, first.runId, first.artifact.id];
  const leaks = surfaces.flatMap(({ name, value }) => privateValues.filter((secret) => value.includes(secret)).map((secret) => `${name}: ${secret}`));
  assert.deepEqual(leaks, [], "objective, prompt, criteria, preparedContext and attempt must exclude host-only diagnostics and references");
  const secondAttempt = observations[1]!.attempt;
  assert.ok(secondAttempt);
  assert.equal(Object.hasOwn(secondAttempt, "previous"), false, "plan repair must omit the legacy aggregate feedback entirely");
  assert.ok(secondAttempt.checkFeedback && typeof secondAttempt.checkFeedback === "object");
  const projected = JSON.stringify(secondAttempt.checkFeedback);
  assert.ok(projected.includes(VISIBLE_ID), "the projection must retain the visible check's actual result");
  assert.match(projected, /not[-_ ]accepted|rejected|failed|"accepted":false/i, "passing visible checks must not conceal generic host rejection");
}));

test("fixed visible check feedback still repairs the retained candidate on the second actual request", async () => fixture(async (f) => {
  const checks: readonly FixedCheck[] = [recipe(VISIBLE_ID,
    `if(require('node:fs').readFileSync('value.txt','utf8')!==${JSON.stringify(AFTER)}) { process.stdout.write(${JSON.stringify(VISIBLE_HINT)}); process.exit(1); } process.stdout.write('VISIBLE_CHECK_PASSED');`)];
  const observations: WorkerObservation[] = [];
  const prompts: string[] = [];
  const candidates: string[] = [];
  const factory: NativeWriteExecutorFactory = (context) => {
    observations.push(observe(context));
    candidates.push(context.candidatePath);
    return { async *execute(request, signal) {
      prompts.push(request.prompt);
      const feedback = context.attempt as unknown as { checkFeedback?: unknown; previous?: unknown } | undefined;
      const feedbackText = JSON.stringify(feedback?.checkFeedback ?? feedback?.previous ?? {});
      await context.tools.find((tool) => tool.name === "sparkle_write_file")!.execute("repair-value", {
        path: "value.txt", contents: context.attempt?.number === 2 && feedbackText.includes(VISIBLE_HINT) ? AFTER : "needs repair"
      }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    } };
  };
  const input = hostInput(f, checks, factory);
  const result = await startDevelopmentTask(input);
  assert.equal(observations.length, 2);
  assert.equal(prompts.length, 2);
  assert.ok(prompts[1]!.includes(VISIBLE_HINT), "actual visible command output must reach the next worker's repair prompt");
  const feedback = observations[1]!.attempt;
  assert.ok(JSON.stringify(feedback?.checkFeedback ?? feedback?.previous ?? {}).includes(VISIBLE_HINT),
    "repair must consume actual failed-check feedback, not merely the visible check's command text");
  assert.deepEqual(candidates, [result.candidatePath, result.candidatePath]);
  assert.deepEqual(result.loop?.attempts.map((attempt) => attempt.accepted), [false, true]);
  assert.equal(result.loop?.maxAttempts, 2);
  assert.equal(result.acceptance.accepted, true, result.reason);
  assert.equal(result.acceptance.independentCheck?.exitCode, 0);
  assert.equal(await readFile(path.join(result.candidatePath, "value.txt"), "utf8"), AFTER);
}));

function preparedInput(f: Fixture, checks: readonly FixedCheck[], executorFactory: NativeWriteExecutorFactory) {
  const scopePolicy = { allowedScope: ["value.txt"], protectedPaths: ["checks"] };
  return { sourceRepo: f.sourceRepo, stateRoot: f.stateRoot, sandboxRoot: f.sandboxRoot,
    objective: "Use the fixed visible repair feedback", scopePolicy,
    ...prepareDevelopmentCheckPlan({ scopePolicy, checks }), executorFactory, maxAttempts: 2,
    taskContext: { requiredFiles: ["value.txt"], expectedSourceRevision: f.revision, tokenBudget: 16000 } };
}
function recordingWriter(observations: WorkerObservation[], prompts: string[]): NativeWriteExecutorFactory {
  return (context) => {
    observations.push(observe(context));
    return { async *execute(request, signal) {
      prompts.push(request.prompt);
      await context.tools.find((tool) => tool.name === "sparkle_write_file")!.execute("candidate-progress", {
        path: "value.txt", contents: `attempt ${context.attempt?.number ?? 1}`
      }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    } };
  };
}

test("all-hidden plans retain two actual attempts with only generic worker rejection and complete host diagnostics", async () => fixture(async (f) => {
  const checks = [{ ...recipe(HIDDEN_ID, `process.stdout.write(${JSON.stringify(HIDDEN_STDOUT)}); process.exit(1);`, [HIDDEN_ARGV]), visibleToWorker: false }];
  const observations: WorkerObservation[] = []; const prompts: string[] = [];
  const result = await startDevelopmentTask(preparedInput(f, checks, recordingWriter(observations, prompts)));
  assert.equal(observations.length, 2); assert.equal(prompts.length, 2);
  assert.equal(result.loop?.attempts.length, 2); assert.equal(result.loop?.maxAttempts, 2);
  assert.equal(result.acceptance.accepted, false);
  for (const observation of observations) {
    assert.equal(observation.acceptanceCriteria, undefined, "all-hidden plans must not create worker criteria");
    assert.equal(Object.hasOwn(observation.attempt!, "previous"), false);
    for (const secret of [HIDDEN_ID, HIDDEN_ARGV, HIDDEN_STDOUT]) assert.ok(!JSON.stringify(observation).includes(secret));
  }
  for (const prompt of prompts) for (const secret of [HIDDEN_ID, HIDDEN_ARGV, HIDDEN_STDOUT]) assert.ok(!prompt.includes(secret));
  assert.deepEqual(observations[1]!.attempt!.checkFeedback, { outcome: "not-accepted", checks: [] },
    "no hidden identity, output lengths, counts or artifact references belong in generic rejection");
  const first = result.loop!.attempts[0]!;
  const body = await readLoopArtifact(f.stateRoot, first.runId, first.artifact.id) as { check: { stdoutText: string; exitCode: number } };
  assert.equal(body.check.exitCode, 1);
  const report = JSON.parse(body.check.stdoutText) as { results: { recipeId: string; stdoutText: string }[] };
  assert.equal(report.results[0]!.recipeId, HIDDEN_ID);
  assert.equal(report.results[0]!.stdoutText, HIDDEN_STDOUT);
}));

test("caller check arrays and visibility changes after invocation cannot replace the captured plan or disclose hidden checks", async () => fixture(async (f) => {
  const checks = [
    { ...recipe(VISIBLE_ID, "process.stdout.write('visible pass');"), args: ["-e", "process.stdout.write('visible pass');"], visibleToWorker: true },
    { ...recipe(HIDDEN_ID, `process.stdout.write(${JSON.stringify(HIDDEN_STDOUT)}); process.exit(1);`),
      args: ["-e", `process.stdout.write(${JSON.stringify(HIDDEN_STDOUT)}); process.exit(1);`], visibleToWorker: false }
  ];
  const observations: WorkerObservation[] = []; const prompts: string[] = [];
  const prepared = preparedInput(f, checks, recordingWriter(observations, prompts));
  const input = { ...prepared, checkPlan: { checks } };
  const pending = startDevelopmentTask(input);
  checks[1]!.visibleToWorker = true;
  checks[1]!.args.splice(0, checks[1]!.args.length, "-e", "process.exit(0)");
  checks.push({ ...checks[0]!, id: "injected_after_start" });
  const result = await pending;
  assert.equal(observations.length, 2); assert.equal(prompts.length, 2);
  assert.equal(result.acceptance.accepted, false, "the original hidden failure remains authoritative");
  const disclosure = JSON.stringify({ observations, prompts });
  for (const secret of [HIDDEN_ID, HIDDEN_STDOUT, "injected_after_start"]) assert.ok(!disclosure.includes(secret));
  const first = result.loop!.attempts[0]!;
  const body = await readLoopArtifact(f.stateRoot, first.runId, first.artifact.id) as { check: { stdoutText: string } };
  const report = JSON.parse(body.check.stdoutText) as { results: { recipeId: string; exitCode: number; stdoutText: string }[] };
  assert.equal(report.results.length, 2);
  assert.equal(report.results[1]!.recipeId, HIDDEN_ID);
  assert.equal(report.results[1]!.exitCode, 1);
  assert.equal(report.results[1]!.stdoutText, HIDDEN_STDOUT);
}));

for (const invalid of ["visibility accessor", "mismatched recipe"] as const) {
  test(`fixed plan rejects ${invalid} before executor factory allocation`, async () => fixture(async (f) => {
    const original = recipe(VISIBLE_ID, "process.exit(0)");
    let factories = 0; let getters = 0;
    const prepared = preparedInput(f, [original], () => { factories++; throw new Error("invalid plan must not allocate a worker"); });
    const check = invalid === "visibility accessor" ? Object.defineProperty({ ...original }, "visibleToWorker", {
      enumerable: true, get() { getters++; return true; }
    }) : { ...original, args: ["-e", "process.exit(1)"] };
    const input = { ...prepared, checkPlan: { checks: [check] } };
    await assert.rejects(startDevelopmentTask(input), /plan|verif|accessor|ordinary/i);
    assert.equal(factories, 0);
    assert.equal(getters, 0, "accessor validation must not invoke caller code");
  }));
}

test("real structured host evidence exceeding 4 KiB remains complete while worker feedback contains only the visible row", async () => fixture(async (f) => {
  const secretA = "HOST_ONLY_LONG_FIRST_3dca";
  const secretB = "HOST_ONLY_LONG_FINAL_92ef";
  const outputA = `${"a".repeat(1900)}${secretA}`;
  const outputB = `${"b".repeat(1900)}${secretB}`;
  const checks: readonly FixedCheck[] = [recipe(VISIBLE_ID, "process.stdout.write('VISIBLE_PASS_OUTPUT');"),
    { ...recipe("private_long_first", `process.stdout.write(${JSON.stringify(outputA)}); process.stderr.write('e'.repeat(900)); process.exit(1);`), visibleToWorker: false },
    { ...recipe("private_long_final", `process.stdout.write(${JSON.stringify(outputB)}); process.stderr.write('f'.repeat(900)); process.exit(1);`), visibleToWorker: false }];
  const observations: WorkerObservation[] = []; const prompts: string[] = [];
  const result = await startDevelopmentTask(preparedInput(f, checks, recordingWriter(observations, prompts)));
  assert.equal(observations.length, 2); assert.equal(prompts.length, 2);
  assert.equal(result.acceptance.accepted, false);
  const first = result.loop!.attempts[0]!;
  const body = await readLoopArtifact(f.stateRoot, first.runId, first.artifact.id) as { check: {
    stdoutText: string; stdoutByteLength: number; exitCode: number; trustedVerification: { ok: boolean }
  } };
  assert.equal(body.check.exitCode, 1); assert.equal(body.check.trustedVerification.ok, true);
  assert.ok(Buffer.byteLength(body.check.stdoutText, "utf8") > 4096);
  assert.equal(Buffer.byteLength(body.check.stdoutText, "utf8"), body.check.stdoutByteLength, "the complete bounded outer report must be stored");
  const report = JSON.parse(body.check.stdoutText) as { results: { recipeId: string; stdoutText: string; stderrText: string; stdoutByteLength: number }[] };
  assert.equal(report.results.length, 3);
  assert.equal(report.results[1]!.stdoutText, outputA);
  assert.equal(report.results[2]!.stdoutText, outputB);
  assert.equal(report.results[2]!.stderrText, "f".repeat(900));
  assert.equal(report.results[2]!.stdoutByteLength, Buffer.byteLength(outputB));
  const feedback = observations[1]!.attempt!.checkFeedback as { outcome: string; checks: { id: string; stdoutText: string }[] };
  assert.equal(feedback.outcome, "not-accepted");
  assert.equal(feedback.checks.length, 1); assert.equal(feedback.checks[0]!.id, VISIBLE_ID);
  assert.equal(feedback.checks[0]!.stdoutText, "VISIBLE_PASS_OUTPUT");
  const disclosure = JSON.stringify({ observations, prompts });
  for (const secret of [secretA, secretB, "private_long_first", "private_long_final", first.artifact.id]) assert.ok(!disclosure.includes(secret));
}));

for (const property of ["verification", "acceptanceCriteria"] as const) {
  test(`Native plan input refuses ${property} getters before evaluating them or allocating a worker`, async () => fixture(async (f) => {
    let reads = 0; let factories = 0; let workers = 0;
    const factory: NativeWriteExecutorFactory = (context) => {
      factories++;
      return { async *execute(request, signal) {
        workers++;
        await context.tools.find((tool) => tool.name === "sparkle_write_file")!.execute("unexpected-worker", {
          path: "value.txt", contents: AFTER
        }, signal);
        yield* new ProtocolChildExecutor().execute(request, signal);
      } };
    };
    const prepared = preparedInput(f, [recipe(VISIBLE_ID, "process.exit(0)")], factory);
    const input = Object.defineProperty({ ...prepared }, property, { enumerable: true, get() {
      reads++;
      // Returning undefined for criteria would evade validation after an unsafe
      // spread. The verifier getter returns the otherwise valid host capability.
      return property === "verification" ? prepared.verification : undefined;
    } });
    const session = new NativeWriteSession({ stateRoot: f.stateRoot, sandboxRoot: f.sandboxRoot, executorFactory: factory });
    try {
      const outcome = await session.execute(input).then((result) => ({ result }), (error: unknown) => ({ error }));
      assert.equal(reads, 0, "Native must inspect own property descriptors before spreading plan-selected authority");
      assert.equal(factories, 0, "invalid input must not allocate an executor factory");
      assert.equal(workers, 0, "invalid input must not issue an actual execution request");
      assert.equal(session.activeCount, 0);
      assert.deepEqual(await readdir(f.sandboxRoot), [], "invalid authority must not allocate a candidate worktree");
      assert.ok("error" in outcome, "accessor-backed authority must be refused");
      assert.ok(outcome.error instanceof Error);
    } finally { await session.shutdown(); }
  }));
}

test("check-plan recipe protection cannot be dropped by a broader writable scope configuration", async () => fixture(async (f) => {
  const changedGuard = "candidate rewrote the decisive checker input";
  const passMarker = "GUARD_DEPENDENT_HOST_CHECK_PASSED_42bd";
  const scopePolicy = { allowedScope: ["value.txt", "checks"], protectedPaths: [] as string[] };
  const checks = [recipe("guard_dependent", `if(require('node:fs').readFileSync('checks/guard.txt','utf8')!==${JSON.stringify(changedGuard)})process.exit(1); process.stdout.write(${JSON.stringify(passMarker)});`)];
  let factories = 0;
  const factory: NativeWriteExecutorFactory = (context) => {
    factories++;
    return { async *execute(request, signal) {
      await context.tools.find((tool) => tool.name === "sparkle_write_file")!.execute("rewrite-declared-protected-input", {
        path: "checks/guard.txt", contents: changedGuard
      }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    } };
  };
  const outcome = await Promise.resolve().then(() => {
    const input = { sourceRepo: f.sourceRepo, stateRoot: f.stateRoot, sandboxRoot: f.sandboxRoot,
      objective: "Do not permit the writable scope to erase a recipe's decisive protected input", scopePolicy,
      ...prepareDevelopmentCheckPlan({ scopePolicy, checks }), executorFactory: factory };
    return startDevelopmentTask(input);
  }).then((result) => ({ result }), (error: unknown) => ({ error }));
  if ("result" in outcome && outcome.result.acceptance.accepted) {
    assert.equal(await readFile(path.join(outcome.result.candidatePath, "checks", "guard.txt"), "utf8"), changedGuard,
      "the existing owned tool must actually rewrite the recipe-declared protected bytes");
    const check = outcome.result.acceptance.independentCheck;
    assert.ok(check);
    assert.equal(check.processStatus, "completed");
    assert.equal(check.exitCode, 0, "the real Node checker must accept only after its protected input was rewritten");
    assert.ok(check.stdoutText.includes(passMarker));
    assert.equal(outcome.result.acceptance.accepted, true, "the regression premise must expose the actual incorrectly accepted candidate");
  } else if ("error" in outcome) assert.ok(outcome.error instanceof Error);
  assert.equal(factories, 0, "recipe-declared protection and writable scope contradictions must refuse before factory allocation");
}));
