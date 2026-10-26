import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseDevelopmentTaskSpec } from "../../../src/development/task-spec.js";
import { pythonTaskSpecDraft } from "../../../src/cli/task-spec-python.js";
import { startDevelopmentTaskSpec } from "../../../src/development/start-task-spec.js";
import { runAuthorizedCommand } from "../../../src/execution/command-runner.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";

const REPO = process.cwd();
const PYTHON = process.env.SPARKLE_PYTHON_EXAMPLE_EXECUTABLE;
const EMPTY_PYTHON = process.env.SPARKLE_PYTHON_NO_MODULES_EXECUTABLE;
const PROJECT = `[project]
name = "sparkle-python-fixture"
version = "0.0.0"
dependencies = ["fastapi"]

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["src"]

[tool.ruff]
target-version = "py312"
line-length = 88
`;
const APP = `from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()


class TotalRequest(BaseModel):
    values: list[int]


@app.post("/total")
def total(payload: TotalRequest) -> dict[str, int]:
    return {"total": sum(payload.values)}
`;
const TEST = `from fastapi.testclient import TestClient

from total_api.app import app


def test_total_counts_duplicates():
    with TestClient(app) as client:
        response = client.post("/total", json={"values": [2, 2, 3]})
    assert response.status_code == 200
    assert response.json() == {"total": 7}
`;
function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
async function fixture(body: (repo: string, root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "sparkle-python-init-"));
  const repo = path.join(root, "source");
  await mkdir(path.join(repo, "src/total_api"), { recursive: true });
  await mkdir(path.join(repo, "tests"));
  await writeFile(path.join(repo, "pyproject.toml"), PROJECT, "utf8");
  await writeFile(path.join(repo, "src/total_api/__init__.py"), "", "utf8");
  await writeFile(path.join(repo, "src/total_api/app.py"), APP, "utf8");
  await writeFile(path.join(repo, "tests/test_total.py"), TEST, "utf8");
  try { await body(repo, root); }
  finally {
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith("sparkle-python-init-"));
    await rm(root, { recursive: true, force: true });
  }
}
function entrypoint(args: string[]): { code: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/cli/main.ts", ...args],
    { cwd: REPO, encoding: "utf8", windowsHide: true, timeout: 60000 });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}
async function readRegularFile(file: string): Promise<string> {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error("expected regular nonlinked file");
  return readFile(file, "utf8");
}
function profile(repo: string, python = process.execPath) {
  return pythonTaskSpecDraft({ root: repo, taskFilename: "sparkle.task.json", python, readRegularFile });
}

test("Python profile only drafts fixed argv and protects existing configuration without executing tests or imports", async () => fixture(async (repo) => {
  await writeFile(path.join(repo, "conftest.py"), "raise RuntimeError('init must not import me')\n", "utf8");
  await writeFile(path.join(repo, "requirements.txt"), "fastapi\n", "utf8");
  await writeFile(path.join(repo, "uv.lock"), "version = 1\n", "utf8");
  await writeFile(path.join(repo, "tests/test_total.py"), "raise RuntimeError('init must not execute tests')\n", "utf8");
  const before = await readFile(path.join(repo, "pyproject.toml"), "utf8");
  // A non-Python executable is intentional: init only locates a host-selected
  // executable; it must not run language probes or infer installed modules.
  const drafted = await profile(repo);
  assert.equal(drafted.profile, "python");
  assert.deepEqual(drafted.spec.write.allow, ["src"]);
  for (const file of ["pyproject.toml", "tests", "sparkle.task.json", "requirements.txt", "uv.lock", "conftest.py"]) {
    assert.ok(drafted.spec.write.protect.includes(file));
    assert.ok(drafted.spec.checks.every((check) => check.protectedPaths!.includes(file)));
  }
  assert.deepEqual(drafted.spec.checks.map((check) => check.timeoutMs), [20000, 20000]);
  assert.equal(drafted.spec.budget.checkSeconds, 40);
  assert.equal(await readFile(path.join(repo, "pyproject.toml"), "utf8"), before);
  await assert.rejects(lstat(path.join(repo, "sparkle.task.json")), { code: "ENOENT" });
}));

