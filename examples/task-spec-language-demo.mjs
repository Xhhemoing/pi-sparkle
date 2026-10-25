#!/usr/bin/env node
// Explicit offline host demonstration. Only freshly created synthetic sources are applied.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn, spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, open, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { LANGUAGES, languageFixture, configureTypeScriptExample } from "./task-spec-language-fixtures.mjs";
import { DEMO_MODEL, DEMO_PROVIDER, startTaskSpecLoopbackProvider } from "./task-spec-loopback-provider.mjs";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const CLI = fileURLToPath(new URL("../dist/cli/main.js", import.meta.url));
const USAGE = `Offline installed-package TaskSpec language demo

node examples/task-spec-language-demo.mjs --root <private-parent>
  [--mode scripted|cli]
  [--language all|node-express|python-fastapi|rust-cli|go-service]
  [--python <external-python>] [--node-deps <external-express-typescript-prefix>]

Every selected language gets a new mkdtemp Git fixture. The runner executes this
package's dist init/preflight. Default scripted mode uses an owned scripted write
and separate internal application. Explicit --mode cli runs the public task run
with the real configured Pi SDK and a synthetic local HTTP/SSE provider, observes
accepted source/candidate bytes, then sends apply to that same CLI process's stdin.
Node uses actual YAML input; the other languages use JSON. All evidence remains.
Dependencies must already be installed outside the fixture. No installation, paid
provider, external model endpoint or original-project apply is performed. Synthetic
reference prices/usage are not provider bills or live-effectiveness evidence.
Rust CLI mode selects the existing rustup cargo executable locally before init;
no toolchain is installed and the Pi process keeps its isolated private home.
`;

async function directory(value) {
  const absolute = path.resolve(value);
  let cursor = path.parse(absolute).root;
  for (const part of [null, ...absolute.slice(cursor.length).split(path.sep).filter(Boolean)]) {
    if (part !== null) cursor = path.join(cursor, part);
    let info;
    try { info = await lstat(cursor); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      await mkdir(cursor);
      info = await lstat(cursor);
    }
    assert.ok(info.isDirectory() && !info.isSymbolicLink(), `private output parent must be nonlinked: ${cursor}`);
  }
  return absolute;
}
async function save(file, value) {
  const handle = await open(file, "wx", 0o600);
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8"); await handle.sync(); }
  finally { await handle.close(); }
}
function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true, timeout: 10000 });
  if (result.error || result.status !== 0) {
    const error = new Error(`fixture Git failed (${args.join(" ")}): ${result.error?.message ?? result.stderr}`);
    if (result.error?.code === "ETIMEDOUT") error.effectsSettled = false;
    throw error;
  }
  return result.stdout.trim();
}
async function originals(sourceRepo, files) {
  return new Map(await Promise.all(files.map(async (file) => [file, await readFile(path.join(sourceRepo, file))])));
}
async function sameBytes(repository, expected, except) {
  for (const [file, bytes] of expected) if (file !== except) {
    assert.deepEqual(await readFile(path.join(repository, file)), bytes, `protected/original bytes changed: ${file}`);
  }
}
async function unchangedSource(repository, revision, expected) {
  assert.equal(git(repository, ["rev-parse", "HEAD"]), revision);
  assert.equal(git(repository, ["status", "--porcelain=v1", "--untracked-files=all", "--ignored"]), "");
  await sameBytes(repository, expected);
}

