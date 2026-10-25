// Copied into the synthetic example as a protected, fixed host checker.
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const PROTOCOL = "sparkle-example-typescript-check-v1";
const refuse = (code, exitCode) => {
  process.stdout.write(`${JSON.stringify({ protocol: PROTOCOL, code })}\n`);
  process.exitCode = exitCode;
};
const ordinaryFile = (file) => {
  const info = lstatSync(file);
  return info.isFile() && !info.isSymbolicLink();
};

function check() {
  const root = process.cwd();
  const configFile = path.join(root, "tsconfig.json");
  try {
    if (!ordinaryFile(configFile)) throw new Error("TypeScript example configuration must be a regular nonlinked file");
  } catch (error) {
    if (error.code === "ENOENT") return refuse("TS_CONFIG_MISSING", 2);
    throw error;
  }
  const input = JSON.parse(readFileSync(path.join(root, "typecheck/config.json"), "utf8"));
  if (input === null || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).sort().join(",") !== "packageAnchor,requiredTypes"
    || typeof input.packageAnchor !== "string" || !path.isAbsolute(input.packageAnchor)
    || !Array.isArray(input.requiredTypes) || input.requiredTypes.length < 1
    || input.requiredTypes.some((name) => typeof name !== "string" || !/^@types\/[a-z0-9-]+$/.test(name))) {
    throw new Error("Invalid protected TypeScript example dependency configuration");
  }
  let tsc, ts;
  try {
    if (!ordinaryFile(input.packageAnchor)) throw new Error("TypeScript dependency anchor must be a regular nonlinked file");
    const modules = path.join(path.dirname(input.packageAnchor), "node_modules");
    tsc = path.join(modules, "typescript/lib/tsc.js");
    const api = path.join(modules, "typescript/lib/typescript.js");
    // Resolve only the explicitly selected prefix. Normal package-directory
    // symlinks (including pnpm's) work, but ancestor node_modules cannot fill
    // a missing compiler or type dependency in this prefix.
    for (const file of [tsc, api, ...input.requiredTypes.flatMap((name) =>
      [path.join(modules, name, "package.json"), path.join(modules, name, "index.d.ts")])]) {
      if (!ordinaryFile(file)) return refuse("TS_COMPILER_MISSING", 2);
    }
    ts = createRequire(import.meta.url)(api);
  } catch (error) {
    if (["MODULE_NOT_FOUND", "ENOENT"].includes(error.code)) return refuse("TS_COMPILER_MISSING", 2);
    throw error;
  }
  // Invalid project configuration is not a source-level type failure. Keep its
  // diagnostics private and leave the host's generic refusal unchanged.
  const config = ts.readConfigFile(configFile, ts.sys.readFile);
  const parsed = config.error === undefined ? ts.parseJsonConfigFileContent(config.config, ts.sys, root) : undefined;
  const configurationErrors = config.error === undefined ? parsed.errors : [config.error];
  if (configurationErrors.length > 0) {
    process.stderr.write(ts.formatDiagnostics(configurationErrors, {
      getCurrentDirectory: () => root, getCanonicalFileName: (file) => file, getNewLine: () => "\n"
    }));
    process.exitCode = 2;
    return;
  }
  // Classification below requires normal compiler completion. The outer host
  // runner owns cancellation/deadlines and retains interrupted cleanup as
  // unknown; this nested process does not establish OS process containment.
  const result = spawnSync(process.execPath, [tsc, "--noEmit", "-p", "."], {
    cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 256 * 1024
  });
  const stdout = result.stdout ?? "", stderr = result.stderr ?? "";
  if (stdout) process.stderr.write(stdout);
  if (stderr) process.stderr.write(stderr);
  if (result.error !== undefined || result.signal !== null || result.status === null) {
    if (result.error !== undefined) process.stderr.write(`${result.error.message}\n`);
    process.exitCode = 2;
    return;
  }
  if (result.status === 0) { process.exitCode = 0; return; }
  // Accept only normal tsc diagnostic exits with complete source-located
  // diagnostics. Missing imports/types and other setup failures stay generic.
  const setupCodes = new Set([2307, 2688, 2792, 6053, 7016]);
  const files = new Set(parsed.fileNames.map((file) => path.resolve(file)));
  const lines = stdout.trimEnd().split(/\r?\n/);
  let diagnostics = 0;
  const sourceFailure = stderr === "" && [1, 2].includes(result.status) && lines.every((line) => {
    if (line.trim() === "") return true;
    const diagnostic = /^(.+)\((\d+),(\d+)\): error TS(\d+): .+/.exec(line);
    if (diagnostic === null) return diagnostics > 0 && /^\s+\S/.test(line);
    diagnostics++;
    const file = path.resolve(root, diagnostic[1]);
    const relative = path.relative(root, file);
    return files.has(file) && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
      && !setupCodes.has(Number(diagnostic[4]));
  });
  if (sourceFailure && diagnostics > 0) return refuse("TS_UNDECLARED_RED", 1);
  process.exitCode = 2;
}

try { check(); }
catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
