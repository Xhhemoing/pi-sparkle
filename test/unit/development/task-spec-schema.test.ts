import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { validateToolArguments, type Tool, type ToolCall } from "@earendil-works/pi-ai";
import { initTaskSpecCommand } from "../../../src/cli/task-spec.js";
import { parseDevelopmentTaskSpec, snapshotDevelopmentTaskSpec } from "../../../src/development/task-spec.js";

const schemaPath = path.resolve("schema/taskspec.v1.json");
async function schema(): Promise<Tool["parameters"]> {
  const text = await readFile(schemaPath, "utf8").catch(() => assert.fail("publish the generated TaskSpec input schema at schema/taskspec.v1.json"));
  return JSON.parse(text) as Tool["parameters"];
}
function check(parameters: Tool["parameters"], value: unknown): void {
  // The SDK's public validator may coerce tool arguments. Schema samples must
  // already be valid JSON data; a coerced result is not strict-parser parity.
  const actual: unknown = validateToolArguments({ name: "task_spec", description: "TaskSpec authoring schema", parameters },
    { type: "toolCall", id: "schema-sample", name: "task_spec", arguments: value as ToolCall["arguments"] });
  assert.deepEqual(actual, value, "do not count SDK argument coercion as input-schema acceptance");
}
function valid() {
  return { version: 1, objective: "Preserve the selected behavior", context: ["src/value.ts"],
    write: { allow: ["src"], protect: ["checks"] }, prepare: [],
    checks: [{ id: "business", command: "node", args: ["checks/value.mjs", "$(literal)", ""], verifierVersion: "v1",
      protectedPaths: ["checks"], expect: { baseline: "pass" } }],
    budget: { totalSeconds: 30, prepareSeconds: 60, checkSeconds: 40, workerSeconds: 120 } };
}

test("published TaskSpec schema is reproducible from the TypeBox definition and included in package files", async () => {
  const published = await schema();
  const { developmentTaskSpecSchema } = await import("../../../src/development/task-spec-schema.js");
  assert.deepEqual(published, JSON.parse(JSON.stringify(developmentTaskSpecSchema)));
  const manifest = JSON.parse(await readFile("package.json", "utf8")) as { files: string[]; scripts: Record<string, string> };
  assert.ok(manifest.files.includes("schema"));
  assert.match(manifest.scripts["schema:taskspec"] ?? "", /generate-task-spec-schema/);
});

test("input schema accepts optional defaults, all draft command shapes and whole-millisecond fractions", async () => {
  const definition = await schema();
  const { context: _context, prepare: _prepare, ...minimal } = valid();
  check(definition, minimal);
  assert.deepEqual(snapshotDevelopmentTaskSpec(minimal).worker, { model: "inherit" });
  for (const [command, args] of [
    ["node", ["--test", "test/app.test.ts"]],
    ["C:/private/venv/python.exe", ["-I", "-B", "-m", "pytest", "-q", "-p", "no:cacheprovider", "tests"]],
    ["node", ["-e", "fixed compiler wrapper", "rust", "/host/bin/cargo", "/private/output", "{}"]],
    ["node", ["-e", "fixed compiler wrapper", "go", "/host/bin/go", "/private/output", "{}"]]
  ] as const) {
    const sample = { ...valid(), checks: [{ ...valid().checks[0]!, command, args }], worker: { model: "inherit", maxAttempts: 3 },
      budget: { ...valid().budget, workerTotalSeconds: 0.401, checkTotalSeconds: 1.234 } };
    check(definition, sample); snapshotDevelopmentTaskSpec(sample);
  }
});

test("input schema accepts the retained Python Rust and Go initializer draft shapes", async () => {
  const definition = await schema();
  const task = "sparkle.task.json";
  const pythonProtect = ["pyproject.toml", task, "tests", "requirements.txt"];
  const python = { ...valid(), context: ["pyproject.toml"], write: { allow: ["src"], protect: pythonProtect },
    checks: [
      ["-I", "-B", "-m", "pytest", "-q", "-p", "no:cacheprovider", "tests"],
      ["-I", "-B", "-m", "ruff", "check", "--no-cache", "--config", "pyproject.toml", "--no-respect-gitignore", "src", "tests"]
    ].map((args, index) => ({ ...valid().checks[0]!, id: index === 0 ? "python-tests" : "python-ruff",
      command: "C:/external/venv/Scripts/python.exe", args, timeoutMs: 20000, visibleToWorker: true, protectedPaths: pythonProtect })) };
  const rustProtect = ["Cargo.toml", "Cargo.lock", "tests", task];
  const rust = { ...valid(), context: ["Cargo.toml", "Cargo.lock"], write: { allow: ["src"], protect: rustProtect },
    checks: [{ ...valid().checks[0]!, id: "rust-tests", command: "node", timeoutMs: 40000,
      args: ["-e", "fixed fresh-output wrapper", "rust", "/host/bin/cargo", "/external/task-cache/one", '{"PATH":"/host/bin:/usr/bin"}'],
      visibleToWorker: true, protectedPaths: rustProtect }] };
  const go = { ...valid(), context: ["go.mod"], write: { allow: ["**/*.go"], protect: ["go.mod", "**/*_test.go", task] },
    checks: [{ ...valid().checks[0]!, id: "go-tests", command: "node", timeoutMs: 40000,
      args: ["-e", "fixed fresh-output wrapper", "go", "/host/bin/go", "/external/task-cache/two", "{}"],
      visibleToWorker: true, protectedPaths: ["go.mod", task, "service_test.go"] }] };
  for (const sample of [python, rust, go]) { check(definition, sample); snapshotDevelopmentTaskSpec(sample); }
});

