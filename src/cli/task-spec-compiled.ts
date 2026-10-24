import { accessSync, constants, statSync } from "node:fs";
import { lstat, opendir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DomainValidationError } from "../domain/errors.js";
import { assertTaskSpecStateOutside } from "../development/task-preflight.js";
import { snapshotDevelopmentTaskSpec, type DevelopmentTaskSpec } from "../development/task-spec.js";
import { physicalDirectoryWithoutLinks } from "../native/physical-directory.js";

export interface CompiledDraftInput {
  readonly root: string;
  readonly stateRoot: string;
  readonly language: "Rust" | "Go";
  readonly taskFilename: string;
  readonly readRegularFile: (file: string) => Promise<string>;
}
export interface CompiledDraft {
  readonly spec: DevelopmentTaskSpec;
  readonly profile: "rust" | "go";
  readonly cachePath: string;
}
interface CompiledDefinition {
  readonly command: string; readonly args: string[]; readonly allow: string[]; readonly protect: string[]; readonly context: string[];
  readonly checkerInputs?: string[];
}
function fail(message: string): never { throw new DomainValidationError(`compiled TaskSpec draft: ${message}`); }
async function exists(file: string): Promise<boolean> {
  try { await lstat(file); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
function compiler(name: "cargo" | "go" | "cc"): string {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    const absolute = directory.replace(/^"|"$/g, "");
    if (!path.isAbsolute(absolute)) continue;
    const candidate = path.join(absolute, process.platform === "win32" ? `${name}.exe` : name);
    try {
      // Retain the discovered command spelling: rustup's cargo symlink needs
      // argv[0] to remain cargo, rather than its canonical rustup basename.
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch { /* Try the next host-selected PATH entry without executing it. */ }
  }
  return fail(`${name} executable not found in host PATH; install/select it separately or author an explicit TaskSpec`);
}
async function refuseInputs(root: string, names: readonly string[]): Promise<void> {
  for (const name of names) if (await exists(path.join(root, name))) fail(`unsupported configuration/input: ${name}`);
}
/** Discover only regular source inputs, with bounds matching the small profile. */
async function filesUnder(root: string, relative = "", depth = 0, budget = { remaining: 512 }): Promise<string[]> {
  if (depth > 16) fail("source input discovery exceeded 16 directory levels");
  const directory = path.join(root, relative);
  physicalDirectoryWithoutLinks(directory);
  const handle = await opendir(directory, { bufferSize: 32 });
  const files: string[] = [];
  try {
    for (;;) {
      const item = await handle.read();
      if (item === null) break;
      if (--budget.remaining < 0) fail("source input discovery exceeded 512 entries");
      if (relative === "" && item.name === ".git") continue;
      if (item.name.includes("\\") || item.name.includes("\ufffd")) fail("unsupported source filename encoding");
      const child = relative ? `${relative}/${item.name}` : item.name;
      const info = await lstat(path.join(root, child));
      if (info.isSymbolicLink()) fail(`linked source/checker input is unsupported: ${child}`);
      if (info.isDirectory()) files.push(...await filesUnder(root, child, depth + 1, budget));
      else if (info.isFile() && info.nlink === 1) files.push(child);
      else fail(`source/checker input must be a nonlinked regular file: ${child}`);
    }
  } finally { await handle.close(); }
  return files;
}
function simplePackage(text: string): { name: string; version: string } {
  const values = new Map<string, string>();
  let section = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line === "[package]" && !section) { section = true; continue; }
    const field = /^([a-z]+)\s*=\s*"([^"\r\n]+)"\s*(?:#.*)?$/.exec(line);
    if (!section || !field || !["name", "version", "edition"].includes(field[1]!) || values.has(field[1]!)) fail("unsupported Cargo.toml; expected only one [package] with name, version and edition, without dependencies/workspace/custom targets");
    values.set(field[1]!, field[2]!);
  }
  const name = values.get("name") ?? "", version = values.get("version") ?? "";
  if (!/^[a-z][a-z0-9_-]*$/.test(name) || !/^\d+\.\d+\.\d+$/.test(version) || !["2018", "2021", "2024"].includes(values.get("edition") ?? "")) fail("unsupported Rust package identity or edition");
  return { name, version };
}
function simpleLock(text: string, pkg: { name: string; version: string }): void {
  let section = false, format = false;
  const fields = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (!section && !format && /^version\s*=\s*[34]$/.test(line)) { format = true; continue; }
    if (line === "[[package]]" && format && !section) { section = true; continue; }
    const field = /^(name|version)\s*=\s*"([^"\r\n]+)"$/.exec(line);
    if (!section || !field || fields.has(field[1]!)) fail("unsupported Cargo.lock; expected one local package without dependencies");
    fields.set(field[1]!, field[2]!);
  }
  if (!format || !section || fields.get("name") !== pkg.name || fields.get("version") !== pkg.version) fail("Cargo.lock must match the single local package");
}
async function rustDefinition(input: CompiledDraftInput, cachePath: string): Promise<CompiledDefinition> {
  const { root, readRegularFile } = input;
  await refuseInputs(root, [".cargo", "build.rs", "rust-toolchain", "rust-toolchain.toml", "examples", "benches"]);
  const pkg = simplePackage(await readRegularFile(path.join(root, "Cargo.toml")));
  simpleLock(await readRegularFile(path.join(root, "Cargo.lock")), pkg);
  const source = await filesUnder(root, "src");
  await refuseInputs(root, ["src/bin"]);
  const tests = await filesUnder(root, "tests");
  if (!source.some((file) => file === "src/lib.rs" || file === "src/main.rs") || !tests.some((file) => file.endsWith(".rs"))) fail("Rust requires src/lib.rs or src/main.rs and existing external integration tests under tests");
  const cargo = compiler("cargo");
  // POSIX rustup/cargo needs a searchable system linker. Carry only the two
  // selected executable directories, not the host environment or whole PATH.
  const env = process.platform === "win32" ? {} : { PATH: [...new Set([path.dirname(cargo), path.dirname(compiler("cc"))])].join(path.delimiter) };
  return { command: process.execPath, args: ["-e", COMPILED_CHECK_WRAPPER, "rust", cargo, cachePath, JSON.stringify(env)], allow: ["src"],
    protect: ["Cargo.toml", "Cargo.lock", "tests", input.taskFilename], context: ["Cargo.toml", "Cargo.lock"] };
}
function simpleGoModule(text: string): void {
  let module = false, version = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (!line) continue;
    if (!module && /^module [A-Za-z0-9][A-Za-z0-9._/-]*$/.test(line)) { module = true; continue; }
    if (!version && /^go 1\.[0-9]+(?:\.[0-9]+)?$/.test(line)) { version = true; continue; }
    fail("unsupported go.mod; expected only module and go directives, without require/replace/workspace/toolchain");
  }
  if (!module || !version) fail("go.mod must declare module and go version");
}
async function goDefinition(input: CompiledDraftInput, cachePath: string): Promise<CompiledDefinition> {
  const { root, readRegularFile } = input;
  await refuseInputs(root, ["go.work", "go.work.sum", "go.sum", "vendor"]);
  simpleGoModule(await readRegularFile(path.join(root, "go.mod")));
  const sources = (await filesUnder(root)).filter((file) => file.endsWith(".go"));
  for (const file of sources) {
    if (!/^[A-Za-z][A-Za-z0-9]*(?:_test)?\.go$/.test(file)) fail(`unsupported Go input ${file}; require a root single package with ASCII alphanumeric stems and <stem>_test.go tests, without ignored/platform/subpackage inputs`);
    if (/^[ \t]*\/\/(?:go:(?:build|embed)\b|[ \t]+\+build\b)/m.test(await readRegularFile(path.join(root, file)))) fail(`unsupported Go build constraint or embed directive: ${file}`);
  }
  if (!sources.some((file) => file.endsWith("_test.go")) || !sources.some((file) => !file.endsWith("_test.go"))) fail("Go requires existing source and _test.go files");
  const windows = Object.fromEntries(["SystemRoot", "WINDIR"].flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]!]]));
  const checkerInputs = ["go.mod", input.taskFilename, ...sources.filter((file) => file.endsWith("_test.go"))];
  if (checkerInputs.length > 16) fail("Go checker inputs exceed the existing 16-path recipe limit; author an explicit TaskSpec instead");
  return { command: process.execPath, args: ["-e", COMPILED_CHECK_WRAPPER, "go", compiler("go"), cachePath, JSON.stringify(windows)], allow: ["**/*.go"],
    protect: ["go.mod", "**/*_test.go", input.taskFilename], checkerInputs, context: ["go.mod"] };
}
// Fixed host wrapper; source-controlled commands never supply shell or env code.
const COMPILED_CHECK_WRAPPER = `const f=require('node:fs'),p=require('node:path'),{spawn}=require('node:child_process');
const [lang,exe,parent,win]=process.argv.slice(1);
function dir(d){let at=p.parse(d).root;for(const part of [null,...p.resolve(d).slice(at.length).split(p.sep).filter(Boolean)]){if(part!==null)at=p.join(at,part);let s;try{s=f.lstatSync(at)}catch(e){if(e.code!=='ENOENT')throw e;try{f.mkdirSync(at)}catch(e){if(e.code!=='EEXIST')throw e}s=f.lstatSync(at)}if(s.isSymbolicLink()||!s.isDirectory())throw Error('compiler output parent contains a link or non-directory')}}
dir(parent);const out=f.mkdtempSync(p.join(parent,'check-'));dir(out);let env={},args;
if(lang==='rust'){env=JSON.parse(win);args=['test','--offline','--locked','--target-dir',out]}else{const temp=p.join(out,'temp');dir(temp);env={...JSON.parse(win),CGO_ENABLED:'0',GOTOOLCHAIN:'local',GOPROXY:'off',GOSUMDB:'off',GOWORK:'off',GOENV:'off',GOCACHE:p.join(out,'build'),GOMODCACHE:p.join(out,'mod'),GOPATH:p.join(out,'path'),TEMP:temp,TMP:temp,TMPDIR:temp};args=['test','-count=1','./...']}
const child=spawn(exe,args,{cwd:process.cwd(),env,shell:false,windowsHide:true,stdio:'inherit'});
child.on('error',e=>{console.error('Compiler spawn failed: '+e.message);process.exitCode=1});child.on('close',code=>{process.exitCode=code===0?0:code>0?code:1});`;