async function runtime(mode) {
  if (mode === "cli") return { ...(await import("../dist/development/task-spec.js")),
    ...(await import("../dist/execution/command-runner.js")), cliMode: true };
  const [spec, start, plan, trusted, apply, executor, command, check] = await Promise.all([
    import("../dist/development/task-spec.js"), import("../dist/development/start-task-spec.js"),
    import("../dist/development/check-plan.js"), import("../dist/execution/trusted-verification.js"),
    import("../dist/native/apply.js"), import("../dist/testing/fake-executor.js"),
    import("../dist/execution/command-runner.js"), import("../dist/execution/independent-check.js")
  ]);
  return { ...spec, ...start, ...plan, ...trusted, ...apply, ...executor, ...command, ...check };
}
async function cliEnvironment(projectRoot) {
  const home = await directory(path.join(projectRoot, "cli-home")), temp = await directory(path.join(projectRoot, "cli-temp"));
  const env = Object.fromEntries(["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "ComSpec", "PATHEXT"].flatMap(key =>
    process.env[key] === undefined ? [] : [[key, process.env[key]]]));
  return { ...env, HOME: home, USERPROFILE: home, TEMP: temp, TMP: temp, TMPDIR: temp,
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: path.join(home, "unused-gitconfig") };
}
async function selectedRustCargo(projectRoot) {
  // Resolve the installed compiler only. Never give Pi the user's real home or
  // credentials; a rustup shim would otherwise read the empty private profile.
  const env = Object.fromEntries(["PATH", "Path", "SystemRoot", "WINDIR", "HOME", "USERPROFILE", "RUSTUP_HOME", "CARGO_HOME", "RUSTUP_TOOLCHAIN"].flatMap(key =>
    process.env[key] === undefined ? [] : [[key, process.env[key]]]));
  env.RUSTUP_AUTO_INSTALL = "0";
  const resolved = spawnSync("rustup", ["which", "cargo"], { cwd: projectRoot, env, encoding: "utf8", windowsHide: true, timeout: 10000 });
  assert.equal(resolved.error, undefined); assert.equal(resolved.status, 0, "select an installed rustup toolchain before the Rust CLI example; no installation is attempted");
  const executable = resolved.stdout.trim(); assert.ok(path.isAbsolute(executable), "rustup must select an absolute installed cargo executable");
  const info = await lstat(executable); assert.ok(info.isFile() && !info.isSymbolicLink(), "selected cargo must be a regular installed executable");
  return { executable, directory: path.dirname(executable), selection: "rustup which cargo; existing installation only" };
}
async function languageCliEnvironment(api, projectRoot) {
  const env = await cliEnvironment(projectRoot);
  if (api.cliCompilerDirectory !== undefined) env.PATH = [api.cliCompilerDirectory, env.PATH ?? env.Path ?? ""].filter(Boolean).join(path.delimiter);
  return env;
}
async function cli(api, projectRoot, label, args, signal) {
  const temp = await directory(path.join(projectRoot, "cli-temp"));
  const env = Object.fromEntries(["PATH", "SystemRoot", "WINDIR"].flatMap((key) =>
    process.env[key] === undefined ? [] : [[key, process.env[key]]]));
  Object.assign(env, { TEMP: temp, TMP: temp, TMPDIR: temp });
  if (api.cliMode) Object.assign(env, await languageCliEnvironment(api, projectRoot));
  // The CLI's internal TaskSpec deadline is 600 seconds. Its outer runner gets
  // extra settlement time; an outer timeout is retained as uncertain cleanup.
  const result = await api.runAuthorizedCommand({ executable: process.execPath, args: [CLI, ...args], cwd: PACKAGE_ROOT,
    env, timeoutMs: 660000, maxStdoutBytes: 256 * 1024, maxStderrBytes: 256 * 1024, signal });
  let report;
  try { report = JSON.parse(result.stdoutText); } catch { /* Preserve non-JSON diagnostics below. */ }
  await save(path.join(projectRoot, `${label}-command.json`), { executable: process.execPath, args: [CLI, ...args], ...result, report });
  const innerUnsettled = ["preflight", "current-source-check"].includes(label) && (report?.type !== "TASKSPEC_PREFLIGHT" || report.effectsSettled !== true);
  if (result.cleanupUnsettled || innerUnsettled || result.status !== "completed" || !result.ok || result.exitCode !== 0) {
    const error = new Error(`${label} failed; inspect ${path.join(projectRoot, `${label}-command.json`)}`);
    if (result.cleanupUnsettled || innerUnsettled) error.effectsSettled = false;
    else if (report?.type === "TASKSPEC_PREFLIGHT") error.effectsSettled = report.effectsSettled;
    if (report?.type === "TASKSPEC_PREFLIGHT") { error.preflightReport = report; error.preflightStage = label; }
    throw error;
  }
  assert.ok(report && typeof report === "object", `${label} did not return JSON`);
  return report;
}