for (const table of ["project", "tool.ruff"]) {
  test(`Python profile accepts pytest table comments on ${table}`, async () => fixture(async (repo) => {
    const project = PROJECT.replace(`[${table}]`, `[${table}] # pytest is used for tests`);
    await writeFile(path.join(repo, "pyproject.toml"), project, "utf8");
    const drafted = await profile(repo);
    assert.equal(drafted.profile, "python");
    assert.equal(await readFile(path.join(repo, "pyproject.toml"), "utf8"), project);
  }));
}

test("Python CLI init accepts pytest table comments without executing or changing inputs", async () => fixture(async (repo) => {
  await writeFile(path.join(repo, "pyproject.toml"), PROJECT
    .replace("[project]", "[project] # pytest project metadata")
    .replace("[tool.ruff]", "[tool.ruff] # pytest companion checker"), "utf8");
  await writeFile(path.join(repo, "conftest.py"), "raise RuntimeError('init must not import me')\n", "utf8");
  await writeFile(path.join(repo, "tests/test_total.py"), "raise RuntimeError('init must not execute tests')\n", "utf8");
  const inputs = ["pyproject.toml", "conftest.py", "src/total_api/__init__.py", "src/total_api/app.py", "tests/test_total.py"];
  const before = await Promise.all(inputs.map((file) => readFile(path.join(repo, file))));
  // Node is intentionally selected: init must locate it without probing Python modules.
  const initialized = entrypoint(["init", "--task", "--dir", repo, "--python", process.execPath, "--json"]);
  assert.equal(initialized.code, 0, initialized.stderr);
  const output = JSON.parse(initialized.stdout);
  assert.equal(output.type, "TASKSPEC_DRAFT");
  assert.equal(output.profile, "python");
  const drafted = parseDevelopmentTaskSpec(await readFile(path.join(repo, "sparkle.task.json"), "utf8"));
  assert.ok(drafted.checks.every((check) => check.command === process.execPath));
  assert.deepEqual(await Promise.all(inputs.map((file) => readFile(path.join(repo, file)))), before);
}));

