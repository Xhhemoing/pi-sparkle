import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DevelopmentController } from "../../../src/development/controller.js";
import { createWorkQueue } from "../../../src/development/work-items.js";
import { WorkItemStore } from "../../../src/development/work-item-store.js";
import { canonicalizeStableJson } from "../../../src/domain/canonical-json.js";
import { parseRunId } from "../../../src/domain/ids.js";
import { readLoopArtifact } from "../../../src/execution/loop-artifact.js";
import type { NativeWriteExecutorFactory } from "../../../src/native/write-session.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";

interface Fixture { root: string; sourceRepo: string; queuePath: string; stateRoot: string; }
function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
async function fixture(body: (value: Fixture) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "sparkle-controller-cancellation-"));
  const sourceRepo = path.join(root, "source");
  await mkdir(sourceRepo);
  git(sourceRepo, ["init"]);
  git(sourceRepo, ["config", "user.name", "Cancellation fixture"]);
  git(sourceRepo, ["config", "user.email", "fixture@example.invalid"]);
  await writeFile(path.join(sourceRepo, "value.txt"), "before");
  git(sourceRepo, ["add", "."]);
  git(sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
  const queuePath = path.join(root, "queue.json");
  const stateRoot = path.join(root, "state");
  await new WorkItemStore(queuePath).create(createWorkQueue({ id: "fixture", authorityRef: "host:test", items: [{
    id: "change", goal: "Set value.txt to after", dependencies: [], allowedScope: ["value.txt"], priority: 90,
    acceptance: [{ id: "contents", command: process.execPath,
      args: ["-e", "if(require('node:fs').readFileSync('value.txt','utf8')!=='after') process.exit(1)"], verifierVersion: "v1" }]
  }] }));
  try { await body({ root, sourceRepo, queuePath, stateRoot }); }
  finally { await rm(root, { recursive: true, force: true }); }
}
function writingFactory(onExecute: () => void = () => undefined): NativeWriteExecutorFactory {
  return ({ tools }) => ({
    async *execute(request, signal) {
      onExecute();
      await tools.find((tool) => tool.name === "sparkle_write_file")!.execute("write", { path: "value.txt", contents: "after" }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    }
  });
}

for (const boundary of ["selection", "action inventory", "pre-claim queue read"] as const) {
  test(`cancellation after ${boundary} does not commit a task or action claim`, async () => fixture(async (value) => {
    const abort = new AbortController();
    let factories = 0;
    const controller = new DevelopmentController({ ...value, owner: "host", executorFactory: () => {
      factories++; return new ProtocolChildExecutor();
    } });
    if (boundary === "selection") {
      const original = controller.store.next.bind(controller.store);
      controller.store.next = async (...args) => { const result = await original(...args); abort.abort(); return result; };
    } else if (boundary === "action inventory") {
      const original = controller.ledger.list.bind(controller.ledger);
      controller.ledger.list = async () => { const result = await original(); abort.abort(); return result; };
    } else {
      const original = controller.store.load.bind(controller.store);
      controller.store.load = async () => { const result = await original(); abort.abort(); return result; };
    }
    await assert.rejects(controller.runNext({ signal: abort.signal }), /cancel/i);
    assert.equal(factories, 0);
    assert.equal((await controller.store.load()).items[0]?.status, "planned");
    assert.equal((await controller.ledger.list()).length, 0);
  }));
}

test("a committed task claim cancelled before return is blocked with its original token", async () => fixture(async (value) => {
  const abort = new AbortController();
  let factories = 0;
  let token: string | undefined;
  const controller = new DevelopmentController({ ...value, owner: "host", executorFactory: () => {
    factories++; return new ProtocolChildExecutor();
  } });
  const original = controller.store.claimNext.bind(controller.store);
  controller.store.claimNext = async (input) => {
    assert.equal(input.signal, abort.signal);
    const result = await original(input); token = result?.token; abort.abort(); return result;
  };
  const result = await controller.runNext({ signal: abort.signal });
  assert.equal(result.status, "blocked");
  assert.match(result.reason!, /cancel/i);
  const record = (await controller.store.load()).items[0]!;
  assert.equal(record.status, "blocked");
  assert.equal(record.claim?.token, token);
  assert.equal(factories, 0);
  assert.equal((await controller.ledger.list()).length, 0);
}));

test("post-claim queue read failure receives fenced cleanup instead of leaving running work", async () => fixture(async (value) => {
  let reads = 0;
  let factories = 0;
  const controller = new DevelopmentController({ ...value, owner: "host", executorFactory: () => {
    factories++; return new ProtocolChildExecutor();
  } });
  const original = controller.store.load.bind(controller.store);
  controller.store.load = async () => {
    if (++reads === 2) throw new Error("post-claim read failed");
    return original();
  };
  const result = await controller.runNext();
  assert.equal(result.status, "blocked");
  assert.match(result.reason!, /post-claim read failed/);
  assert.equal((await controller.store.load()).items[0]?.status, "blocked");
  assert.equal(factories, 0);
  assert.equal((await controller.ledger.list()).length, 0);
}));

for (const boundary of ["prepare", "claim", "checkpoint"] as const) {
  test(`cancellation after action ${boundary} never dispatches the executor factory`, async () => fixture(async (value) => {
    const abort = new AbortController();
    let factories = 0;
    const controller = new DevelopmentController({ ...value, owner: "host", executorFactory: () => {
      factories++; return new ProtocolChildExecutor();
    } });
    if (boundary === "prepare") {
      const original = controller.ledger.prepare.bind(controller.ledger);
      controller.ledger.prepare = async (input) => { const result = await original(input); abort.abort(); return result; };
    } else if (boundary === "claim") {
      const original = controller.ledger.claim.bind(controller.ledger);
      controller.ledger.claim = async (...args) => { const result = await original(...args); abort.abort(); return result; };
    } else {
      const original = controller.ledger.checkpoint.bind(controller.ledger);
      controller.ledger.checkpoint = async (...args) => { const result = await original(...args); abort.abort(); return result; };
    }
    const result = await controller.runNext({ signal: abort.signal });
    assert.equal(result.status, "blocked");
    assert.match(result.reason!, /cancel/i);
    assert.equal(factories, 0);
    assert.equal((await controller.store.load()).items[0]?.status, "blocked");
    const action = (await controller.ledger.list())[0]!;
    assert.equal(action.state, boundary === "prepare" ? "prepared" : "needs-reconciliation");
    if (boundary === "checkpoint") assert.ok(action.resultCanonicalJson?.includes("candidatePath"));
  }));
}

test("cancellation after a completed effect preserves its receipt for transition-only reconciliation", async () => fixture(async (value) => {
  const abort = new AbortController();
  let executions = 0;
  let savedReceipt: string | undefined;
  const controller = new DevelopmentController({ ...value, owner: "host", executorFactory: writingFactory(() => executions++) });
  const original = controller.ledger.complete.bind(controller.ledger);
  controller.ledger.complete = async (...args) => {
    const result = await original(...args); savedReceipt = result.resultCanonicalJson; abort.abort(); return result;
  };
  const result = await controller.runNext({ signal: abort.signal, maxAttempts: 1 });
  assert.equal(result.status, "needs-reconciliation");
  assert.equal((await controller.store.load()).items[0]?.status, "running");
  const action = await controller.ledger.get(result.actionId!);
  assert.equal(action?.state, "completed");
  assert.equal(action.resultCanonicalJson, savedReceipt);
  assert.equal((await controller.reconcile(result.actionId!)).status, "ready-for-review");
  assert.equal(executions, 1);
}));

test("the operation signal reaches selection and final publication; cancelled publication retains the receipt", async () => fixture(async (value) => {
  const abort = new AbortController();
  const controller = new DevelopmentController({ ...value, owner: "host", executorFactory: writingFactory() });
  const originalNext = controller.store.next.bind(controller.store);
  controller.store.next = async (input) => { assert.equal(input?.signal, abort.signal); return originalNext(input); };
  const originalReady = controller.store.markReady.bind(controller.store);
  controller.store.markReady = async (...args) => {
    assert.equal(args[4], abort.signal); abort.abort(); return originalReady(...args);
  };
  const result = await controller.runNext({ signal: abort.signal });
  assert.equal(result.status, "needs-reconciliation");
  assert.equal((await controller.store.load()).items[0]?.status, "running");
  assert.equal((await controller.ledger.get(result.actionId!))?.state, "completed");
}));

test("cancellation after committed publication returns a recoverable result without undoing the queue", async () => fixture(async (value) => {
  const abort = new AbortController();
  const controller = new DevelopmentController({ ...value, owner: "host", executorFactory: writingFactory() });
  const original = controller.store.markReady.bind(controller.store);
  controller.store.markReady = async (...args) => {
    const result = await original(...args); abort.abort(); return result;
  };
  const result = await controller.runNext({ signal: abort.signal });
  assert.equal(result.status, "needs-reconciliation");
  assert.equal((await controller.store.load()).items[0]?.status, "ready-for-review");
  assert.equal((await controller.ledger.get(result.actionId!))?.state, "completed");
}));

test("cancellation after candidate edits preserves unsuccessful native artifact locators", async () => fixture(async (value) => {
  const abort = new AbortController();
  const controller = new DevelopmentController({ ...value, owner: "host", executorFactory: ({ tools }) => ({
    async *execute(request, signal) {
      await tools.find((tool) => tool.name === "sparkle_write_file")!.execute("write", { path: "value.txt", contents: "after" }, signal);
      abort.abort();
      yield* new ProtocolChildExecutor().execute(request, signal);
    }
  }) });
  const result = await controller.runNext({ signal: abort.signal, maxAttempts: 1 });
  assert.equal(result.status, "blocked");
  const action = await controller.ledger.get(result.actionId!);
  assert.equal(action?.state, "completed");
  const receipt = JSON.parse(action.resultCanonicalJson!) as Record<string, unknown>;
  assert.equal(receipt.accepted, false);
  assert.equal(typeof receipt.finalArtifactRef, "string");
  assert.equal(typeof receipt.loopArtifactRef, "string");
  assert.equal(await readFile(path.join(result.candidatePath!, "value.txt"), "utf8"), "after");
  assert.equal(await readFile(path.join(value.sourceRepo, "value.txt"), "utf8"), "before");
}));

for (const accepted of [true, false]) {
  test(`${accepted ? "successful" : "failed"} native results persist explicit final and loop artifact references`, async () => fixture(async (value) => {
    const controller = new DevelopmentController({ ...value, owner: "host",
      executorFactory: accepted ? writingFactory() : () => new ProtocolChildExecutor() });
    const result = await controller.runNext({ maxAttempts: 1, maxWallTimeMs: 30_000 });
    assert.equal(result.status, accepted ? "ready-for-review" : "blocked");
    const action = await controller.ledger.get(result.actionId!);
    assert.equal(action?.state, "completed");
    const receipt = JSON.parse(action.resultCanonicalJson!) as Record<string, unknown>;
    assert.equal(receipt.accepted, accepted);
    for (const key of ["finalArtifactRef", "loopArtifactRef"] as const) {
      assert.equal(typeof receipt[key], "string");
      const pieces = (receipt[key] as string).split("/");
      assert.equal(pieces.length, 2);
      assert.equal(pieces[0], receipt.runId);
      const body = await readLoopArtifact(value.stateRoot, parseRunId(pieces[0]!), pieces[1]!);
      assert.ok(body !== null && typeof body === "object");
      if (key === "loopArtifactRef") assert.equal((body as { kind?: string }).kind, "native-write-loop");
    }
    assert.equal(await readFile(path.join(value.sourceRepo, "value.txt"), "utf8"), "before");
  }));
}

test("legacy receipts without explicit references still reconcile and currentSourceRevision reads fresh HEAD", async () => fixture(async (value) => {
  const controller = new DevelopmentController({ ...value, owner: "host", executorFactory: writingFactory() });
  const base = git(value.sourceRepo, ["rev-parse", "HEAD"]);
  assert.equal(controller.currentSourceRevision(), base);
  const result = await controller.runNext();
  const ledgerPath = path.join(path.dirname(value.queuePath), "actions", "actions.json");
  const raw = JSON.parse(await readFile(ledgerPath, "utf8")) as { actions: { actionId: string; resultCanonicalJson: string }[] };
  const action = raw.actions.find((entry) => entry.actionId === result.actionId)!;
  const receipt = JSON.parse(action.resultCanonicalJson) as Record<string, unknown>;
  action.resultCanonicalJson = canonicalizeStableJson({ ...receipt, finalArtifactRef: "foreign-run/artifact" });
  await writeFile(ledgerPath, canonicalizeStableJson(raw));
  await assert.rejects(controller.reconcile(result.actionId!), /artifact reference/);
  delete receipt.finalArtifactRef; delete receipt.loopArtifactRef;
  action.resultCanonicalJson = canonicalizeStableJson(receipt);
  await writeFile(ledgerPath, canonicalizeStableJson(raw));
  assert.equal((await controller.reconcile(result.actionId!)).status, "ready-for-review");
  git(value.sourceRepo, ["-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "new host revision"]);
  assert.notEqual(controller.currentSourceRevision(), base);
  assert.equal(controller.currentSourceRevision(), git(value.sourceRepo, ["rev-parse", "HEAD"]));
}));