async function cliReferenceCost(stateRoot, execution) {
  const artifactRoot = path.join(stateRoot, "runtime/runs", execution.runId, "loop-artifacts");
  const artifacts = await Promise.all((await readdir(artifactRoot)).filter(file => file.endsWith(".json")).map(async file => JSON.parse(await readFile(path.join(artifactRoot, file), "utf8"))));
  const loops = artifacts.filter(item => item.body?.kind === "native-write-loop");
  const terminal = loops.filter(item => !loops.some(later => later.body.supersedesArtifactId === item.id));
  assert.equal(terminal.length, 1, "logical-task cost requires one unsuperseded loop result");
  return terminal[0].body.referenceCost ?? null;
}

async function runCliCandidate(api, input, observation, signal) {
  const { projectRoot, sourceRepo, stateRoot, sourceRevision, expected, fixture, taskFile } = input;
  const provider = await startTaskSpecLoopbackProvider(fixture);
  let execution, application, sentApply = false, unknown = false, failure;
  const out = [], err = [], records = [];
  try {
    await directory(path.join(stateRoot, "runtime"));
    await save(path.join(stateRoot, "runtime/providers.json"), { version: 1, enabled: [`${DEMO_PROVIDER}/${DEMO_MODEL}`],
      primary: `${DEMO_PROVIDER}/${DEMO_MODEL}`, fast: `${DEMO_PROVIDER}/${DEMO_MODEL}`,
      customProviders: [{ id: DEMO_PROVIDER, baseUrl: provider.baseUrl,
        models: [{ id: DEMO_MODEL, contextWindow: 8192, maxTokens: 2048, inputCostPerMTok: 1, outputCostPerMTok: 2 }] }] });
    observation.stage = "public-cli-task-run";
    const args = [CLI, "task", "run", taskFile, "--project", sourceRepo, "--state-root", stateRoot, "--executor", "pi", "--json", "--review"];
    const child = spawn(process.execPath, args, { cwd: PACKAGE_ROOT,
      env: { ...await languageCliEnvironment(api, projectRoot), PI_API_KEY: "synthetic-loopback-only" }, windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"] });
    let tail = "", bytes = 0, handling = Promise.resolve();
    child.stdin.on("error", error => { if (error.code !== "EPIPE") failure ??= error; });
    const observe = async line => {
      const record = JSON.parse(line); records.push(record);
      if (record.type === "TASKSPEC_APPLICATION") { application = record; return; }
      if (record.type !== "TASKSPEC_EXECUTION") return;
      assert.equal(execution, undefined, "multiple execution projections"); execution = record;
      observation.execution = record; observation.effectsSettled = record.effectsSettled === true;
      assert.equal(record.accepted, true); assert.equal(record.effectsSettled, true); assert.equal(record.managed, true);
      assert.equal(record.sourceRevision, sourceRevision);
      await unchangedSource(sourceRepo, sourceRevision, expected);
      await sameBytes(record.candidatePath, expected, fixture.sourceFile);
      assert.equal(await readFile(path.join(record.candidatePath, fixture.sourceFile), "utf8"), fixture.after);
      assert.equal(git(record.candidatePath, ["diff", "--name-only", sourceRevision]), fixture.sourceFile);
      assert.equal(git(record.candidatePath, ["status", "--porcelain=v1", "--untracked-files=all", "--ignored"]), `M ${fixture.sourceFile}`);
      // This observation is persisted before stdin authorizes the public CLI.
      await save(path.join(projectRoot, "accepted-before-apply.json"), { runId: record.runId, sourceRevision,
        sourceHeadObserved: git(sourceRepo, ["rev-parse", "HEAD"]), sourceUnchanged: true, protectedBytesUnchanged: true,
        candidateChangedFiles: [fixture.sourceFile], artifactPath: record.artifactPath });
      signal.throwIfAborted();
      observation.stage = "public-cli-user-apply";
      sentApply = true; child.stdin.end("apply\n");
    };
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", text => {
      out.push(text); bytes += Buffer.byteLength(text); tail += text;
      if (bytes > 256 * 1024) { unknown = true; child.kill(); return; }
      for (;;) {
        const end = tail.indexOf("\n"); if (end < 0) break;
        const line = tail.slice(0, end); tail = tail.slice(end + 1);
        if (line.trim()) handling = handling.then(() => observe(line)).catch(error => { failure ??= error; child.stdin.end("retain\n"); });
      }
    });
    child.stderr.on("data", text => { err.push(text); bytes += Buffer.byteLength(text); if (bytes > 512 * 1024) { unknown = true; child.kill(); } });
    const interrupt = () => {
      // Windows kill() can terminate without finally. Never call that settled.
      if (process.platform !== "win32") child.kill("SIGINT");
      child.stdin.end("retain\n");
    };
    signal.addEventListener("abort", interrupt, { once: true }); if (signal.aborted) interrupt();
    const deadline = setTimeout(() => { unknown = true; child.kill(); }, 660000);
    let exit;
    try { exit = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code, killedBy) => resolve({ code, signal: killedBy })); }); }
    finally { clearTimeout(deadline); signal.removeEventListener("abort", interrupt); }
    await handling;
    await save(path.join(projectRoot, "task-run-command.json"), { executable: process.execPath, args, ...exit, records,
      stdoutText: out.join(""), stderrText: err.join(""), applySent: sentApply, outerTerminationUnknown: unknown });
    observation.application = application;
    if (unknown || (sentApply && application?.status !== "APPLIED") || execution?.effectsSettled !== true) observation.effectsSettled = false;
    if (failure) throw failure;
    assert.equal(exit.code, 0, "public task run failed; inspect task-run-command.json"); assert.equal(unknown, false);
    assert.equal(application?.status, "APPLIED"); assert.equal(application?.reverified, true);
    assert.equal(provider.requests.length, 2); assert.deepEqual(provider.protocolErrors, []);
    observation.acceptObservedBeforeUserApply = true;
    observation.appliedRevision = application.appliedRevision;
    observation.referenceCost = await cliReferenceCost(stateRoot, execution);
    assert.equal(observation.referenceCost?.coverage, "complete"); assert.equal(observation.referenceCost?.settled, true);
    assert.ok(Math.abs(observation.referenceCost.knownReferenceUsd - 0.000042) <= Number.EPSILON);
    await unchangedSource(sourceRepo, application.appliedRevision, new Map([...expected].filter(([file]) => file !== fixture.sourceFile)));
    assert.equal(await readFile(path.join(sourceRepo, fixture.sourceFile), "utf8"), fixture.after);
    observation.stage = "current-source-public-preflight";
    observation.currentSourceCheck = await cli(api, projectRoot, "current-source-check", ["preflight", taskFile,
      "--project", sourceRepo, "--state-root", stateRoot, "--json"], signal);
    assert.equal(observation.currentSourceCheck.ok, true); assert.equal(observation.currentSourceCheck.effectsSettled, true);
    assert.equal(observation.currentSourceCheck.candidateDisposition, "removed");
    await unchangedSource(sourceRepo, application.appliedRevision, new Map([...expected].filter(([file]) => file !== fixture.sourceFile)));
    assert.equal(await readFile(path.join(sourceRepo, fixture.sourceFile), "utf8"), fixture.after);
    observation.fixtureOnlySourceApplication = true;
  } finally {
    observation.modelInvocations = provider.requests.length;
    observation.syntheticReferencePricing = true; observation.costUsd = null;
    if (execution !== undefined && observation.referenceCost === null) {
      try { observation.referenceCost = await cliReferenceCost(stateRoot, execution); }
      catch { observation.referenceCostUnavailable = true; }
    }
    try { await save(path.join(projectRoot, "loopback-observation.json"), { baseUrl: provider.baseUrl, requests: provider.requests, protocolErrors: provider.protocolErrors }); }
    finally { await provider.close(); }
  }
}

