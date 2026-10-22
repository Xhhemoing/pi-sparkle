import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { advanceProject, type AdvanceProjectInput } from "../../../src/development/advance-project.js";
import { DevelopmentController, type DevelopmentResult } from "../../../src/development/controller.js";
import { createWorkQueue, type WorkItemDefinition } from "../../../src/development/work-items.js";
import type { NativeWriteExecutorFactory } from "../../../src/native/write-session.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function item(id: string, dependencies: readonly string[] = [], scope = `${id}.txt`): WorkItemDefinition {
  return { id, goal: `Repair ${id}`, dependencies, allowedScope: [scope], priority: id === "a" ? 90 : 80,
    acceptance: [{ id, command: process.execPath, args: ["-e",
      `if(require('node:fs').readFileSync('${scope}','utf8')!=='after') process.exit(1)`], verifierVersion: "v1" }] };
}
async function fixture(items: readonly WorkItemDefinition[], body: (value: {
  controller: DevelopmentController; other: DevelopmentController; source: string;
  calls: () => readonly string[]; useExecutor: (factory: NativeWriteExecutorFactory) => void;
}) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "sparkle-advance-"));
  const source = path.join(root, "source");
  try {
    await mkdir(source);
    git(source, ["init"]); git(source, ["config", "user.name", "Advance fixture"]);
    git(source, ["config", "user.email", "fixture@example.invalid"]);
    for (const id of ["a", "b", "c"]) await writeFile(path.join(source, `${id}.txt`), "before", "utf8");
    git(source, ["add", "."]); git(source, ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
    const calls: string[] = [];
    let executor: NativeWriteExecutorFactory = ({ tools, acceptanceCriteria }) => ({ async *execute(request, signal) {
      const id = acceptanceCriteria![0]!.id;
      await tools.find((tool) => tool.name === "sparkle_write_file")!.execute("write", { path: `${id}.txt`, contents: "after" }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    } });
    const options = { sourceRepo: source, queuePath: path.join(root, "queue.json"), stateRoot: path.join(root, "state"),
      sandboxRoot: path.join(root, "candidates"), executorFactory: ((context) => {
        calls.push(context.acceptanceCriteria![0]!.id); return executor(context);
      }) satisfies NativeWriteExecutorFactory };
    const controller = new DevelopmentController({ ...options, owner: "host:left" });
    const other = new DevelopmentController({ ...options, owner: "host:right" });
    await controller.store.create(createWorkQueue({ id: "advance", authorityRef: "host:test", items }));
    await body({ controller, other, source, calls: () => calls, useExecutor: (factory) => { executor = factory; } });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("one advance retains the original candidate result and detached review progress without changing source", async () => fixture([item("a"), item("b")], async ({ controller, source, calls }) => {
  const revision = controller.currentSourceRevision();
  const run = controller.runNext.bind(controller);
  let original: DevelopmentResult | undefined;
  controller.runNext = async (input) => { original = await run(input); return original; };
  const value = await advanceProject(controller, { maxWallTimeMs: 30_000 });
  assert.strictEqual(value.result, original);
  assert.equal(value.result?.status, "ready-for-review");
  assert.equal(value.cancelled, false);
  assert.deepEqual(calls(), ["a"]);
  assert.equal(value.before.sourceRevision, revision); assert.equal(value.after.sourceRevision, revision);
  assert.equal(value.before.queue.planned, 2); assert.equal(value.after.queue.planned, 1);
  assert.equal(value.after.queue.readyForReview, 1); assert.equal(value.after.queue.accepted, 0);
  assert.ok(Object.isFrozen(value) && Object.isFrozen(value.before) && Object.isFrozen(value.before.queue));
  assert.ok(Object.isFrozen(value.after) && Object.isFrozen(value.after.actions));
  await controller.accept("a");
  assert.equal(value.after.queue.accepted, 0, "later host acceptance cannot rewrite a captured observation");
  assert.equal(await readFile(path.join(value.result!.candidatePath!, "a.txt"), "utf8"), "after");
  assert.equal(await readFile(path.join(source, "a.txt"), "utf8"), "before");
  assert.equal(git(source, ["status", "--porcelain", "--ignored"]), "");
}));

test("concurrent advances rely on atomic controller claims and execute one item only once", async () => fixture([item("a")], async ({ controller, other, calls }) => {
  const values = await Promise.all([advanceProject(controller), advanceProject(other)]);
  assert.deepEqual(calls(), ["a"]);
  const resultDiagnostics = JSON.stringify(values.map((value) => value.result));
  assert.equal(values.filter((value) => value.result?.status === "ready-for-review").length, 1, resultDiagnostics);
  assert.equal(values.filter((value) => value.result?.status === "no-ready-task").length, 1, resultDiagnostics);
  assert.equal((await controller.ledger.list()).filter((action) => action.kind === "candidate-write").length, 1);
}));

test("host acceptance of an unintegrated prerequisite cannot release dependent execution", async () => fixture([item("a"), item("b", ["a"])], async ({ controller, source, calls }) => {
  await advanceProject(controller);
  await controller.accept("a");
  const value = await advanceProject(controller);
  assert.equal(value.result?.status, "needs-reconciliation");
  assert.match(value.result!.reason!, /integrate/);
  assert.deepEqual(calls(), ["a"]);
  assert.equal(value.after.queue.accepted, 1); assert.equal(value.after.queue.planned, 1);
  assert.equal(await readFile(path.join(source, "a.txt"), "utf8"), "before");
}));

test("unresolved overlapping effect keeps the original running claim and blocks execution", async () => fixture([item("a"), item("b", [], "a.txt")], async ({ controller, calls }) => {
  const claimed = await controller.store.claimNext({ owner: "old-host", baseRevision: controller.currentSourceRevision() });
  const action = await controller.ledger.prepare({ idempotencyKey: "old-effect", kind: "candidate-write",
    input: { itemId: "a", definition: item("a") } });
  const actionClaim = await controller.ledger.claim(action.actionId, action.version);
  await controller.ledger.markUncertain(actionClaim, { evidence: { summary: "worker settlement unknown", references: ["host:old-worker"] } });
  const before = await controller.status();
  const value = await advanceProject(controller);
  assert.equal(value.result?.status, "no-ready-task"); assert.deepEqual(calls(), []);
  assert.equal(value.after.queue.running, 1); assert.equal(value.after.queue.planned, 1);
  assert.equal(value.after.actions.needsReconciliation, 1);
  assert.equal((await controller.store.load()).items[0]!.claim!.token, claimed!.token);
  assert.deepEqual(await controller.status(), before);
}));

test("unrelated uncertain effects are observations and do not create a global continuation fence", async () => fixture([item("b")], async ({ controller, calls }) => {
  const action = await controller.ledger.prepare({ idempotencyKey: "unrelated-effect", kind: "candidate-write",
    input: { itemId: "a", definition: item("a") } });
  await controller.ledger.claim(action.actionId, action.version);
  const value = await advanceProject(controller);
  assert.equal(value.before.actions.running, 1); assert.equal(value.after.actions.running, 1);
  assert.equal(value.result?.status, "ready-for-review"); assert.deepEqual(calls(), ["b"]);
  assert.equal((await controller.ledger.get(action.actionId))!.state, "running");
}));

test("a queue without runnable work returns its controller result with zero worker dispatch", async () => fixture([item("a")], async ({ controller, calls }) => {
  const claim = await controller.store.claimNext({ owner: "host:blocked", baseRevision: controller.currentSourceRevision() });
  await controller.store.block("a", claim!.token, "host intervention needed");
  const before = await controller.status();
  const value = await advanceProject(controller);
  assert.equal(value.result?.status, "no-ready-task"); assert.deepEqual(calls(), []);
  assert.equal(value.after.queue.blocked, 1); assert.deepEqual(await controller.status(), before);
}));

test("pre-cancellation and cancellation during progress reads do not call runNext", async () => fixture([item("a")], async ({ controller, calls }) => {
  const abort = new AbortController(); abort.abort();
  const run = controller.runNext.bind(controller); let runs = 0;
  controller.runNext = async (input) => { runs++; return run(input); };
  const value = await advanceProject(controller, { signal: abort.signal });
  assert.equal(value.cancelled, true); assert.equal(value.result, undefined); assert.equal(runs, 0);
  assert.deepEqual(calls(), []); assert.equal(value.after.queue.planned, 1);
  const later = new AbortController(); const status = controller.status.bind(controller);
  controller.status = async () => { later.abort(); return status(); };
  assert.equal((await advanceProject(controller, { signal: later.signal })).cancelled, true);
  assert.equal(runs, 0);
}));

test("malformed options reject before progress reads, claims or dispatch", async () => fixture([item("a")], async ({ controller, calls }) => {
  const inputs: unknown[] = [null, [], { maxAttempts: 0 }, { maxAttempts: 6 }, { maxAttempts: NaN },
    { maxWallTimeMs: 0 }, { maxWallTimeMs: Infinity }, { maxWallTimeMs: 1_800_001 }, { signal: {} },
    { apply: true }, { [Symbol("unknown")]: true }, Object.create({ maxAttempts: 1 }),
    { get maxAttempts() { assert.fail("option getter executed"); return 1; } }];
  const status = controller.status.bind(controller); let reads = 0;
  controller.status = async () => { reads++; return status(); };
  for (const input of inputs) await assert.rejects(advanceProject(controller, input as AdvanceProjectInput));
  assert.equal(reads, 0); assert.deepEqual(calls(), []);
  assert.equal((await controller.store.load()).revision, 0); assert.deepEqual(await controller.ledger.list(), []);
}));

test("caller mutation during progress collection cannot change forwarded limits", async () => fixture([item("a")], async ({ controller }) => {
  const input = { maxAttempts: 1, maxWallTimeMs: 30_000 };
  const status = controller.status.bind(controller);
  controller.status = async () => { input.maxAttempts = 5; input.maxWallTimeMs = 1; return status(); };
  const run = controller.runNext.bind(controller);
  controller.runNext = async (options) => {
    assert.equal(options?.maxAttempts, 1); assert.equal(options?.maxWallTimeMs, 30_000);
    return run(options);
  };
  assert.equal((await advanceProject(controller, input)).result?.status, "ready-for-review");
}));

test("cancellation awaits existing controller settlement and retains its original result", async () => fixture([item("a")], async ({ controller, useExecutor }) => {
  const abort = new AbortController();
  let entered!: () => void; const started = new Promise<void>((resolve) => { entered = resolve; });
  let release!: () => void; const settlement = new Promise<void>((resolve) => { release = resolve; });
  useExecutor(() => ({ async *execute() { entered(); await settlement; yield* []; } }));
  let original: DevelopmentResult | undefined;
  const run = controller.runNext.bind(controller);
  controller.runNext = async (input) => { original = await run(input); return original; };
  let returned = false;
  const pending = advanceProject(controller, { signal: abort.signal, maxWallTimeMs: 30_000 }).then((value) => { returned = true; return value; });
  try {
    await started; abort.abort();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(returned, false, "advance must not detach the running controller");
  } finally { release(); }
  const value = await pending;
  assert.equal(value.cancelled, true); assert.strictEqual(value.result, original); assert.ok(original);
  assert.equal(value.after.queue.running, 0);
  assert.equal((await controller.ledger.list()).filter((action) => action.state === "running").length, 0);
}));
