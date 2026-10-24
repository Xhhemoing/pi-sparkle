import { constants } from "node:fs";
import { access, lstat, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { DomainValidationError } from "../domain/errors.js";
import { snapshotDevelopmentTaskSpec, type DevelopmentTaskSpec } from "../development/task-spec.js";
import { physicalDirectoryWithoutLinks } from "../native/physical-directory.js";

export interface PythonTaskSpecDraftInput {
  readonly root: string;
  readonly taskFilename: string;
  readonly python?: string;
  readonly readRegularFile: (file: string) => Promise<string>;
}
function fail(message: string): never { throw new DomainValidationError(`Python TaskSpec: ${message}`); }
async function entry(file: string) {
  try { return await lstat(file); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

// This deliberately recognizes one small pytest table, not general TOML.
function pytestConfiguration(text: string): void {
  if (text.includes('"""') || text.includes("'''")) fail("multiline TOML strings are outside the supported configuration subset");
  let section = "";
  let found = false;
  const keys = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      const header = /^\[([A-Za-z0-9_.-]+)\]\s*(?:#.*)?$/.exec(line);
      if (header === null || header[1] === "tool") fail("unsupported TOML configuration table; quoted or inline tool tables require an explicit TaskSpec");
      if (line.includes("pytest") && header[1] !== "tool.pytest.ini_options") fail("unsupported pytest table; use [tool.pytest.ini_options]");
      section = header[1]!;
      if (section === "tool.pytest.ini_options") {
        if (found) fail("duplicate pytest configuration table");
        found = true;
      }
      continue;
    }
    const assignment = /^([A-Za-z0-9_-]+)\s*=/.exec(line);
    if (assignment === null || (section === "" && assignment[1] === "tool")) {
      fail("unsupported TOML configuration syntax; use unquoted single-line keys and explicit tool tables");
    }
    if (section === "tool.pytest.ini_options") {
      const setting = /^(testpaths|pythonpath)\s*=\s*\[\s*(["'])(tests|src)\2\s*,?\s*\]\s*(?:#.*)?$/.exec(line);
      if (setting === null || (setting[1] === "testpaths" ? setting[3] !== "tests" : setting[3] !== "src")) {
        fail("unsupported pytest configuration; require testpaths = [\"tests\"] and pythonpath = [\"src\"] only");
      }
      if (keys.has(setting[1]!)) fail(`duplicate pytest ${setting[1]}`);
      keys.add(setting[1]!);
    }
    if (section.startsWith("tool.ruff") && assignment[1] === "extend") fail("external Ruff extend configuration is unsupported");
  }
  if (!found || !keys.has("testpaths") || !keys.has("pythonpath")) {
    fail("require explicit [tool.pytest.ini_options] testpaths = [\"tests\"] and pythonpath = [\"src\"]");
  }
}

const CONFLICTING_CONFIG = ["pytest.ini", ".pytest.ini", "setup.cfg", "setup.py", "tox.ini", "ruff.toml", ".ruff.toml"];
async function pythonFiles(root: string, directory: "src" | "tests"): Promise<string[]> {
  const base = path.join(root, directory);
  physicalDirectoryWithoutLinks(base);
  const result: string[] = [];
  const pending = [{ absolute: base, relative: directory as string, depth: 0 }];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const child of await readdir(current.absolute)) {
      if (++visited > 256 || current.depth > 32) fail("source/test inventory exceeds the supported bound");
      const file = path.join(current.absolute, child);
      const info = await lstat(file);
      if (info.isSymbolicLink()) fail(`linked source/test inputs are unsupported: ${path.relative(root, file)}`);
      if ([".venv", "venv", ".git", "node_modules"].includes(child)) fail("runtime/dependency directories cannot be source/test inputs");
      if (child === "pyproject.toml" || CONFLICTING_CONFIG.includes(child)) fail(`nested Python checker configuration is unsupported: ${path.relative(root, file)}`);
      if (info.isDirectory()) pending.push({ absolute: file, relative: `${current.relative}/${child}`, depth: current.depth + 1 });
      else if (!info.isFile() || info.nlink !== 1) fail(`source/test input must be a regular nonlinked file: ${path.relative(root, file)}`);
      else if (child.endsWith(".py")) result.push(`${current.relative}/${child}`);
    }
  }
  return result;
}
function windowsAlias(file: string): boolean { return /(?:^|\/)microsoft\/windowsapps(?:\/|$)/i.test(file.replaceAll("\\", "/")); }
async function executable(file: string): Promise<string | undefined> {
  const absolute = path.resolve(file);
  if (windowsAlias(absolute) || (process.platform === "win32" && !absolute.toLowerCase().endsWith(".exe"))) return undefined;
  try {
    if (!(await stat(absolute)).isFile() || windowsAlias(await realpath(absolute))) return undefined;
    await access(absolute, constants.X_OK);
    // Keep the selected venv path: resolving its executable symlink changes Python's venv discovery.
    return absolute;
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) return undefined;
    throw error;
  }
}
async function pythonExecutable(root: string, explicit?: string): Promise<string> {
  if (explicit !== undefined) {
    if (typeof explicit !== "string" || explicit.trim() === "" || explicit.includes("\0")) fail("--python must select an executable file");
    return await executable(explicit) ?? fail("--python executable is unavailable or is a WindowsApps launcher alias");
  }
  for (const relative of [".venv/Scripts/python.exe", ".venv/bin/python"]) {
    const candidate = path.join(root, relative);
    if (await entry(candidate)) return await executable(candidate) ?? fail(`project venv interpreter is unavailable: ${relative}`);
  }
  const names = process.platform === "win32" ? ["python3.exe", "python.exe"] : ["python3", "python"];
  for (const name of names) for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!path.isAbsolute(directory)) continue;
    const candidate = await executable(path.join(directory, name));
    if (candidate !== undefined) return candidate;
  }
  return fail("Python executable not found; pass --python or provide a real project .venv (WindowsApps aliases are unsupported)");
}

