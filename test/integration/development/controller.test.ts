import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DevelopmentController } from "../../../src/development/controller.js";
import { createWorkQueue } from "../../../src/development/work-items.js";
import { WorkItemStore } from "../../../src/development/work-item-store.js";
import { ActionLedger } from "../../../src/development/action-ledger.js";
import { canonicalizeStableJson } from "../../../src/domain/canonical-json.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
async function fixture(body: (value: { root: string; sourceRepo: string; queuePath: string; stateRoot: string }) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "sparkle-development-controller-"));
  const sourceRepo = path.join(root, "source");
  await mkdir(sourceRepo);
  git(sourceRepo, ["init"]); git(sourceRepo, ["config", "user.name", "Controller fixture"]);
  git(sourceRepo, ["config", "user.email", "fixture@example.invalid"]);
  await writeFile(path.join(sourceRepo, "value.txt"), "before");
  git(sourceRepo, ["add", "."]); git(sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
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

test("controller performs real candidate write/check and saves a review checkpoint", async () => fixture(async (value) => {
  const controller = new DevelopmentController({ ...value, owner: "host", executorFactory: ({ tools }) => ({
    async *execute(request, signal) {
      await tools.find((tool) => tool.name === "sparkle_write_file")!.execute("write", { path: "value.txt", contents: "after" }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    }
  }) });
  const result = await controller.runNext({ maxAttempts: 2, maxWallTimeMs: 30_000 });
  assert.equal(result.status, "ready-for-review");
  assert.ok(result.actionId);
  assert.equal((await controller.status()).queue.items[0]?.status, "ready-for-review");
  assert.equal(await readFile(path.join(value.sourceRepo, "value.txt"), "utf8"), "before");
  assert.equal(git(value.sourceRepo, ["status", "--porcelain"]), "");
  await controller.accept("change");
  assert.equal((await controller.status()).queue.items[0]?.status, "accepted");
  assert.equal((await controller.runNext()).status, "no-ready-task");
}));

test("scope violation blocks the task and retains the failed candidate", async () => fixture(async (value) => {
  const controller = new DevelopmentController({ ...value, owner: "host", executorFactory: ({ tools }) => ({
    async *execute(request, signal) {
      await tools.find((tool) => tool.name === "sparkle_write_file")!.execute("outside", { path: "outside.txt", contents: "bad" }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    }
  }) });
  const result = await controller.runNext();
  assert.equal(result.status, "blocked");
  assert.equal((await controller.status()).queue.items[0]?.status, "blocked");
  assert.equal(git(value.sourceRepo, ["status", "--porcelain"]), "");
}));

test("completed effect recovery does not call the executor again", async () => fixture(async (value) => {
  let calls = 0;
  const controller = new DevelopmentController({ ...value, owner: "host", executorFactory: ({ tools }) => ({
    async *execute(request, signal) {
      calls++;
      await tools.find((tool) => tool.name === "sparkle_write_file")!.execute("write", { path: "value.txt", contents: "after" }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    }
  }) });
  const first = await controller.runNext();
  assert.equal(first.status, "ready-for-review");
  // Simulate the durable effect receipt surviving while the queue's final
  // publication did not. Recovery must fill only that missing transition.
  const queued = await new WorkItemStore(value.queuePath).load();
  await writeFile(value.queuePath, JSON.stringify({ ...queued,
    items: queued.items.map(({ evidence: _evidence, ...item }) => ({ ...item, status: "running" })) }));
  const again = await controller.reconcile(first.actionId!);
  assert.equal(again.status, "ready-for-review");
  assert.equal(calls, 1);
  assert.equal((await controller.status()).queue.items[0]?.status, "ready-for-review");
}));

test("changed candidate evidence cannot be accepted from saved success metadata", async () => fixture(async (value) => {
  const controller = new DevelopmentController({ ...value, owner: "host", executorFactory: ({ tools }) => ({
    async *execute(request, signal) {
      await tools.find((tool) => tool.name === "sparkle_write_file")!.execute("write", { path: "value.txt", contents: "after" }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    }
  }) });
  const result = await controller.runNext();
  assert.ok(result.candidatePath);
  await writeFile(path.join(result.candidatePath, "value.txt"), "other");
  await assert.rejects(controller.accept("change"), /verification|evidence|check/);
  assert.equal((await controller.status()).queue.items[0]?.status, "ready-for-review");
}));

test("unintegrated accepted prerequisite cannot dispatch a dependent task", async () => fixture(async (value) => {
  const queue = await new WorkItemStore(value.queuePath).load();
  const second = { ...queue.items[0]!.definition, id: "dependent", dependencies: ["change"], priority: 10 };
  await rm(value.queuePath);
  await new WorkItemStore(value.queuePath).create(createWorkQueue({ id: "fixture", authorityRef: "host:test",
    items: [queue.items[0]!.definition, second] }));
  let calls = 0;
  const controller = new DevelopmentController({ ...value, owner: "host", executorFactory: ({ tools }) => ({
    async *execute(request, signal) {
      calls++;
      await tools.find((tool) => tool.name === "sparkle_write_file")!.execute("write", { path: "value.txt", contents: "after" }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    }
  }) });
  await controller.runNext(); await controller.accept("change");
  const dependent = await controller.runNext();
  assert.equal(dependent.status, "needs-reconciliation");
  assert.equal(calls, 1);
  await writeFile(path.join(value.sourceRepo, "value.txt"), "after");
  git(value.sourceRepo, ["add", "."]); git(value.sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "host integration"]);
  assert.equal((await controller.runNext()).status, "ready-for-review");
  assert.equal(calls, 2);
}));

test("malformed completed receipt cannot bypass reconciliation verification", async () => fixture(async (value) => {
  const controller = new DevelopmentController({ ...value, owner: "host", executorFactory: ({ tools }) => ({
    async *execute(request, signal) {
      await tools.find((tool) => tool.name === "sparkle_write_file")!.execute("write", { path: "value.txt", contents: "after" }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    }
  }) });
  const result = await controller.runNext();
  const ledgerPath = path.join(path.dirname(value.queuePath), "actions", "actions.json");
  const raw = JSON.parse(await readFile(ledgerPath, "utf8")) as { actions: { actionId: string; resultCanonicalJson: string }[] };
  const action = raw.actions.find((entry) => entry.actionId === result.actionId)!;
  const receipt = JSON.parse(action.resultCanonicalJson) as Record<string, unknown>;
  action.resultCanonicalJson = canonicalizeStableJson({ ...receipt, evidence: [] });
  await writeFile(ledgerPath, canonicalizeStableJson(raw));
  await assert.rejects(controller.reconcile(result.actionId!), /evidence/);
  assert.equal((await new ActionLedger(path.dirname(ledgerPath)).get(result.actionId!))?.state, "completed");
}));

test("runtime run options cannot override host source or verifier", async () => fixture(async (value) => {
  let calls = 0;
  const controller = new DevelopmentController({ ...value, owner: "host", executorFactory: () => { calls++; return new ProtocolChildExecutor(); } });
  await assert.rejects(controller.runNext({ verification: { command: "bad" } } as never), /unsupported/);
  assert.equal(calls, 0);
  assert.equal((await controller.status()).queue.items[0]?.status, "planned");
}));

test("declared verifier dependencies remain unwritable even inside task scope", async () => fixture(async (value) => {
  await writeFile(path.join(value.sourceRepo, "checker.cjs"), "if(require('node:fs').readFileSync('value.txt','utf8')!=='after') process.exit(1)");
  git(value.sourceRepo, ["add", "."]); git(value.sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "host checker"]);
  const queue = await new WorkItemStore(value.queuePath).load();
  const definition = queue.items[0]!.definition;
  await rm(value.queuePath);
  await new WorkItemStore(value.queuePath).create(createWorkQueue({ id: queue.id, authorityRef: queue.authorityRef,
    items: [{ ...definition, allowedScope: ["value.txt", "checker.cjs"],
      acceptance: [{ ...definition.acceptance[0]!, args: ["checker.cjs"], protectedPaths: ["checker.cjs"] }] }] }));
  const controller = new DevelopmentController({ ...value, owner: "host", executorFactory: ({ tools }) => ({
    async *execute(request, signal) {
      await tools.find((tool) => tool.name === "sparkle_write_file")!.execute("cheat", { path: "checker.cjs", contents: "process.exit(0)" }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    }
  }) });
  assert.equal((await controller.runNext()).status, "blocked");
}));

test("a committed checker rewrite is refused against the original clean claim base", async () => fixture(async (value) => {
  await writeFile(path.join(value.sourceRepo, "checker.cjs"), "if(require('node:fs').readFileSync('value.txt','utf8')!=='after') process.exit(1)");
  git(value.sourceRepo, ["add", "."]); git(value.sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "host checker"]);
  const queue = await new WorkItemStore(value.queuePath).load();
  const definition = queue.items[0]!.definition;
  await rm(value.queuePath);
  await new WorkItemStore(value.queuePath).create(createWorkQueue({ id: queue.id, authorityRef: queue.authorityRef,
    items: [{ ...definition, acceptance: [{ ...definition.acceptance[0]!, args: ["checker.cjs"], protectedPaths: ["checker.cjs"] }] }] }));
  const controller = new DevelopmentController({ ...value, owner: "host", executorFactory: ({ tools }) => ({
    async *execute(request, signal) {
      await tools.find((tool) => tool.name === "sparkle_write_file")!.execute("write", { path: "value.txt", contents: "after" }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    }
  }) });
  const result = await controller.runNext();
  assert.equal(result.status, "ready-for-review");
  await writeFile(path.join(result.candidatePath!, "checker.cjs"), "process.exit(0)");
  git(result.candidatePath!, ["add", "."]); git(result.candidatePath!, ["-c", "commit.gpgsign=false", "commit", "-m", "changed checker"]);
  await assert.rejects(controller.accept("change"), /evidence/);
}));

test("releasing a task claim does not replay an unfinished prior effect", async () => fixture(async (value) => {
  let calls = 0;
  const controller = new DevelopmentController({ ...value, owner: "host", executorFactory: () => { calls++; return new ProtocolChildExecutor(); } });
  const selected = await controller.store.claimNext({ owner: "old", baseRevision: git(value.sourceRepo, ["rev-parse", "HEAD"]) });
  const action = await controller.ledger.prepare({ idempotencyKey: "unfinished", kind: "candidate-write", input: { itemId: "change" } });
  await controller.ledger.claim(action.actionId, action.version);
  await controller.store.release("change", selected!.token);
  const result = await controller.runNext();
  assert.equal(result.status, "needs-reconciliation");
  assert.equal(result.actionId, action.actionId);
  assert.equal(calls, 0);
  assert.equal((await controller.status()).queue.items[0]?.status, "planned");
}));

test("a script argument named --eval cannot masquerade as a fixed inline checker", async () => fixture(async (value) => {
  await writeFile(path.join(value.sourceRepo, "checker.cjs"), "process.exit(0)");
  git(value.sourceRepo, ["add", "."]); git(value.sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "checker"]);
  const queue = await new WorkItemStore(value.queuePath).load();
  const definition = queue.items[0]!.definition;
  await rm(value.queuePath);
  await new WorkItemStore(value.queuePath).create(createWorkQueue({ id: queue.id, authorityRef: queue.authorityRef,
    items: [{ ...definition, allowedScope: ["value.txt", "checker.cjs"],
      acceptance: [{ ...definition.acceptance[0]!, args: ["checker.cjs", "--eval", "0"] }] }] }));
  const controller = new DevelopmentController({ ...value, owner: "host", executorFactory: () => new ProtocolChildExecutor() });
  await assert.rejects(controller.runNext(), /protected/);
  assert.equal((await controller.status()).queue.items[0]?.status, "planned");
}));