for (const [name, replacement] of [
  ["unsupported pytest table", PROJECT.replace("[tool.pytest.ini_options]", "[tool.pytest]")],
  ["nested pytest table", `${PROJECT}\n[tool.pytest.ini_options.extra] # pytest configuration\nvalue = "unsupported"\n`],
  ["implicit test discovery", PROJECT.replace('testpaths = ["tests"]', 'testpaths = ["."]')],
  ["unbounded source imports", PROJECT.replace('pythonpath = ["src"]', 'pythonpath = ["../outside"]')],
  ["extra pytest options", PROJECT.replace('testpaths = ["tests"]', 'testpaths = ["tests"]\naddopts = "-p custom_plugin"')],
  ["external Ruff configuration", `${PROJECT}extend = "../outside.toml"\n`],
  ["quoted Ruff table", `${PROJECT.replace("[tool.ruff]", '[tool."ruff"]')}extend = "../outside.toml"\n`],
  ["quoted Ruff extend key", `${PROJECT}"extend" = "../outside.toml"\n`],
  ["dotted external tool configuration", `tool.ruff.extend = "../outside.toml"\n${PROJECT}`],
  ["multiline string masquerading as pytest configuration", `description = """\n${PROJECT}\n"""\n`]
] as const) {
  test(`Python profile refuses ${name}`, async () => fixture(async (repo) => {
    await writeFile(path.join(repo, "pyproject.toml"), replacement, "utf8");
    await assert.rejects(profile(repo), /pytest|Ruff|configuration/i);
  }));
}
for (const config of ["pytest.ini", "setup.cfg", "tox.ini", "ruff.toml", ".ruff.toml"]) {
  test(`Python profile refuses conflicting ${config}`, async () => fixture(async (repo) => {
    await writeFile(path.join(repo, config), "# unsupported competing configuration\n", "utf8");
    await assert.rejects(profile(repo), /conflicting.*configuration/i);
  }));
}
test("Python profile refuses linked source parents and nested checker configuration", async () => fixture(async (repo, root) => {
  await rename(path.join(repo, "src"), path.join(root, "source-code"));
  await symlink(path.join(root, "source-code"), path.join(repo, "src"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(profile(repo), /link/i);
  await rm(path.join(repo, "src"));
  await rename(path.join(root, "source-code"), path.join(repo, "src"));
  await writeFile(path.join(repo, "src/.ruff.toml"), "# cannot be worker-writable checker configuration\n", "utf8");
  await assert.rejects(profile(repo), /nested.*configuration/i);
}));
test("Python profile refuses missing executable and WindowsApps launcher aliases", async () => fixture(async (repo, root) => {
  await assert.rejects(profile(repo, path.join(root, "missing-python.exe")), /executable.*unavailable/i);
  const alias = path.join(root, "Microsoft/WindowsApps/python.exe");
  await mkdir(path.dirname(alias), { recursive: true });
  await copyFile(process.execPath, alias);
  await assert.rejects(profile(repo, alias), /WindowsApps/i);
}));
test("Python profile prefers the project venv executable without resolving its selected path", async () => fixture(async (repo) => {
  const relative = process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python";
  const executable = path.join(repo, relative);
  await mkdir(path.dirname(executable), { recursive: true });
  await copyFile(process.execPath, executable);
  const drafted = await pythonTaskSpecDraft({ root: repo, taskFilename: "sparkle.task.json", readRegularFile });
  assert.equal(drafted.spec.checks[0]!.command, executable);
}));

test("Python CLI init does not claim missing pytest modules are installed; real preflight refuses", {
  skip: EMPTY_PYTHON === undefined ? "set SPARKLE_PYTHON_NO_MODULES_EXECUTABLE to a real isolated Python without pytest" : false
}, async () => fixture(async (repo, root) => {
  const initialized = entrypoint(["init", "--task", "--dir", repo, "--python", EMPTY_PYTHON!, "--json"]);
  assert.equal(initialized.code, 0, initialized.stderr);
  git(repo, ["init"]); git(repo, ["config", "core.autocrlf", "false"]);
  git(repo, ["config", "user.name", "Python missing module fixture"]);
  git(repo, ["config", "user.email", "fixture@example.invalid"]);
  git(repo, ["add", "."]); git(repo, ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
  const checked = entrypoint(["preflight", path.join(repo, "sparkle.task.json"), "--project", repo, "--state-root", path.join(root, "state"), "--json"]);
  assert.equal(checked.code, 1);
  const report = JSON.parse(checked.stdout);
  assert.equal(report.ok, false);
  const evidence = JSON.parse(await readFile(report.artifactPath, "utf8"));
  assert.match(evidence.checks[0].result.stderrText, /No module named pytest/);
  assert.equal(git(repo, ["status", "--porcelain=v1", "--untracked-files=all", "--ignored"]), "");
}));

test("Python TaskSpec CLI draft executes real FastAPI pytest and ruff without changing source", {
  skip: PYTHON === undefined ? "set SPARKLE_PYTHON_EXAMPLE_EXECUTABLE to a real Python with pytest, ruff, FastAPI and httpx" : false
}, async () => fixture(async (repo, root) => {
  const initialized = entrypoint(["init", "--task", "--dir", repo, "--python", PYTHON!, "--json"]);
  assert.equal(initialized.code, 0, initialized.stderr);
  assert.equal(JSON.parse(initialized.stdout).profile, "python");
  const file = path.join(repo, "sparkle.task.json");
  const draft = parseDevelopmentTaskSpec(await readFile(file, "utf8"));
  assert.equal(draft.checks.length, 2);
  assert.equal(draft.checks[0]!.command, path.resolve(PYTHON!));
  assert.deepEqual(draft.checks[0]!.args, ["-I", "-B", "-m", "pytest", "-q", "-p", "no:cacheprovider", "tests"]);
  assert.deepEqual(draft.checks[1]!.args, ["-I", "-B", "-m", "ruff", "check", "--no-cache", "--config", "pyproject.toml", "--no-respect-gitignore", "src", "tests"]);
  assert.ok(draft.checks.every((check) => check.timeoutMs === 20000));
  git(repo, ["init"]); git(repo, ["config", "core.autocrlf", "false"]);
  git(repo, ["config", "user.name", "Python initializer fixture"]);
  git(repo, ["config", "user.email", "fixture@example.invalid"]);
  git(repo, ["add", "."]); git(repo, ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
  const revision = git(repo, ["rev-parse", "HEAD"]);
  const original = await readFile(path.join(repo, "src/total_api/app.py"), "utf8");
  const checked = entrypoint(["preflight", file, "--project", repo, "--state-root", path.join(root, "state"), "--json"]);
  assert.equal(checked.code, 0, checked.stderr);
  const observation = JSON.parse(checked.stdout);
  assert.equal(observation.ok, true);
  assert.equal(observation.effectsSettled, true);
  assert.equal(observation.candidateDisposition, "removed");
  const evidence = JSON.parse(await readFile(observation.artifactPath, "utf8"));
  assert.equal(evidence.checks.length, 2);
  assert.match(evidence.checks[0].result.stdoutText, /1 passed/);
  assert.match(evidence.checks[1].result.stdoutText, /All checks passed/);
  assert.equal(git(repo, ["rev-parse", "HEAD"]), revision);
  assert.equal(git(repo, ["status", "--porcelain=v1", "--untracked-files=all", "--ignored"]), "");
  assert.equal(await readFile(path.join(repo, "src/total_api/app.py"), "utf8"), original);
}));

for (const bypass of ["nested-config", "nested-gitignore"] as const) {
  test(`Python checker refuses a real lint violation despite worker-written ${bypass}`, {
    skip: PYTHON === undefined ? "set SPARKLE_PYTHON_EXAMPLE_EXECUTABLE to a real Python with optional framework dependencies" : false
  }, async () => fixture(async (repo, root) => {
    const initialized = entrypoint(["init", "--task", "--dir", repo, "--python", PYTHON!, "--json"]);
    assert.equal(initialized.code, 0, initialized.stderr);
    const spec = parseDevelopmentTaskSpec(await readFile(path.join(repo, "sparkle.task.json"), "utf8"));
    git(repo, ["init"]); git(repo, ["config", "core.autocrlf", "false"]);
    git(repo, ["config", "user.name", "Python checker scope fixture"]);
    git(repo, ["config", "user.email", "fixture@example.invalid"]);
    git(repo, ["add", "."]); git(repo, ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
    const revision = git(repo, ["rev-parse", "HEAD"]);
    let factories = 0; let actualViolation = false;
    const result = await startDevelopmentTaskSpec({ sourceRepo: repo, stateRoot: path.join(root, "state"),
      sandboxRoot: path.join(root, "candidates"), spec, executorFactory: (context) => {
        factories++;
        return { async *execute(request, signal) {
          const write = context.tools.find((tool) => tool.name === "sparkle_write_file")!;
          await write.execute("introduce-lint-violation", { path: "src/total_api/app.py", contents: `import os\n${APP}` }, signal);
          const checker = spec.checks[1]!;
          const checked = await runAuthorizedCommand({ executable: checker.command, args: checker.args, cwd: context.candidatePath,
            env: {}, timeoutMs: 20000, maxStdoutBytes: 8192, maxStderrBytes: 8192, signal });
          if (checked.cleanupUnsettled) context.onCommandCleanupUnsettled(checked);
          assert.equal(checked.status, "completed");
          assert.equal(checked.exitCode, 1);
          assert.match(checked.stdoutText, /F401/);
          actualViolation = true;
          await write.execute("attempt-to-weaken-lint", bypass === "nested-config"
            ? { path: "src/ruff.toml", contents: '[lint]\nignore = ["ALL"]\n' }
            : { path: "src/.gitignore", contents: "*.py\n" }, signal);
          yield* new ProtocolChildExecutor().execute(request, signal);
        } };
      } });
    assert.equal(factories, 1);
    assert.equal(actualViolation, true);
    assert.equal(result.execution.acceptance.accepted, false, "worker-owned config/ignore files must not weaken the protected Ruff invocation");
    assert.equal(git(repo, ["rev-parse", "HEAD"]), revision);
    assert.equal(git(repo, ["status", "--porcelain=v1", "--untracked-files=all", "--ignored"]), "");
    assert.equal(await readFile(path.join(repo, "src/total_api/app.py"), "utf8"), APP);
  }));
}
