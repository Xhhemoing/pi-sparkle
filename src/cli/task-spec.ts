import { constants, type Stats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { DomainValidationError } from "../domain/errors.js";
import { parseDevelopmentTaskSpec, snapshotDevelopmentTaskSpec, type DevelopmentTaskSpec } from "../development/task-spec.js";
import { preflightDevelopmentTaskSpec } from "../development/start-task-spec.js";
import { resolveInsideRoot } from "../execution/paths.js";
import { physicalDirectoryWithoutLinks } from "../native/physical-directory.js";
import { cliFail, CLI_EXIT } from "./errors.js";

export interface TaskSpecCliIo { stdout(text: string): void; stderr(text: string): void; }
export const TASK_PREFLIGHT_USAGE = `pi-sparkle preflight — execute zero-model TaskSpec preparation and base checks

Usage:
  pi-sparkle preflight <task.json> --project <repo> [--state-root <dir>] [--json]

Executes trusted host commands in an isolated candidate and stores private host
evidence. This is not static validation or an OS sandbox. No provider is loaded
and no source change is applied. State defaults to ~/.pi-sparkle and must be
outside the source repository. Unsettled candidates are retained for host
reconciliation.
`;
export const TASK_INIT_USAGE = `pi-sparkle init --task — generate an experimental TaskSpec draft

Usage:
  pi-sparkle init --task [--dir <repo>] [--force] [--json]

Writes sparkle.task.json from an existing Node package's simple node --test
script with explicit .js/.mjs/.cjs or .ts/.mts/.cts test files. TypeScript
requires native Node type stripping and erasable syntax; no static type check
is performed. No test, install or model is
run. Review the draft's objective, scope, checks and budgets before preflight.
Only --force replaces an existing regular file. Shell scripts, other runners,
Python/Rust/Go and ambiguous multi-language packages are not supported yet.
The draft expects a passing base; a business RED requires an explicit named
assertion wrapper authored by the host, never a guessed failure assertion.
`;
const TASK_FILENAME = "sparkle.task.json";
const MAX_BYTES = 64 * 1024;
function fail(message: string): never { throw new DomainValidationError(message); }
function required(value: string | undefined, flag: string): string {
  if (value === undefined || value.trim() === "" || value.includes("\0")) fail(`${flag} must be a non-empty path`);
  return value;
}
function sameFile(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}
async function entry(file: string): Promise<Stats | undefined> {
  try { return await lstat(file); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
/** NOFOLLOW is not portable to Windows, so compare the path and opened handle too. */
async function boundedFile(file: string): Promise<string> {
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_BYTES) fail(`expected a regular, nonlinked file of at most ${MAX_BYTES} bytes: ${file}`);
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = await handle.stat();
    if (!sameFile(before, opened)) fail(`file changed while opening: ${file}`);
    const buffer = Buffer.alloc(opened.size + 1);
    let used = 0;
    while (used < buffer.length) {
      const { bytesRead } = await handle.read(buffer, used, buffer.length - used, used);
      if (bytesRead === 0) break;
      used += bytesRead;
    }
    if (used !== opened.size || !sameFile(opened, await handle.stat()) || !sameFile(opened, await lstat(file))) fail(`file changed while reading: ${file}`);
    try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, used)); }
    catch { return fail(`file must contain valid UTF-8: ${file}`); }
  } finally { await handle.close(); }
}
function rejectDuplicates(tokens: readonly { readonly kind: string; readonly name?: string }[]): void {
  const seen = new Set<string>();
  for (const token of tokens) if (token.kind === "option" && token.name !== undefined) {
    if (seen.has(token.name)) fail(`duplicate flag --${token.name}`);
    seen.add(token.name);
  }
}
export async function taskSpecPreflightCommand(args: string[], io: TaskSpecCliIo, runtime: { signal?: AbortSignal } = {}): Promise<number> {
  let stage = "parse-args";
  try {
    const { values, positionals, tokens } = parseArgs({ args, strict: true, allowPositionals: true, tokens: true, options: {
      project: { type: "string" }, "state-root": { type: "string" }, json: { type: "boolean" }, help: { type: "boolean", short: "h" }
    } });
    rejectDuplicates(tokens);
    if (values.help || (positionals.length === 1 && positionals[0] === "help")) { io.stdout(TASK_PREFLIGHT_USAGE); return CLI_EXIT.ok; }
    if (positionals.length !== 1) fail("preflight requires exactly one <task.json> positional path");
    const file = path.resolve(required(positionals[0], "<task.json>"));
    const sourceRepo = path.resolve(required(values.project, "--project"));
    const stateRoot = path.resolve(values["state-root"] === undefined ? path.join(homedir(), ".pi-sparkle") : required(values["state-root"], "--state-root"));
    stage = "validation";
    runtime.signal?.throwIfAborted();
    const spec = parseDevelopmentTaskSpec(await boundedFile(file));
    stage = "execute";
    const result = await preflightDevelopmentTaskSpec({ sourceRepo, stateRoot, spec,
      ...(runtime.signal === undefined ? {} : { signal: runtime.signal }) });
    // Keep diagnostics in the host artifact. This projection never prints check output.
    const output = { type: "TASKSPEC_PREFLIGHT", preview: true, ok: result.ok, effectsSettled: result.effectsSettled,
      artifactPath: result.artifactPath, preparationMs: result.preparationMs, checksMs: result.checksMs,
      candidatePath: result.candidatePath, candidateDisposition: result.candidateDisposition };
    if (values.json) io.stdout(`${JSON.stringify(output)}\n`);
    else io.stdout(`TaskSpec preflight ${result.ok ? "accepted the expected base" : "refused the base"}.\nHost evidence: ${result.artifactPath}\nEffects settled: ${result.effectsSettled}\nCandidate: ${result.candidateDisposition} (${result.candidatePath})\n`);
    if (!result.ok) return cliFail(io, { command: "preflight", stage: "execute", message: "TaskSpec base checks were refused",
      next: `inspect private host evidence at ${result.artifactPath}; reconcile any unsettled candidate before retrying` });
    return CLI_EXIT.ok;
  } catch (error) {
    return cliFail(io, { command: "preflight", stage, message: error instanceof Error ? error.message : String(error), next: "run pi-sparkle preflight --help; review the TaskSpec and private host evidence before retrying" });
  }
}

