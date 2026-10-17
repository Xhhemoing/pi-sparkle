import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main } from "../../../src/cli/main.js";
import { runtimeRoot } from "../../../src/privacy/state-layout.js";
import { ActionLedger } from "../../../src/development/action-ledger.js";
import { WorkItemStore } from "../../../src/development/work-item-store.js";
import { developmentCommand, developmentPiTools } from "../../../src/cli/development.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";
import { createWorktreeCodingTools } from "../../../src/pi-adapter/worktree-coding-tools.js";

async function call(args: string[]) {
  let stdout = "", stderr = "";
  const code = await main(["develop", ...args], { stdout: (value) => { stdout += value; }, stderr: (value) => { stderr += value; } });
  return { code, stdout, stderr };
}
async function fixture(body: (value: { root: string; project: string; state: string; file: string; queue: string; base: string[] }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "sparkle-development-cli-"));
  const project = join(root, "project"), state = join(root, "state"), file = join(root, "tasks.json");
  await mkdir(project);
  for (const args of [["init"], ["config", "user.name", "CLI fixture"], ["config", "user.email", "fixture@example.invalid"]]) {
    assert.equal(spawnSync("git", args, { cwd: project }).status, 0);
  }
  await writeFile(join(project, "value.txt"), "already-satisfied");
  assert.equal(spawnSync("git", ["add", "."], { cwd: project }).status, 0);
  assert.equal(spawnSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"], { cwd: project }).status, 0);
  await writeFile(file, JSON.stringify({ id: "demo", authorityRef: "host:cli-test", items: [{ id: "check", goal: "Confirm existing value", dependencies: [], allowedScope: ["value.txt"], priority: 50,
    acceptance: [{ id: "value", command: process.execPath, args: ["-e", "if(require('node:fs').readFileSync('value.txt','utf8')!=='already-satisfied') process.exit(1)"], verifierVersion: "v1" }] }] }));
  try { await body({ root, project, state, file, queue: join(runtimeRoot(state), "development", "demo", "queue.json"), base: ["--queue", "demo", "--project", project, "--state-root", state, "--json"] }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("develop help is explicit about modes and host recovery", async () => {
  const result = await call(["--help"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /init|status|candidates/);
  assert.match(result.stdout, /fake.*no LLM.*no writes/i);
  assert.match(result.stdout, /reconcile/);
  assert.match(result.stdout, /release/);
});

test("init validates bounded host definitions without running their checker", async () => fixture(async ({ file, state, queue, base, root }) => {
  const marker = join(root, "must-not-exist");
  const definition = JSON.parse(await readFile(file, "utf8"));
  definition.items[0].acceptance[0].args = ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad')`];
  await writeFile(file, JSON.stringify(definition));
  const result = await call(["init", "--file", file, "--queue", "demo", "--state-root", state, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "initialized");
  await assert.rejects(readFile(marker), { code: "ENOENT" });
  assert.equal((await new WorkItemStore(queue).load()).items[0]?.status, "planned");
  assert.equal(JSON.parse((await call(["next", ...base])).stdout).item.id, "check");
}));

test("invalid flags fail before queue state changes", async () => fixture(async ({ file, state, base, queue }) => {
  await call(["init", "--file", file, "--queue", "demo", "--state-root", state]);
  const before = await readFile(queue, "utf8");
  for (const flags of [["--max-attempts", "6"], ["--max-wall-time-ms", "1e3"], ["--executor", "bad"], ["--model", "bad"], ["--unknown"], ["--file", file]]) {
    const result = await call(["run", ...base, "--executor", "fake", ...flags]);
    assert.notEqual(result.code, 0, flags.join(" "));
    assert.equal(await readFile(queue, "utf8"), before);
  }
}));

test("init rejects unsafe queue ids and oversized files without creating state", async () => fixture(async ({ file, state }) => {
  assert.notEqual((await call(["init", "--file", file, "--queue", "../escape", "--state-root", state])).code, 0);
  await writeFile(file, " ".repeat(1_048_577));
  const oversized = await call(["init", "--file", file, "--queue", "demo", "--state-root", state]);
  assert.notEqual(oversized.code, 0);
  assert.match(oversized.stderr, /1 MiB/);
  await assert.rejects(readFile(join(runtimeRoot(state), "development", "demo", "queue.json")), { code: "ENOENT" });
}));

test("fake run verifies existing contents, lists candidate and requires explicit host acceptance", async () => fixture(async ({ file, state, base, project }) => {
  await call(["init", "--file", file, "--queue", "demo", "--state-root", state]);
  const run = await call(["run", ...base, "--executor", "fake"]);
  assert.equal(run.code, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.mode, "fake");
  assert.equal(result.status, "ready-for-review");
  assert.deepEqual(result.limits, { maxAttempts: 3, maxWallTimeMs: 600000 });
  assert.match(run.stderr, /no LLM.*no writes/i);
  const candidates = JSON.parse((await call(["candidates", ...base])).stdout).candidates;
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].candidatePath, result.candidatePath);
  assert.equal(candidates[0].actionState, "completed");
  assert.equal(candidates[0].mode, "fake");
  const reconciled = await call(["reconcile", ...base, "--action", result.actionId]);
  assert.equal(reconciled.code, 0, reconciled.stderr);
  assert.equal(JSON.parse(reconciled.stdout).candidatePath, result.candidatePath);
  assert.equal(JSON.parse((await call(["status", ...base])).stdout).queue.items[0].status, "ready-for-review");
  assert.equal((await call(["accept", ...base, "--item", "check"])).code, 0);
  assert.equal(JSON.parse((await call(["status", ...base])).stdout).queue.items[0].status, "accepted");
  assert.equal(await readFile(join(project, "value.txt"), "utf8"), "already-satisfied");
}));

test("fake mode cannot satisfy a missing change from its own success report", async () => fixture(async ({ file, state, base, project }) => {
  const definition = JSON.parse(await readFile(file, "utf8"));
  definition.items[0].acceptance[0].args = ["-e", "process.exit(1)"];
  await writeFile(file, JSON.stringify(definition));
  await call(["init", "--file", file, "--queue", "demo", "--state-root", state]);
  const result = await call(["run", ...base, "--executor", "fake", "--max-attempts", "1"]);
  assert.equal(result.code, 1);
  assert.equal(JSON.parse(result.stdout).status, "blocked");
  assert.notEqual((await call(["accept", ...base, "--item", "check"])).code, 0);
  assert.equal(await readFile(join(project, "value.txt"), "utf8"), "already-satisfied");
}));

test("Pi command wiring passes only host scoped tools and supports a real fixture write without live calls", async () => fixture(async ({ file, state, base, project }) => {
  const definition = JSON.parse(await readFile(file, "utf8"));
  definition.items[0].acceptance[0].args = ["-e", "if(require('node:fs').readFileSync('value.txt','utf8')!=='changed') process.exit(1)"];
  await writeFile(file, JSON.stringify(definition));
  await call(["init", "--file", file, "--queue", "demo", "--state-root", state]);
  let stdout = "", stderr = "", calls = 0;
  const code = await developmentCommand(["run", ...base, "--executor", "pi", "--model", "fixture/model"], {
    stdout: (value) => { stdout += value; }, stderr: (value) => { stderr += value; }
  }, { createPiExecutor: async (options) => {
    calls++;
    assert.equal(options.providerId, "fixture"); assert.equal(options.modelId, "model");
    assert.equal(typeof options.onInvocation, "function");
    assert.deepEqual(options.tools?.map((tool) => tool.name), ["sparkle_read_file", "sparkle_write_file"]);
    return { async *execute(request, signal) {
      await options.tools!.find((tool) => tool.name === "sparkle_write_file")!.execute("fixture-write", { path: "value.txt", contents: "changed" }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    } };
  } });
  assert.equal(code, 0, stderr);
  const result = JSON.parse(stdout);
  assert.equal(result.mode, "pi"); assert.equal(result.status, "ready-for-review");
  assert.equal(calls, 1);
  assert.equal(await readFile(join(result.candidatePath, "value.txt"), "utf8"), "changed");
  assert.equal(await readFile(join(project, "value.txt"), "utf8"), "already-satisfied");
}));

test("Pi tool adapter preserves supplied scope closures and refuses incomplete descriptors", () => {
  const supplied = createWorktreeCodingTools({ worktreeRoot: "/unused" });
  const allowed = developmentPiTools(supplied);
  assert.equal(allowed[0], supplied[0]); assert.equal(allowed[1], supplied[1]);
  assert.equal(allowed.some((tool) => tool.name === "sparkle_run_command"), false);
  assert.throws(() => developmentPiTools([{ name: "sparkle_read_file", execute: async () => undefined }]), /descriptor/);
});

test("running unknown actions require reconciliation; release only invalidates the task claim", async () => fixture(async ({ file, state, base, queue, project }) => {
  await call(["init", "--file", file, "--queue", "demo", "--state-root", state]);
  const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: project, encoding: "utf8" }).stdout.trim();
  const store = new WorkItemStore(queue);
  const claim = await store.claimNext({ owner: "fixture", baseRevision: revision });
  const ledger = new ActionLedger(join(runtimeRoot(state), "development", "demo", "actions"));
  const action = await ledger.prepare({ idempotencyKey: "unknown", kind: "candidate-write", input: { itemId: claim!.item.id } });
  await ledger.claim(action.actionId, action.version);
  const reconcile = await call(["reconcile", ...base, "--action", action.actionId]);
  assert.equal(JSON.parse(reconcile.stdout).status, "needs-reconciliation");
  assert.notEqual(reconcile.code, 0);
  const released = await call(["release", ...base, "--item", "check"]);
  assert.equal(released.code, 0, released.stderr);
  assert.match(released.stderr, /unknown.*remain/i);
  assert.equal((await store.load()).items[0]?.status, "planned");
  assert.equal((await ledger.get(action.actionId))?.state, "running");
}));
