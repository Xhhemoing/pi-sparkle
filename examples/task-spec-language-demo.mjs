#!/usr/bin/env node
// Explicit offline host demonstration. Only freshly created synthetic sources are applied.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { LANGUAGES, languageFixture } from "./task-spec-language-fixtures.mjs";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const CLI = fileURLToPath(new URL("../dist/cli/main.js", import.meta.url));
const USAGE = `Offline installed-package TaskSpec language demo

node examples/task-spec-language-demo.mjs --root <private-parent>
  [--language all|node-express|python-fastapi|rust-cli|go-service]
  [--python <external-python>] [--node-deps <external-express-prefix>]

Every selected language gets a new mkdtemp Git fixture. The runner executes this
package's dist init/preflight, uses a scripted owned write, then separately applies
only that synthetic candidate. All evidence/candidates remain under --root.
Dependencies must already be installed outside the fixture. No model, installation,
public service, original-project apply or live-effectiveness claim is involved.
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

async function runtime() {
  const [spec, start, plan, trusted, apply, executor, command, check] = await Promise.all([
    import("../dist/development/task-spec.js"), import("../dist/development/start-task-spec.js"),
    import("../dist/development/check-plan.js"), import("../dist/execution/trusted-verification.js"),
    import("../dist/native/apply.js"), import("../dist/testing/fake-executor.js"),
    import("../dist/execution/command-runner.js"), import("../dist/execution/independent-check.js")
  ]);
  return { ...spec, ...start, ...plan, ...trusted, ...apply, ...executor, ...command, ...check };
}
async function cli(api, projectRoot, label, args, signal) {
  const temp = await directory(path.join(projectRoot, "cli-temp"));
  const env = Object.fromEntries(["PATH", "SystemRoot", "WINDIR"].flatMap((key) =>
    process.env[key] === undefined ? [] : [[key, process.env[key]]]));
  Object.assign(env, { TEMP: temp, TMP: temp, TMPDIR: temp });
  // The CLI's internal TaskSpec deadline is 600 seconds. Its outer runner gets
  // extra settlement time; an outer timeout is retained as uncertain cleanup.
  const result = await api.runAuthorizedCommand({ executable: process.execPath, args: [CLI, ...args], cwd: PACKAGE_ROOT,
    env, timeoutMs: 660000, maxStdoutBytes: 256 * 1024, maxStderrBytes: 256 * 1024, signal });
  let report;
  try { report = JSON.parse(result.stdoutText); } catch { /* Preserve non-JSON diagnostics below. */ }
  await save(path.join(projectRoot, `${label}-command.json`), { executable: process.execPath, args: [CLI, ...args], ...result, report });
  const innerUnsettled = label === "preflight" && (report?.type !== "TASKSPEC_PREFLIGHT" || report.effectsSettled !== true);
  if (result.cleanupUnsettled || innerUnsettled || result.status !== "completed" || !result.ok || result.exitCode !== 0) {
    const error = new Error(`${label} failed; inspect ${path.join(projectRoot, `${label}-command.json`)}`);
    if (result.cleanupUnsettled || innerUnsettled) error.effectsSettled = false;
    throw error;
  }
  assert.ok(report && typeof report === "object", `${label} did not return JSON`);
  return report;
}

async function runLanguage(api, runRoot, language, options, signal) {
  const projectRoot = await mkdtemp(path.join(runRoot, `${language}-`));
  const sourceRepo = await directory(path.join(projectRoot, "source"));
  const stateRoot = path.join(projectRoot, "state");
  const sandboxRoot = await directory(path.join(projectRoot, "candidates"));
  const hooks = await directory(path.join(projectRoot, "empty-hooks"));
  const started = performance.now();
  const observation = { language, projectRoot, sourceRepo, stateRoot, status: "failed", stage: "fixture",
    workerCalls: 0, modelInvocations: 0, costUsd: null, supportsLiveEffectivenessClaim: false };
  try {
    let packageAnchor;
    if (language === "node-express") {
      if (!options["node-deps"]) throw new Error("node-express requires --node-deps with preinstalled Express");
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
    observation.stage = "init";
    const args = ["init", "--task", "--dir", sourceRepo, "--json"];
    if (language === "rust-cli" || language === "go-service") args.push("--state-root", stateRoot);
    if (language === "python-fastapi" && options.python) args.push("--python", path.resolve(options.python));
    observation.init = await cli(api, projectRoot, "init", args, signal);
    const taskFile = path.join(sourceRepo, "sparkle.task.json");
    const draft = JSON.parse(await readFile(taskFile, "utf8"));
    draft.objective = fixture.objective; // Explicit host review of this generated synthetic draft.
    if (language === "node-express") {
      draft.write.protect = [...new Set([...draft.write.protect, "runtime-config.json"])];
      draft.checks = draft.checks.map((check) => ({ ...check,
        protectedPaths: [...new Set([...(check.protectedPaths ?? []), "runtime-config.json"])] }));
    }
    const spec = api.parseDevelopmentTaskSpec(JSON.stringify(draft));
    await writeFile(taskFile, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
    git(sourceRepo, ["add", "."]);
    git(sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "Healthy synthetic task and protected checks"]);
    const sourceRevision = git(sourceRepo, ["rev-parse", "HEAD"]);
    const expected = await originals(sourceRepo, [...Object.keys(fixture.files), "sparkle.task.json"]);
    observation.sourceRevision = sourceRevision;
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
    observation.stage = "complete";
    observation.status = "passed";
  } catch (error) {
    observation.error = error instanceof Error ? error.message : String(error);
    if (error?.effectsSettled === false || error instanceof api.CommandCleanupIncompleteError) observation.effectsSettled = false;
    if (error instanceof api.CommandCleanupIncompleteError) observation.unsettledCommand = error.result;
  }
  observation.durationMs = performance.now() - started;
  await save(path.join(projectRoot, "result.json"), observation);
  return observation;
}

async function main() {
  const { values, tokens } = parseArgs({ strict: true, allowPositionals: false, tokens: true, options: {
    language: { type: "string", default: "all" }, root: { type: "string" }, python: { type: "string" },
    "node-deps": { type: "string" }, help: { type: "boolean", short: "h" }
  } });
  const seen = new Set();
  for (const token of tokens) if (token.kind === "option") {
    if (seen.has(token.name)) throw new Error(`Repeated option --${token.name}`);
    seen.add(token.name);
  }
  if (values.help) { console.log(USAGE); return; }
  if (!values.root?.trim()) throw new Error("--root must select a private output parent");
  const languages = values.language === "all" ? LANGUAGES : [values.language];
  assert.ok(languages.every((language) => LANGUAGES.includes(language)), "unsupported --language");
  const runRoot = await mkdtemp(path.join(await directory(values.root), "task-spec-languages-"));
  console.error(`Retained synthetic demo evidence: ${runRoot}`);
  const api = await runtime();
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
      results.push(await runLanguage(api, runRoot, language, values, controller.signal));
      console.error(`${language}: ${results.at(-1).status}`);
    }
  } finally { process.removeListener("SIGINT", abort); }
  const summary = { mode: "offline-scripted-owned-write", packageRoot: PACKAGE_ROOT, packageVersion: pkg.version, runRoot,
    modelInvocations: 0, costUsd: null, supportsLiveEffectivenessClaim: false, results };
  await save(path.join(runRoot, "summary.json"), summary);
  console.log(JSON.stringify(summary, null, 2));
  if (results.some((result) => result.status !== "passed")) process.exitCode = 1;
}
main().catch((error) => { console.error(error.stack ?? String(error)); process.exitCode = 1; });
