import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { test } from "node:test";
import { createWorktreeCodingTools } from "../../../src/pi-adapter/worktree-coding-tools.js";
import { DevelopmentController } from "../../../src/development/controller.js";
import { WorkItemStore } from "../../../src/development/work-item-store.js";
import { createWorkQueue, type WorkItemDefinition } from "../../../src/development/work-items.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function definition(id = "change", scope = "value.txt", priority = 100): WorkItemDefinition {
  return { id, allowedScope: [scope], priority, dependencies: [], goal: `Complete ${id}`,
    acceptance: [{ id: "check", command: process.execPath, args: ["-e", "process.exit(0)"], verifierVersion: "v1" }] };
}
interface Fixture { root: string; sourceRepo: string; queuePath: string; stateRoot: string; }
async function fixture(body: (value: Fixture) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "sparkle-controller-admission-"));
  const sourceRepo = path.join(root, "source");
  try {
    await mkdir(sourceRepo);
    git(sourceRepo, ["init"]); git(sourceRepo, ["config", "user.name", "Admission fixture"]);
    git(sourceRepo, ["config", "user.email", "fixture@example.invalid"]);
    await writeFile(path.join(sourceRepo, "value.txt"), "before");
    await writeFile(path.join(sourceRepo, "independent.txt"), "independent baseline");
    git(sourceRepo, ["add", "."]); git(sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
    const queuePath = path.join(root, "queue.json"), stateRoot = path.join(root, "state");
    await new WorkItemStore(queuePath).create(createWorkQueue({ id: "fixture", authorityRef: "host:test", items: [definition()] }));
    await body({ root, sourceRepo, queuePath, stateRoot });
  } finally { await rm(root, { recursive: true, force: true }); }
}
function holdingCheck(root: string): { item: WorkItemDefinition; ready: string; release: string } {
  const ready = path.join(root, "checker-ready"), release = path.join(root, "checker-release");
  const script = `const fs=require('node:fs'); fs.appendFileSync(${JSON.stringify(ready)},process.pid+'\\n');
    const interval=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)})){clearInterval(interval);process.exit(0)}},10);
    setTimeout(()=>process.exit(99),8000).unref();`;
  const base = definition();
  return { item: { ...base, acceptance: [{ ...base.acceptance[0]!, args: ["-e", script], timeoutMs: 10_000 }] }, ready, release };
}
async function waitReady(file: string): Promise<void> {
  for (let index = 0; index < 250; index++) {
    try { await readFile(file); return; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await pause(20);
  }
  throw Error("bounded checker fixture never became ready");
}
function invokeCheck(controller: DevelopmentController, item: WorkItemDefinition, cwd: string): Promise<unknown> {
  // Exercise the real controller checker path without preparing model work.
  return (controller as unknown as { checkWorkspace(item: WorkItemDefinition, cwd: string): Promise<unknown> }).checkWorkspace(item, cwd);
}

test("two controllers cannot dispatch overlapping real checker processes", async () => fixture(async (value) => {
  const left = new DevelopmentController({ ...value, owner: "same-host" });
  const right = new DevelopmentController({ ...value, owner: "same-host" });
  const check = holdingCheck(value.root);
  const settled = Promise.allSettled([invokeCheck(left, check.item, value.sourceRepo), invokeCheck(right, check.item, value.sourceRepo)]);
  try { await waitReady(check.ready); }
  finally { await writeFile(check.release, "release"); await settled; }
  const results = await settled;
  assert.equal(results.filter((entry) => entry.status === "fulfilled").length, 1);
  const refused = results.find((entry) => entry.status === "rejected");
  assert.ok(refused?.status === "rejected");
  assert.match(String(refused.reason), /reconciliation|overlap/);
  assert.equal((await readFile(check.ready, "utf8")).trim().split("\n").length, 1);
  const actions = await left.ledger.list();
  assert.equal(actions.length, 1);
  assert.equal(actions[0]!.state, "completed");
}));

test("a checker admitted after writer advisory reads prevents worker dispatch", async () => fixture(async (value) => {
  let factories = 0;
  const writer = new DevelopmentController({ ...value, owner: "writer", executorFactory: () => { factories++; return new ProtocolChildExecutor(); } });
  const checker = new DevelopmentController({ ...value, owner: "checker" });
  const check = holdingCheck(value.root);
  let checked: Promise<unknown> | undefined;
  const admit = writer.ledger.admit.bind(writer.ledger);
  writer.ledger.admit = async (...args) => {
    if (args[0].kind === "candidate-write") {
      checked = invokeCheck(checker, check.item, value.sourceRepo);
      // Attach rejection immediately; cleanup below still awaits the original.
      void checked.catch(() => undefined);
      await waitReady(check.ready);
    }
    return admit(...args);
  };
  try {
    const result = await writer.runNext();
    assert.equal(result.status, "blocked");
    assert.match(result.reason!, /reconciliation|overlap/);
    assert.equal(factories, 0);
    assert.equal((await writer.ledger.list()).filter((record) => record.kind === "candidate-write").length, 0);
  } finally { await writeFile(check.release, "release"); await checked; }
}));

test("uncertain accepted A fences its dependents and overlaps while controller advances independent B", async () => fixture(async (value) => {
  await rm(value.queuePath);
  const a = definition("a");
  await new WorkItemStore(value.queuePath).create(createWorkQueue({ id: "fixture", authorityRef: "host:test", items: [a,
    { ...definition("dependent", "dependent.txt", 90), dependencies: ["a"] },
    definition("overlap", "value.txt", 80), definition("b", "independent.txt", 10)] }));
  let factories = 0;
  const controller = new DevelopmentController({ ...value, owner: "host", executorFactory: () => { factories++; return new ProtocolChildExecutor(); } });
  assert.equal((await controller.runNext()).itemId, "a");
  await controller.accept("a");
  const unresolved = await controller.ledger.prepare({ idempotencyKey: "host:uncertain-recheck", kind: "candidate-check",
    input: { itemId: "a", definition: a } });
  const claim = await controller.ledger.claim(unresolved.actionId, unresolved.version);
  await controller.ledger.markUncertain(claim, { evidence: { summary: "Host has not established checker settlement", references: ["host:checker"] } });
  const result = await controller.runNext();
  assert.equal(result.status, "ready-for-review", JSON.stringify(result));
  assert.equal(result.itemId, "b");
  assert.equal(factories, 2);
  const queue = await controller.store.load();
  for (const id of ["dependent", "overlap"]) assert.equal(queue.items.find((record) => record.definition.id === id)!.status, "planned");
  assert.equal((await controller.ledger.get(unresolved.actionId))!.state, "needs-reconciliation");
}));

for (const scope of ["src/*", "src/?", "src/[ab]", "disk:path", ".git/config", "\0", " ", "x".repeat(257)]) {
  test(`malformed legacy checker scope ${JSON.stringify(scope)} cannot prove disjointness`, async () => fixture(async (value) => {
    let factories = 0;
    const controller = new DevelopmentController({ ...value, owner: "host", executorFactory: () => { factories++; return new ProtocolChildExecutor(); } });
    const action = await controller.ledger.prepare({ idempotencyKey: "legacy:malformed", kind: "candidate-check",
      input: { itemId: "other", definition: { allowedScope: [scope] } } });
    await controller.ledger.claim(action.actionId, action.version);
    const result = await controller.runNext();
    assert.equal(result.status, "needs-reconciliation", JSON.stringify(result));
    assert.equal(factories, 0);
    assert.equal((await controller.ledger.list()).length, 1);
  }));
}

test("generic command uncertainty survives swallowed tool failure and controller restart", async () => fixture(async (value) => {
  const checked = path.join(value.root, "checker-ran");
  const item = definition();
  await rm(value.queuePath);
  await new WorkItemStore(value.queuePath).create(createWorkQueue({ id: "fixture", authorityRef: "host:test",
    items: [{ ...item, acceptance: [{ ...item.acceptance[0]!, args: ["-e",
      `require('node:fs').writeFileSync(${JSON.stringify(checked)},'checked')`] }] }, definition("overlap")] }));
  let swallowedErrors = 0;
  const controller = new DevelopmentController({ ...value, owner: "host", executorFactory: (context) => {
    const command = createWorktreeCodingTools({ ...context, worktreeRoot: context.candidatePath,
      commandPolicy: { allow: [{ executable: "node", argvPrefix: ["-e"] }], timeoutMs: 1_000 }
    }).find((tool) => tool.name === "sparkle_run_command")!;
    const later = createWorktreeCodingTools({ ...context, worktreeRoot: context.candidatePath,
      commandPolicy: { allow: [{ executable: "node", argvPrefix: ["-e"] }], timeoutMs: 30_000 }
    }).find((tool) => tool.name === "sparkle_run_command")!;
    return { async *execute(request, signal) {
      try { await command.execute("unknown", { command: "node", args: ["-e", "setInterval(()=>{},1000)"] }); }
      catch { swallowedErrors++; } // Pi may convert a tool exception to model-visible text.
      await later.execute("later-success", { command: "node", args: ["-e", "process.exit(0)"] });
      yield* new ProtocolChildExecutor().execute(request, signal);
    } };
  } });
  const result = await controller.runNext({ maxAttempts: 2 });
  assert.equal(swallowedErrors, 1);
  assert.equal(result.status, "needs-reconciliation");
  assert.ok(result.candidatePath);
  assert.equal(await readFile(path.join(result.candidatePath, "value.txt"), "utf8"), "before");
  assert.equal(await readFile(path.join(value.sourceRepo, "value.txt"), "utf8"), "before");
  const actions = await controller.ledger.list();
  assert.equal(actions.length, 1, "uncertainty must prevent host checks and repairs");
  assert.equal(actions[0]!.state, "needs-reconciliation");
  const failure = JSON.parse(await readFile(actions[0]!.history.at(-1)!.evidence!.references[0]!, "utf8"));
  assert.equal(failure.body.kind, "native-write-failure");
  assert.equal(failure.body.processCleanup.settled, false);
  assert.equal(failure.body.processCleanup.status, "timed_out");
  assert.equal("stdoutText" in failure.body.processCleanup, false);
  await assert.rejects(() => readFile(checked), { code: "ENOENT" });
  assert.equal((await new WorkItemStore(value.queuePath).load()).items[0]!.status, "running");
  const restarted = new DevelopmentController({ ...value, owner: "restart", executorFactory: () => {
    assert.fail("unreconciled writer must not dispatch again");
  } });
  assert.equal((await restarted.ledger.list())[0]!.state, "needs-reconciliation");
  assert.equal((await restarted.runNext()).status, "no-ready-task");
  assert.equal((await new WorkItemStore(value.queuePath).load()).items[1]!.status, "planned");
  assert.equal((await restarted.ledger.list()).length, 1);
}));