async function runLanguage(api, runRoot, language, options, signal) {
  const projectRoot = await mkdtemp(path.join(runRoot, `${language}-`));
  const sourceRepo = await directory(path.join(projectRoot, "source"));
  const stateRoot = path.join(projectRoot, "state");
  const sandboxRoot = await directory(path.join(projectRoot, "candidates"));
  const hooks = await directory(path.join(projectRoot, "empty-hooks"));
  const started = performance.now();
  const observation = { language, mode: options.mode, projectRoot, sourceRepo, stateRoot, status: "failed", stage: "fixture",
    workerCalls: 0, modelInvocations: 0, costUsd: null, referenceCost: null, supportsLiveEffectivenessClaim: false };
  try {
    let packageAnchor;
    if (language === "node-express") {
      if (!options["node-deps"]) throw new Error("node-express requires --node-deps with preinstalled Express, TypeScript, @types/node and @types/express");
      packageAnchor = path.join(path.resolve(options["node-deps"]), "package.json");
      const anchor = await lstat(packageAnchor);
      assert.ok(anchor.isFile() && !anchor.isSymbolicLink(), "external Express package.json anchor must be a regular file");
    }
    const fixture = languageFixture(language, { packageAnchor });
    for (const [file, contents] of Object.entries(fixture.files)) {
      await directory(path.dirname(path.join(sourceRepo, file)));
      await writeFile(path.join(sourceRepo, file), contents, { encoding: "utf8", flag: "wx" });
    }
    git(sourceRepo, ["init", "-b", "main"]);
    git(sourceRepo, ["config", "user.name", "Explicit synthetic TaskSpec demo"]);
    git(sourceRepo, ["config", "user.email", "fixture@example.invalid"]);
    git(sourceRepo, ["config", "core.autocrlf", "false"]);
    git(sourceRepo, ["config", "core.hooksPath", hooks]);
    if (options.mode === "cli" && language === "rust-cli") {
      observation.rustToolchain = await selectedRustCargo(projectRoot);
      api.cliCompilerDirectory = observation.rustToolchain.directory;
    }
    observation.stage = "init";
    const args = ["init", "--task", "--dir", sourceRepo, "--json"];
    if (language === "rust-cli" || language === "go-service") args.push("--state-root", stateRoot);
    if (language === "python-fastapi" && options.python) args.push("--python", path.resolve(options.python));
    observation.init = await cli(api, projectRoot, "init", args, signal);
    let taskFile = path.join(sourceRepo, "sparkle.task.json");
    let draft = JSON.parse(await readFile(taskFile, "utf8"));
    draft.objective = fixture.objective; // Explicit host review of this generated synthetic draft.
    if (language === "node-express") {
      draft = configureTypeScriptExample(draft);
      draft.budget.checkTotalSeconds = 80;
      const additions = ["runtime-config.json", ...(options.mode === "cli" ? ["sparkle.task.yaml"] : [])];
      draft.write.protect = [...new Set([...draft.write.protect, ...additions])];
      draft.checks = draft.checks.map((check) => ({ ...check,
        protectedPaths: [...new Set([...(check.protectedPaths ?? []), ...additions])] }));
    }
    if (options.mode === "cli") draft.budget.usd = 0.01; // Explicit synthetic reference allowance, never a provider bill cap.
    const spec = api.parseDevelopmentTaskSpec(JSON.stringify(draft));
    await writeFile(taskFile, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
    if (options.mode === "cli" && language === "node-express") {
      const { stringify } = await import("yaml");
      taskFile = path.join(sourceRepo, "sparkle.task.yaml");
      await writeFile(taskFile, `# Explicitly reviewed synthetic Node CLI task\n${stringify(spec)}`, { encoding: "utf8", flag: "wx" });
    }
    git(sourceRepo, ["add", "."]);
    git(sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "Healthy synthetic task and protected checks"]);
    const sourceRevision = git(sourceRepo, ["rev-parse", "HEAD"]);
    const expected = await originals(sourceRepo, [...Object.keys(fixture.files), "sparkle.task.json",
      ...(options.mode === "cli" && language === "node-express" ? ["sparkle.task.yaml"] : [])]);
    observation.sourceRevision = sourceRevision;
    if (options.mode === "cli") {
      observation.taskInputFormat = language === "node-express" ? "yaml" : "json";
      observation.stage = "standalone-preflight";
      observation.standalonePreflight = await cli(api, projectRoot, "preflight", ["preflight", taskFile,
        "--project", sourceRepo, "--state-root", stateRoot, "--json"], signal);
      assert.equal(observation.standalonePreflight.ok, true); assert.equal(observation.standalonePreflight.effectsSettled, true);
      assert.equal(observation.standalonePreflight.candidateDisposition, "removed");
      await unchangedSource(sourceRepo, sourceRevision, expected);
      await runCliCandidate(api, { projectRoot, sourceRepo, stateRoot, sourceRevision, expected, fixture, taskFile }, observation, signal);
    } else {
    const selected = api.prepareDevelopmentCheckPlan({ scopePolicy: { allowedScope: spec.write.allow, protectedPaths: spec.write.protect },
      checks: spec.checks.map((check) => { const recipe = { ...check }; delete recipe.expect; return recipe; }) });
    const issued = selected.verification.trustedVerification;
    // Same process, same fixed command/argv/checker files, independently issued
    // whole-candidate capability. The scoped write descriptor cannot authorize apply.
    const whole = api.prepareTrustedVerification({ command: selected.verification.command, args: selected.verification.args,
      checkerFiles: issued.checkerFiles, snapshotManifest: {}, maxSnapshotFiles: issued.maxSnapshotFiles, maxSnapshotBytes: issued.maxSnapshotBytes });
    observation.stage = "standalone-preflight";
    observation.standalonePreflight = await cli(api, projectRoot, "preflight", ["preflight", taskFile,
      "--project", sourceRepo, "--state-root", stateRoot, "--json"], signal);
    assert.equal(observation.standalonePreflight.ok, true);
    assert.equal(observation.standalonePreflight.effectsSettled, true);
    assert.equal(observation.standalonePreflight.candidateDisposition, "removed");
    await unchangedSource(sourceRepo, sourceRevision, expected);
    observation.stage = "owned-write-and-accept";
    const result = await api.startDevelopmentTaskSpec({ sourceRepo, stateRoot, sandboxRoot, spec, signal,
      executorFactory: (context) => ({ async *execute(request, workerSignal) {
        observation.workerCalls++;
        assert.equal(request.workingDirectory, context.candidatePath);
        await unchangedSource(sourceRepo, sourceRevision, expected);
        assert.equal(await readFile(path.join(context.candidatePath, fixture.sourceFile), "utf8"), fixture.before);
        await context.tools.find((tool) => tool.name === "sparkle_write_file").execute("semantics-preserving-edit", {
          path: fixture.sourceFile, contents: fixture.after
        }, workerSignal);
        yield* new api.ProtocolChildExecutor().execute(request, workerSignal);
      } }) });
    await save(path.join(projectRoot, "execution.json"), result);
    const execution = result.execution;
    observation.execution = { status: execution.status, accepted: execution.acceptance.accepted, reason: execution.reason,
      runId: execution.runId, artifact: execution.artifact, candidatePath: execution.candidatePath,
      preflightArtifact: result.preflight?.artifactPath };
    observation.effectsSettled = execution.effectsSettled !== false;
    assert.equal(result.preflight?.ok, true);
    assert.equal(execution.acceptance.accepted, true, execution.reason);
    assert.notEqual(execution.effectsSettled, false);
    assert.equal(observation.workerCalls, 1);
    assert.equal(execution.sourceRevision, sourceRevision);
    assert.equal(execution.acceptance.command, whole.command);
    assert.deepEqual(execution.acceptance.args, whole.args);
    await unchangedSource(sourceRepo, sourceRevision, expected);
    await sameBytes(execution.candidatePath, expected, fixture.sourceFile);
    assert.equal(await readFile(path.join(execution.candidatePath, fixture.sourceFile), "utf8"), fixture.after);
    assert.equal(git(execution.candidatePath, ["diff", "--name-only", sourceRevision]), fixture.sourceFile);
    observation.stage = "explicit-fixture-only-apply";
    const apply = new api.NativeApplySession();
    let prepared = false;
    try {
      observation.application = await apply.apply({ sourceRepo, result: execution, trustedVerification: whole, signal,
        onPrepared: async (target) => {
          await unchangedSource(sourceRepo, sourceRevision, expected);
          await save(path.join(projectRoot, "apply-prepared.json"), { ...target, sourceStillAt: sourceRevision });
          prepared = true;
        } });
    } catch (error) {
      observation.applicationOutcome = "unknown-requires-host-inspection";
      observation.effectsSettled = false;
      throw error;
    } finally { await apply.shutdown(); }
    assert.equal(prepared, true);
    assert.equal(observation.application.status, "APPLIED");
    assert.equal(observation.application.reverified, true);
    assert.equal(git(sourceRepo, ["rev-parse", "HEAD"]), observation.application.appliedRevision);
    await sameBytes(sourceRepo, expected, fixture.sourceFile);
    assert.equal(await readFile(path.join(sourceRepo, fixture.sourceFile), "utf8"), fixture.after);
    observation.stage = "current-source-check";
    const current = await api.runIndependentCheck({ cwd: sourceRepo, command: whole.command, args: whole.args,
      trustedVerification: whole, timeoutMs: Math.round(spec.budget.checkSeconds * 1000), storedStreamMaxBytes: 256 * 1024,
      unsettledExitCodes: selected.verification.unsettledExitCodes, requireSettledEffects: true, signal });
    await save(path.join(projectRoot, "current-source-check.json"), current);
    assert.equal(current.ok, true);
    assert.equal(git(sourceRepo, ["rev-parse", "HEAD"]), observation.application.appliedRevision);
    assert.equal(git(sourceRepo, ["status", "--porcelain=v1", "--untracked-files=all", "--ignored"]), "");
    await sameBytes(sourceRepo, expected, fixture.sourceFile);
    assert.equal(await readFile(path.join(sourceRepo, fixture.sourceFile), "utf8"), fixture.after);
    observation.currentSourceCheck = { checkId: current.checkId, ok: current.ok, exitCode: current.exitCode };
    observation.appliedRevision = observation.application.appliedRevision;
    observation.preparedTargetPersistedBeforeMutation = prepared;
    observation.fixtureOnlySourceApplication = true;
    }
    observation.stage = "complete";
    observation.status = "passed";
  } catch (error) {
    observation.error = error instanceof Error ? error.message : String(error);
    if (error?.effectsSettled === true) observation.effectsSettled = true;
    if (error?.effectsSettled === false || error instanceof api.CommandCleanupIncompleteError) observation.effectsSettled = false;
    if (error?.preflightReport) observation[error.preflightStage === "preflight" ? "standalonePreflight" : "currentSourceCheck"] = error.preflightReport;
    if (error instanceof api.CommandCleanupIncompleteError) observation.unsettledCommand = error.result;
  }
  observation.durationMs = performance.now() - started;
  await save(path.join(projectRoot, "result.json"), observation);
  return observation;
}

