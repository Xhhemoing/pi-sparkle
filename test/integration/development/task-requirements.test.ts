import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { startDevelopmentTaskSpec, preflightDevelopmentTaskSpec } from "../../../src/development/start-task-spec.js";
import { snapshotDevelopmentTaskSpec } from "../../../src/development/task-spec.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";
function git(cwd: string, ...args: string[]): string { const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); }
const original = "pub fn value() -> u8 { 1 }\n";
const fixed = "pub fn value() -> u8 { 2 }\n";
const writingTest = '#[cfg(test)] mod tests { fn fixture() { std::fs::write("fixture", "data").unwrap(); } }\n';
// Synthetic equivalent of the historical policy's source scan, not a Rust test runner.
const guard = "const fs=require('node:fs');const path=require('node:path');function scan(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,item.name);if(item.isDirectory())scan(p);else if(/std::fs::write\\s*\\(/.test(fs.readFileSync(p,'utf8'))){console.error('source contains filesystem write');process.exitCode=1;}}}scan('src');";
async function fixture(body: (sourceRepo: string, stateRoot: string, sandboxRoot: string) => Promise<void>) {
  const parent = path.resolve(".agent_workspace/phase1-explicit-requirements"); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "fixture-")); const source = path.join(root, "repo");
  try {
    await mkdir(path.join(source, "src"), { recursive: true }); await mkdir(path.join(source, "tests"));
    await writeFile(path.join(source, "src/plan.rs"), original, "utf8");
    await writeFile(path.join(source, "tests/no_write_api.cjs"), guard, "utf8");
    await writeFile(path.join(source, ".gitignore"), ".cache/\n", "utf8");
    git(source, "init"); git(source, "config", "core.autocrlf", "false"); git(source, "config", "user.name", "Requirements fixture"); git(source, "config", "user.email", "fixture@example.invalid");
    git(source, "add", "."); git(source, "-c", "commit.gpgsign=false", "commit", "-m", "fixture");
    await body(source, path.join(root, "state"), path.join(root, "candidates"));
    assert.equal(await readFile(path.join(source, "src/plan.rs"), "utf8"), original);
    assert.equal(await readFile(path.join(source, "tests/no_write_api.cjs"), "utf8"), guard);
    assert.equal(git(source, "status", "--porcelain=v1", "--ignored"), "");
  } finally { assert.equal(path.dirname(root), parent); await rm(root, { recursive: true, force: true }); }
}
function definition() { return { version: 1, objective: "Fix the production value and add the required regression fixture", context: ["src/plan.rs"],
  write: { allow: ["src/plan.rs"], protect: ["tests/no_write_api.cjs"] }, prepare: [],
  checks: [{ id: "no-write-api", command: process.execPath, args: ["tests/no_write_api.cjs"], verifierVersion: "synthetic-policy-v1", protectedPaths: ["tests/no_write_api.cjs"], expect: { baseline: "pass" } }],
  budget: { totalSeconds: 40, prepareSeconds: 10, checkSeconds: 5, workerSeconds: 10 }, worker: { model: "inherit" } }; }

test("a missing explicit prompt reference blocks actual prepare and worker before any model", async () => fixture(async (sourceRepo, stateRoot, sandboxRoot) => {
  const marker = path.join(path.dirname(sourceRepo), "should-not-prepare");
  const spec = snapshotDevelopmentTaskSpec({ ...definition(), objective: "Read [[file:docs/design.md]] before editing", context: [],
    prepare: [{ id: "marker", command: process.execPath, args: ["-e", "require('node:fs').writeFileSync(process.argv[1],'yes')", marker] }] });
  let factories = 0;
  await assert.rejects(startDevelopmentTaskSpec({ sourceRepo, stateRoot, sandboxRoot, spec,
    executorFactory: () => { factories++; return new ProtocolChildExecutor(); } }), /required file docs\/design\.md unavailable/);
  assert.equal(factories, 0);
  await assert.rejects(readFile(marker), { code: "ENOENT" });
}));
test("restored explicit prompt input is actually rendered to the worker and preflight passes", async () => fixture(async (sourceRepo, stateRoot, sandboxRoot) => {
  await mkdir(path.join(sourceRepo, "docs")); await writeFile(path.join(sourceRepo, "docs/design.md"), "REQUIRED_DESIGN_BODY", "utf8");
  git(sourceRepo, "add", "docs/design.md"); git(sourceRepo, "-c", "commit.gpgsign=false", "commit", "-m", "reference");
  let observed = "";
  const result = await startDevelopmentTaskSpec({ sourceRepo, stateRoot, sandboxRoot,
    spec: snapshotDevelopmentTaskSpec({ ...definition(), objective: "Use [[file:docs/design.md]]", context: [] }),
    executorFactory(context) { observed = context.objective; return new ProtocolChildExecutor(); } });
  assert.equal(result.preflight?.ok, true);
  assert.equal(result.execution.acceptance.accepted, true, result.execution.reason);
  assert.match(observed, /REQUIRED_DESIGN_BODY/);
}));
test("explicit required regression placement detects the old one-file scope before preparing", async () => fixture(async (sourceRepo, stateRoot, sandboxRoot) => {
  const source = definition();
  await assert.rejects(preflightDevelopmentTaskSpec({ sourceRepo, stateRoot, sandboxRoot,
    spec: { ...source, write: { ...source.write, require: ["tests/destination_feasibility.rs"] } } as unknown as ReturnType<typeof snapshotDevelopmentTaskSpec> }), /required.*writ|protected/);
  await assert.rejects(readFile(path.join(sourceRepo, "tests/destination_feasibility.rs")), { code: "ENOENT" });
  const fixedSpec = snapshotDevelopmentTaskSpec({ ...source,
    write: { ...source.write, allow: ["src/plan.rs", "tests/destination_feasibility.rs"], require: ["tests/destination_feasibility.rs"] } });
  const result = await preflightDevelopmentTaskSpec({ sourceRepo, stateRoot, sandboxRoot, spec: fixedSpec });
  assert.equal(result.ok, true, result.reason); assert.equal(result.effectsSettled, true);
}));
for (const placement of ["production-only", "source-fixture", "integration-fixture"] as const) {
  test(`actual protected policy distinguishes ${placement} without weakening its scan`, async () => fixture(async (sourceRepo, stateRoot, sandboxRoot) => {
    const source = definition();
    const spec = snapshotDevelopmentTaskSpec({ ...source, write: { ...source.write,
      ...(placement === "integration-fixture" ? { allow: ["src/plan.rs", "tests/destination_feasibility.rs"], require: ["tests/destination_feasibility.rs"] } : {}) } });
    const result = await startDevelopmentTaskSpec({ sourceRepo, stateRoot, sandboxRoot, spec,
      executorFactory(context) { return { async *execute(request, signal) {
        const write = context.tools.find(tool => tool.name === "sparkle_write_file")!;
        await write.execute("production", { path: "src/plan.rs", contents: fixed + (placement === "source-fixture" ? writingTest : "") }, signal);
        if (placement === "integration-fixture") await write.execute("fixture", { path: "tests/destination_feasibility.rs", contents: writingTest }, signal);
        yield* new ProtocolChildExecutor().execute(request, signal);
      } }; } });
    assert.equal(result.preflight?.ok, true);
    assert.equal(result.execution.acceptance.accepted, placement !== "source-fixture", result.execution.reason);
    assert.equal(await readFile(path.join(result.execution.candidatePath, "tests/no_write_api.cjs"), "utf8"), guard);
  }));
}