async function physicalDirectory(root: string, relative: string): Promise<boolean> {
  const info = await entry(resolveInsideRoot(root, relative));
  if (info?.isSymbolicLink()) fail(`linked source/test directories are unsupported: ${relative}`);
  return info?.isDirectory() ?? false;
}
async function nodeTestArgs(root: string, script: unknown): Promise<{ args: string[]; inputs: string[] }> {
  if (typeof script !== "string" || script.length > 4096 || !/^node[ \t]+--test(?:[ \t]+|$)/.test(script) || /[^A-Za-z0-9_./:=,@+\- \t]/.test(script)) {
    fail("unsupported test script: init --task requires a simple node --test command without quoting or shell syntax");
  }
  const args = script.trim().split(/[ \t]+/).slice(1);
  const inputs: string[] = [];
  for (let index = 1; index < args.length; index++) {
    const token = args[index]!;
    if (/^--test-(?:concurrency|timeout)=[1-9][0-9]*$/.test(token)) continue;
    if (token === "--test-concurrency" || token === "--test-timeout") {
      if (!/^[1-9][0-9]*$/.test(args[++index] ?? "")) fail(`unsupported numeric Node test option: ${token}`);
      continue;
    }
    if (token.startsWith("-") || token.startsWith("/") || token.includes(":") || token.split("/").some((part) => part === "." || part === ".." || part === "")) fail(`unsupported Node test argument: ${token}`);
    const input = resolveInsideRoot(root, token);
    physicalDirectoryWithoutLinks(path.dirname(input));
    const info = await lstat(input);
    if (!info.isFile() || info.isSymbolicLink() || !/\.(?:cjs|mjs|js|cts|mts|ts)$/.test(token)) fail(`expected an existing regular JavaScript or TypeScript test file: ${token}`);
    if (/\.(?:cts|mts|ts)$/.test(token) && !process.features.typescript) {
      fail(`native TypeScript type stripping is unavailable in this Node runtime (${process.version}); use a compatible runtime or an explicitly authored checker`);
    }
    inputs.push(token);
  }
  if (inputs.length === 0) fail("implicit Node test discovery is unsupported; use explicit existing JavaScript or TypeScript test files");
  return { args, inputs };
}
async function draftSpec(root: string): Promise<DevelopmentTaskSpec> {
  const languages = [
    { name: "Node", files: ["package.json"] }, { name: "Python", files: ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "pytest.ini"] },
    { name: "Rust", files: ["Cargo.toml"] }, { name: "Go", files: ["go.mod", "go.work"] }
  ];
  const detected: string[] = [];
  for (const language of languages) {
    for (const file of language.files) if (await entry(path.join(root, file))) { detected.push(language.name); break; }
  }
  if (detected.length !== 1 || detected[0] !== "Node") fail(`unsupported or ambiguous language detection (${detected.join(", ") || "none"}); currently only Node projects are supported`);
  let manifest: unknown;
  try { manifest = JSON.parse(await boundedFile(path.join(root, "package.json"))); }
  catch (error) { fail(`cannot read package.json: ${error instanceof Error ? error.message : String(error)}`); }
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) fail("package.json must contain an object");
  const scripts = (manifest as { scripts?: unknown }).scripts;
  const script = scripts !== null && typeof scripts === "object" && !Array.isArray(scripts) ? (scripts as { test?: unknown }).test : undefined;
  const allow: string[] = [], testDirectories: string[] = [];
  for (const directory of ["src", "lib"]) if (await physicalDirectory(root, directory)) allow.push(directory);
  if (allow.length === 0) fail("no explicit source directory detected; expected existing src or lib");
  for (const directory of ["test", "tests", "__tests__"]) if (await physicalDirectory(root, directory)) testDirectories.push(directory);
  const selected = await nodeTestArgs(root, script);
  const protect = [...new Set(["package.json", TASK_FILENAME, ...testDirectories, ...selected.inputs])];
  return snapshotDevelopmentTaskSpec({ version: 1, objective: "Describe the intended source change before running this draft", context: ["package.json"],
    write: { allow, protect }, prepare: [], checks: [{ id: "node-tests", command: process.execPath, args: selected.args,
      verifierVersion: "init-draft-v1", protectedPaths: protect, visibleToWorker: true, expect: { baseline: "pass" } }],
    budget: { totalSeconds: 600, prepareSeconds: 300, checkSeconds: 40, workerSeconds: 300 }, worker: { model: "inherit" } });
}
async function writeDraft(target: string, body: string, force: boolean): Promise<boolean> {
  const before = await entry(target);
  if (before !== undefined && (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1)) fail(`draft target must be a regular, nonlinked file: ${target}`);
  if (before !== undefined && !force) fail(`${target} already exists; pass --force to replace this regular file`);
  const flags = before === undefined ? constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
    : constants.O_RDWR | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
  const handle = await open(target, flags, 0o600);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || (before !== undefined && !sameFile(before, opened)) || !sameFile(opened, await lstat(target))) fail(`draft target changed before writing: ${target}`);
    if (before !== undefined) await handle.truncate(0);
    await handle.writeFile(body, "utf8");
    if (!sameFile(await handle.stat(), await lstat(target))) fail(`draft target changed during writing: ${target}`);
    return before !== undefined;
  } finally { await handle.close(); }
}
export async function initTaskSpecCommand(args: string[], io: TaskSpecCliIo): Promise<number> {
  let stage = "parse-args";
  try {
    const { values, tokens } = parseArgs({ args, strict: true, allowPositionals: false, tokens: true, options: {
      dir: { type: "string" }, force: { type: "boolean" }, json: { type: "boolean" }, help: { type: "boolean", short: "h" }
    } });
    rejectDuplicates(tokens);
    if (values.help) { io.stdout(TASK_INIT_USAGE); return CLI_EXIT.ok; }
    const dir = path.resolve(values.dir === undefined ? "." : required(values.dir, "--dir"));
    stage = "validation";
    const spec = await draftSpec(dir);
    const file = path.join(dir, TASK_FILENAME);
    stage = "execute";
    const overwritten = await writeDraft(file, `${JSON.stringify(spec, null, 2)}\n`, values.force === true);
    const typescript = spec.checks[0]!.args.some((argument) => /\.(?:cts|mts|ts)$/.test(argument));
    const next = "Review this draft's objective, scope, checks and budgets. It expects a passing base; configure an explicit named assertion wrapper for a business RED. No test, install or model was run."
      + (typescript ? " Native Node execution strips erasable TypeScript syntax; no static type checking is performed." : "");
    if (values.json) io.stdout(`${JSON.stringify({ type: "TASKSPEC_DRAFT", preview: true, status: "draft", dir, file, overwritten, next })}\n`);
    else io.stdout(`Wrote TaskSpec draft: ${file}\n${next}\n`);
    return CLI_EXIT.ok;
  } catch (error) {
    return cliFail(io, { command: "init", stage, message: error instanceof Error ? error.message : String(error), next: "run pi-sparkle init --task --help; unsupported projects require an explicitly authored TaskSpec" });
  }
}