export async function pythonTaskSpecDraft(input: PythonTaskSpecDraftInput): Promise<{ spec: DevelopmentTaskSpec; profile: "python" }> {
  const root = physicalDirectoryWithoutLinks(input.root);
  const read = async (relative: string): Promise<string> => {
    const file = path.join(root, relative);
    physicalDirectoryWithoutLinks(path.dirname(file));
    return input.readRegularFile(file);
  };
  for (const name of CONFLICTING_CONFIG) if (await entry(path.join(root, name))) fail(`conflicting checker configuration is unsupported: ${name}`);
  pytestConfiguration(await read("pyproject.toml"));
  const sources = await pythonFiles(root, "src");
  const tests = await pythonFiles(root, "tests");
  if (sources.length === 0 || !tests.some((file) => /(?:^|\/)(?:test_.*|.*_test)\.py$/.test(file))) fail("require existing Python sources and explicit pytest test files under src/tests");
  const protect = ["pyproject.toml", input.taskFilename, "tests"];
  for (const name of ["requirements.txt", "requirements-dev.txt", "requirements-test.txt", "requirements.in", "constraints.txt",
    "uv.lock", "poetry.lock", "pdm.lock", "Pipfile", "Pipfile.lock", "conftest.py", ".python-version", ".gitignore"]) {
    if (await entry(path.join(root, name))) { await read(name); protect.push(name); }
  }
  if (protect.length > 16) fail("checker inputs exceed the existing 16-path recipe limit; author an explicit TaskSpec");
  const python = await pythonExecutable(root, input.python);
  const spec = snapshotDevelopmentTaskSpec({ version: 1, objective: "Describe the intended Python source change before running this draft",
    context: ["pyproject.toml"], write: { allow: ["src"], protect }, prepare: [],
    checks: [
      { id: "python-tests", command: python, args: ["-I", "-B", "-m", "pytest", "-q", "-p", "no:cacheprovider", "tests"],
        verifierVersion: "init-python-v1", protectedPaths: protect, timeoutMs: 20000, visibleToWorker: true, expect: { baseline: "pass" } },
      { id: "python-ruff", command: python, args: ["-I", "-B", "-m", "ruff", "check", "--no-cache", "--config", "pyproject.toml", "--no-respect-gitignore", "src", "tests"],
        verifierVersion: "init-python-v1", protectedPaths: protect, timeoutMs: 20000, visibleToWorker: true, expect: { baseline: "pass" } }
    ], budget: { totalSeconds: 600, prepareSeconds: 300, checkSeconds: 40, workerSeconds: 300 }, worker: { model: "inherit" } });
  return { spec, profile: "python" };
}