test("input schema preserves the parser's distinct literal and pattern path grammars", async () => {
  const definition = await schema();
  for (const selected of ["src/{literal}(name)", "src/.git/legacy", "src/**/value?.ts", "**/*.go", "src/[literal"] ) {
    const sample = { ...valid(), write: { allow: [selected], protect: [] } };
    if (selected.includes("[")) { assert.throws(() => check(definition, sample)); assert.throws(() => snapshotDevelopmentTaskSpec(sample)); }
    else { check(definition, sample); snapshotDevelopmentTaskSpec(sample); }
  }
  for (const selected of ["../outside", "/absolute", "src//value", "src/**suffix/x", "src/{a,b}/*.ts", "src/.GIT/*.ts"]) {
    const sample = { ...valid(), write: { allow: [selected], protect: [] } };
    assert.throws(() => check(definition, sample), selected); assert.throws(() => snapshotDevelopmentTaskSpec(sample), selected);
  }
});

test("input schema refuses unsupported fields, invalid expectations and bounded-field violations", async () => {
  const definition = await schema();
  const invalid = [
    { ...valid(), usd: 1 }, { ...valid(), run: "node checks/value.mjs" },
    { ...valid(), objective: " " }, { ...valid(), version: "1" },
    { ...valid(), worker: { model: "other" } }, { ...valid(), worker: { model: "inherit", maxAttempts: 6 } },
    { ...valid(), budget: { ...valid().budget, totalSeconds: 1800.001 } },
    { ...valid(), checks: [{ ...valid().checks[0]!, expect: { baseline: "fail" } }] },
    { ...valid(), checks: [{ ...valid().checks[0]!, expect: { baseline: "pass", failureAssertion: "unused" } }] },
    { ...valid(), checks: [{ ...valid().checks[0]!, args: ["bad\0argument"] }] },
    { ...valid(), checks: [{ ...valid().checks[0]!, timeoutMs: 40001 }] },
    { ...valid(), write: { allow: ["src", "src"], protect: [] } }
  ];
  for (const sample of invalid) { assert.throws(() => check(definition, sample)); assert.throws(() => snapshotDevelopmentTaskSpec(sample)); }
  const expectedFail = { ...valid(), checks: [{ ...valid().checks[0]!, expect: { baseline: "fail", failureAssertion: "value-correct" } }] };
  check(definition, expectedFail); snapshotDevelopmentTaskSpec(expectedFail);
});

test("authoring schema does not pretend to replace cross-field or own-data parser checks", async () => {
  const definition = await schema();
  const sample = { ...valid(), checks: [
    { ...valid().checks[0]!, timeoutMs: 30000 }, { ...valid().checks[0]!, id: "second", timeoutMs: 30000 }
  ] };
  check(definition, sample); assert.throws(() => snapshotDevelopmentTaskSpec(sample), /combined recipe timeout/);
  const fractional = { ...valid(), budget: { ...valid().budget, totalSeconds: 0.0011 } };
  check(definition, fractional); assert.throws(() => snapshotDevelopmentTaskSpec(fractional), /whole millisecond/);
  let reads = 0;
  const accessor = Object.defineProperty(valid(), "objective", { get() { reads++; return "unsafe"; } });
  assert.throws(() => snapshotDevelopmentTaskSpec(accessor)); assert.equal(reads, 0);
  assert.match(JSON.stringify(definition), /runtime|parser/);
});

test("actual Node init draft validates without executing its test command", async () => {
  const definition = await schema();
  const parent = path.resolve(".agent_workspace/phase1-task-schema"); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "fixture-"));
  try {
    await mkdir(path.join(root, "src")); await mkdir(path.join(root, "test"));
    await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test test/value.test.mjs" } }), "utf8");
    await writeFile(path.join(root, "src/value.mjs"), "export const value = 1;\n", "utf8");
    await writeFile(path.join(root, "test/value.test.mjs"), "throw Error('init must not execute this');\n", "utf8");
    let stdout = ""; let stderr = "";
    const exit = await initTaskSpecCommand(["--dir", root, "--json"], { stdout: (text) => { stdout += text; }, stderr: (text) => { stderr += text; } });
    assert.equal(exit, 0, stderr);
    const draft = JSON.parse(await readFile(path.join(root, "sparkle.task.json"), "utf8")) as unknown;
    check(definition, draft); parseDevelopmentTaskSpec(JSON.stringify(draft));
    assert.equal(JSON.parse(stdout).status, "draft");
  } finally {
    assert.equal(path.dirname(root), parent); await rm(root, { recursive: true, force: true });
  }
});
