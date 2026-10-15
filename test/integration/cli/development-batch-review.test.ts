import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { developmentCommand, type DevelopmentCommandDependencies } from "../../../src/cli/development.js";
import { runtimeRoot } from "../../../src/privacy/state-layout.js";
import { WorkItemStore } from "../../../src/development/work-item-store.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";
import { ActionLedger } from "../../../src/development/action-ledger.js";

async function call(args: string[], dependencies: DevelopmentCommandDependencies = {}) {
  let stdout = "", stderr = "";
  const code = await developmentCommand(args, { stdout: (value) => { stdout += value; }, stderr: (value) => { stderr += value; } }, dependencies);
  return { code, stdout, stderr };
}
function git(project: string, args: string[]) {
  const result = spawnSync("git", args, { cwd: project, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
async function fixture(body: (value: { project: string; state: string; file: string; queuePath: string; base: string[] }) => Promise<void>, expected = "initial") {
  const root = await mkdtemp(join(tmpdir(), "sparkle-batch-cli-"));
  const project = join(root, "project"), state = join(root, "state"), file = join(root, "items.json");
  await mkdir(project);
  git(project, ["init"]); git(project, ["config", "user.name", "Batch CLI fixture"]);
  git(project, ["config", "user.email", "fixture@example.invalid"]);
  await writeFile(join(project, "a.txt"), "initial"); await writeFile(join(project, "b.txt"), "initial");
  git(project, ["add", "."]); git(project, ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
  await writeFile(file, JSON.stringify({ id: "batch", authorityRef: "host:batch-cli", items: ["a", "b"].map((id) => ({
    id, goal: `Verify ${id}.txt`, dependencies: [], allowedScope: [`${id}.txt`], priority: id === "a" ? 100 : 50,
    acceptance: [{ id: `check-${id}`, command: process.execPath,
      args: ["-e", `if(require('node:fs').readFileSync('${id}.txt','utf8')!==${JSON.stringify(expected)})process.exit(1)`], verifierVersion: "v1" }]
  })) }));
  const queuePath = join(runtimeRoot(state), "development", "batch", "queue.json");
  const base = ["--queue", "batch", "--project", project, "--state-root", state, "--json"];
  try {
    const initialized = await call(["init", "--queue", "batch", "--state-root", state, "--file", file, "--json"]);
    assert.equal(initialized.code, 0, initialized.stderr);
    await body({ project, state, file, queuePath, base });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("batch and review help are additive and describe shared bounded execution", async () => {
  const result = await call(["--help"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /develop batch .*--max-items/);
  assert.match(result.stdout, /--max-total-wall-time-ms/);
  assert.match(result.stdout, /develop review .*--action/);
  assert.match(result.stdout, /run defaults to 3 attempts \/ 600000 ms/);
});

test("batch requires bounded max-items and validates every flag before queue mutation", async () => fixture(async ({ base, queuePath }) => {
  const before = await readFile(queuePath, "utf8");
  for (const flags of [[], ["--max-items", "0"], ["--max-items", "9"], ["--max-items", "1e0"],
    ["--max-items", "2", "--max-total-wall-time-ms", "1800001"], ["--max-items", "2", "--max-total-wall-time-ms", "0"],
    ["--max-items", "2", "--max-wall-time-ms", "NaN"], ["--max-items", "2", "--max-attempts", "6"],
    ["--max-items", "2", "--action", "ignored"], ["--max-items", "1", "--max-items", "2"]]) {
    const result = await call(["batch", ...base, "--executor", "fake", ...flags]);
    assert.equal(result.code, 1, flags.join(" "));
    assert.equal(JSON.parse(result.stdout).type, "DEVELOPMENT_BATCH_RESULT");
    assert.equal(await readFile(queuePath, "utf8"), before);
  }
  const missingExecutor = await call(["batch", ...base, "--max-items", "2"]);
  assert.equal(missingExecutor.code, 1);
  assert.equal(await readFile(queuePath, "utf8"), before);
}));

test("fake batch retains two independent candidates without accepting or applying them", async () => fixture(async ({ base, queuePath, project }) => {
  const result = await call(["batch", ...base, "--executor", "fake", "--max-items", "2"]);
  assert.equal(result.code, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.type, "DEVELOPMENT_BATCH_RESULT"); assert.equal(output.command, "batch");
  assert.equal(output.mode, "fake"); assert.equal(output.stopReason, "max-items");
  assert.deepEqual(output.limits, { maxItems: 2, maxWallTimeMs: 600000, maxAttempts: 3, perItemWallTimeMs: 600000 });
  assert.equal(output.results.length, 2);
  assert.notEqual(output.results[0].candidatePath, output.results[1].candidatePath);
  assert.match(result.stderr, /no LLM.*no writes/);
  assert.deepEqual((await new WorkItemStore(queuePath).load()).items.map((item) => item.status), ["ready-for-review", "ready-for-review"]);
  assert.equal(git(project, ["status", "--porcelain"]), "");
}));

test("blocked first item stops a batch and leaves the next item unclaimed", async () => fixture(async ({ base, queuePath }) => {
  const result = await call(["batch", ...base, "--executor", "fake", "--max-items", "2", "--max-attempts", "1"]);
  assert.equal(result.code, 1, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.type, "DEVELOPMENT_BATCH_RESULT"); assert.equal(output.stopReason, "blocked");
  assert.equal(output.results.length, 1);
  assert.deepEqual((await new WorkItemStore(queuePath).load()).items.map((item) => item.status), ["blocked", "planned"]);
}, "missing-change"));

test("old run keeps its exact envelope and rejects batch-only flags before claiming", async () => fixture(async ({ base, queuePath }) => {
  const before = await readFile(queuePath, "utf8");
  const invalid = await call(["run", ...base, "--executor", "fake", "--max-items", "2"]);
  assert.equal(invalid.code, 1);
  assert.equal(JSON.parse(invalid.stdout).type, "DEVELOPMENT_RESULT");
  assert.equal(await readFile(queuePath, "utf8"), before);
  const result = await call(["run", ...base, "--executor", "fake"]);
  assert.equal(result.code, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(output).sort(), ["actionId", "candidatePath", "command", "itemId", "limits", "mode", "queueId", "status", "type"]);
  assert.equal(output.type, "DEVELOPMENT_RESULT"); assert.equal(output.command, "run");
  assert.deepEqual(output.limits, { maxAttempts: 3, maxWallTimeMs: 600000 });
}));

test("review reads completed evidence without changing queue, actions, source or invoking a model", async () => fixture(async ({ base, queuePath, project }) => {
  const run = await call(["run", ...base, "--executor", "fake"]);
  assert.equal(run.code, 0, run.stderr);
  const actionId = JSON.parse(run.stdout).actionId;
  const actionsPath = join(dirname(queuePath), "actions", "actions.json");
  const beforeQueue = await readFile(queuePath, "utf8"), beforeActions = await readFile(actionsPath, "utf8");
  const result = await call(["review", ...base, "--action", actionId], { createPiExecutor: async () => { throw new Error("review must not invoke a model"); } });
  assert.equal(result.code, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.type, "DEVELOPMENT_RESULT"); assert.equal(output.command, "review");
  assert.equal(output.actionId, actionId);
  assert.equal(output.historicalOnly, true); assert.equal(output.reverified, false); assert.equal(output.sourceApplied, false);
  assert.equal(output.evidenceStatus, "available"); assert.equal(output.attempts.length, 1);
  assert.equal(await readFile(queuePath, "utf8"), beforeQueue);
  assert.equal(await readFile(actionsPath, "utf8"), beforeActions);
  assert.equal(git(project, ["status", "--porcelain"]), "");
}));

test("Pi batch reuses model options and scoped tools for real fixture writes without live calls", async () => fixture(async ({ base, project }) => {
  let calls = 0, active = 0, maximumActive = 0;
  const result = await call(["batch", ...base, "--executor", "pi", "--model", "fixture/model", "--max-items", "2"], {
    createPiExecutor: async (options) => {
      const file = `${calls++ === 0 ? "a" : "b"}.txt`;
      assert.equal(options.providerId, "fixture"); assert.equal(options.modelId, "model");
      assert.equal(typeof options.onInvocation, "function");
      assert.deepEqual(options.tools?.map((tool) => tool.name), ["sparkle_read_file", "sparkle_write_file"]);
      return { async *execute(request, signal) {
        active++; maximumActive = Math.max(maximumActive, active);
        try {
          await options.tools!.find((tool) => tool.name === "sparkle_write_file")!.execute("fixture", { path: file, contents: "changed" }, signal);
          yield* new ProtocolChildExecutor().execute(request, signal);
        } finally { active--; }
      } };
    }
  });
  assert.equal(result.code, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.type, "DEVELOPMENT_BATCH_RESULT"); assert.equal(output.mode, "pi");
  assert.equal(output.results.length, 2); assert.equal(calls, 2); assert.equal(maximumActive, 1);
  assert.equal(await readFile(join(project, "a.txt"), "utf8"), "initial");
  assert.equal(await readFile(join(project, "b.txt"), "utf8"), "initial");
}, "changed"));

test("batch no-ready stop is successful and records only executed items", async () => fixture(async ({ base }) => {
  const result = await call(["batch", ...base, "--executor", "fake", "--max-items", "3"]);
  assert.equal(result.code, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.stopReason, "no-ready-task"); assert.equal(output.results.length, 2);
}));

test("batch refuses unknown running effects without claiming queue work", async () => fixture(async ({ base, queuePath }) => {
  const ledger = new ActionLedger(join(dirname(queuePath), "actions"));
  const action = await ledger.prepare({ idempotencyKey: "unknown-cli-effect", kind: "candidate-write", input: { source: "test" } });
  await ledger.claim(action.actionId, action.version);
  const beforeQueue = await readFile(queuePath, "utf8");
  const result = await call(["batch", ...base, "--executor", "fake", "--max-items", "2"]);
  assert.equal(result.code, 1, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.stopReason, "needs-reconciliation"); assert.deepEqual(output.results, []);
  assert.equal(await readFile(queuePath, "utf8"), beforeQueue);
  assert.equal((await ledger.get(action.actionId))?.state, "running");
}));

test("batch process cancellation reaches the executor and restores signal handlers", async () => fixture(async ({ base, queuePath }) => {
  let calls = 0;
  const initialInt = process.listenerCount("SIGINT"), initialTerm = process.listenerCount("SIGTERM");
  const result = await call(["batch", ...base, "--executor", "pi", "--model", "fixture/model", "--max-items", "2"], {
    createPiExecutor: async () => ({ async *execute(request, signal) {
      calls++; process.emit("SIGTERM");
      assert.equal(signal.aborted, true);
      yield* new ProtocolChildExecutor().execute(request, signal);
    } })
  });
  assert.equal(result.code, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).stopReason, "cancelled"); assert.equal(calls, 1);
  assert.equal(process.listenerCount("SIGINT"), initialInt); assert.equal(process.listenerCount("SIGTERM"), initialTerm);
  assert.equal((await new WorkItemStore(queuePath).load()).items[1]?.status, "planned");
}));

test("review rejects execution flags and invalid action ids without touching the queue", async () => fixture(async ({ base, queuePath }) => {
  const before = await readFile(queuePath, "utf8");
  for (const flags of [["--action", "bad"], ["--executor", "fake"], ["--max-items", "1"], []]) {
    const result = await call(["review", ...base, ...flags]);
    assert.equal(result.code, 1); assert.equal(JSON.parse(result.stdout).type, "DEVELOPMENT_RESULT");
    assert.equal(await readFile(queuePath, "utf8"), before);
  }
}));