/** Detection never compiles, installs or creates the selected external cache. */
export async function compiledTaskSpecDraft(input: CompiledDraftInput): Promise<CompiledDraft> {
  physicalDirectoryWithoutLinks(input.root);
  assertTaskSpecStateOutside(input.root, input.stateRoot);
  let existing = input.stateRoot;
  while (!await exists(existing)) existing = path.dirname(existing);
  physicalDirectoryWithoutLinks(existing);
  const profile = input.language === "Rust" ? "rust" : "go";
  const cachePath = path.join(input.stateRoot, "runtime", "development", "task-cache", randomUUID());
  assertTaskSpecStateOutside(input.root, cachePath);
  const selected = input.language === "Rust" ? await rustDefinition(input, cachePath) : await goDefinition(input, cachePath);
  const spec = snapshotDevelopmentTaskSpec({ version: 1, objective: "Describe the intended source change before running this draft", context: selected.context,
    write: { allow: selected.allow, protect: selected.protect }, prepare: [], checks: [{ id: `${profile}-tests`, command: selected.command,
      args: selected.args, verifierVersion: "init-draft-v1", protectedPaths: selected.checkerInputs ?? selected.protect, visibleToWorker: true, timeoutMs: 40000, expect: { baseline: "pass" } }],
    budget: { totalSeconds: 600, prepareSeconds: 300, checkSeconds: 40, workerSeconds: 300 }, worker: { model: "inherit" } });
  return { spec, profile, cachePath };
}