async function main() {
  const { values, tokens } = parseArgs({ strict: true, allowPositionals: false, tokens: true, options: {
    language: { type: "string", default: "all" }, mode: { type: "string", default: "scripted" }, root: { type: "string" }, python: { type: "string" },
    "node-deps": { type: "string" }, help: { type: "boolean", short: "h" }
  } });
  const seen = new Set();
  for (const token of tokens) if (token.kind === "option") {
    if (seen.has(token.name)) throw new Error(`Repeated option --${token.name}`);
    seen.add(token.name);
  }
  if (values.help) { console.log(USAGE); return; }
  assert.ok(["scripted", "cli"].includes(values.mode), "unsupported --mode");
  if (!values.root?.trim()) throw new Error("--root must select a private output parent");
  const languages = values.language === "all" ? LANGUAGES : [values.language];
  assert.ok(languages.every((language) => LANGUAGES.includes(language)), "unsupported --language");
  const runRoot = await mkdtemp(path.join(await directory(values.root), "task-spec-languages-"));
  console.error(`Retained synthetic demo evidence: ${runRoot}`);
  const api = await runtime(values.mode);
  const pkg = JSON.parse(await readFile(path.join(PACKAGE_ROOT, "package.json"), "utf8"));
  const controller = new globalThis.AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  const results = [];
  try {
    for (const language of languages) {
      if (controller.signal.aborted || results.some((result) => result.effectsSettled === false)) {
        results.push({ language, status: "not-run", reason: "prior cancellation or unresolved command cleanup",
          modelInvocations: 0, costUsd: null, supportsLiveEffectivenessClaim: false });
        continue;
      }
      console.error(`Running synthetic ${language}`);
      results.push(await runLanguage({ ...api }, runRoot, language, values, controller.signal));
      console.error(`${language}: ${results.at(-1).status}`);
    }
  } finally { process.removeListener("SIGINT", abort); }
  const summary = { mode: values.mode === "cli" ? "offline-configured-cli-loopback" : "offline-scripted-owned-write",
    packageRoot: PACKAGE_ROOT, packageVersion: pkg.version, runRoot,
    modelInvocations: results.reduce((total, result) => total + result.modelInvocations, 0), costUsd: null,
    syntheticReferencePricing: values.mode === "cli", supportsLiveEffectivenessClaim: false, results };
  await save(path.join(runRoot, "summary.json"), summary);
  console.log(JSON.stringify(summary, null, 2));
  if (results.some((result) => result.status !== "passed")) process.exitCode = 1;
}
main().catch((error) => { console.error(error.stack ?? String(error)); process.exitCode = 1; });
