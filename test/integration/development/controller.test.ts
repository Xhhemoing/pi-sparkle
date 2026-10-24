import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DevelopmentController } from "../../../src/development/controller.js";
import { createWorkQueue, type WorkItemDefinition } from "../../../src/development/work-items.js";
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

async function redefineItem(queuePath: string, changes: Partial<WorkItemDefinition>): Promise<void> {
  const store = new WorkItemStore(queuePath);
  const queue = await store.load();
  await rm(queuePath);
  await store.create(createWorkQueue({ id: queue.id, authorityRef: queue.authorityRef,
    items: [{ ...queue.items[0]!.definition, ...changes }] }));
}

test("optional writable files may remain absent through real checks and acceptance", async () => fixture(async (value) => {
  await redefineItem(value.queuePath, { allowedScope: ["value.txt", "optional.txt"] });
  const controller = new DevelopmentController({ ...value, owner: "host", executorFactory: ({ tools }) => ({
    async *execute(request, signal) {
      await tools.find((tool) => tool.name === "sparkle_write_file")!.execute("write", { path: "value.txt", contents: "after" }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    }
  }) });
  const result = await controller.runNext();
  assert.equal(result.status, "ready-for-review", result.reason ?? "optional paths must not be required outputs");
  await controller.accept("change");
  assert.equal((await controller.status()).queue.items[0]?.status, "accepted");
  await assert.rejects(readFile(path.join(result.candidatePath!, "optional.txt")), /ENOENT/);
  assert.equal(await readFile(path.join(value.sourceRepo, "value.txt"), "utf8"), "before");
}));

test("optional writable scope can start entirely absent and retain a legal new file", async () => fixture(async (value) => {
  await redefineItem(value.queuePath, { allowedScope: ["created.txt", "optional.txt"], acceptance: [{
    id: "contents", command: process.execPath, args: ["-e", "if(require('node:fs').readFileSync('created.txt','utf8')!=='after') process.exit(1)"], verifierVersion: "v1"
  }] });
  const controller = new DevelopmentController({ ...value, owner: "host", executorFactory: ({ tools }) => ({
    async *execute(request, signal) {
      await tools.find((tool) => tool.name === "sparkle_write_file")!.execute("write", { path: "created.txt", contents: "after" }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    }
  }) });
  const result = await controller.runNext();
  assert.equal(result.status, "ready-for-review", result.reason ?? "legal creation inside an initially absent scope must succeed");
  await controller.accept("change");
  assert.equal(await readFile(path.join(result.candidatePath!, "created.txt"), "utf8"), "after");
  await assert.rejects(readFile(path.join(value.sourceRepo, "created.txt")), /ENOENT/);
}));

test("missing protected dependencies remain required beside optional writable files", async () => fixture(async (value) => {
  const queue = await new WorkItemStore(value.queuePath).load();
  await redefineItem(value.queuePath, { allowedScope: ["value.txt", "optional.txt"], acceptance: [{
    ...queue.items[0]!.definition.acceptance[0]!, protectedPaths: ["missing-checker-dependency"]
  }] });
  const controller = new DevelopmentController({ ...value, owner: "host", executorFactory: ({ tools }) => ({
    async *execute(request, signal) {
      await tools.find((tool) => tool.name === "sparkle_write_file")!.execute("write", { path: "value.txt", contents: "after" }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    }
  }) });
  const result = await controller.runNext();
  assert.equal(result.status, "blocked");
  assert.match(result.reason ?? "", /required include prefix is missing/);
}));

for (const mode of ["create", "rewrite"] as const) {
  test(`checker cannot ${mode} optional writable files and claim successful verification`, async () => fixture(async (value) => {
    await redefineItem(value.queuePath, { allowedScope: ["value.txt", "created.txt", "optional.txt"], acceptance: [{
      id: "contents", command: process.execPath, args: ["-e", "require('node:fs').writeFileSync('created.txt','evil')"], verifierVersion: "v1"
    }] });
    const controller = new DevelopmentController({ ...value, owner: "host", executorFactory: ({ tools }) => ({
      async *execute(request, signal) {
        const write = tools.find((tool) => tool.name === "sparkle_write_file")!;
        await write.execute("write", { path: "value.txt", contents: "after" }, signal);
        if (mode === "rewrite") await write.execute("new", { path: "created.txt", contents: "good" }, signal);
        yield* new ProtocolChildExecutor().execute(request, signal);
      }
    }) });
    const result = await controller.runNext({ maxAttempts: 1 });
    assert.equal(result.status, "blocked");
    assert.equal(await readFile(path.join(result.candidatePath!, "created.txt"), "utf8"), "evil", "the actual checker ran before exact evidence refused acceptance");
    assert.equal(await readFile(path.join(value.sourceRepo, "value.txt"), "utf8"), "before");
  }));
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

test("exact patch outside task scope is refused before candidate bytes change", async () => fixture(async (value) => {
  await writeFile(path.join(value.sourceRepo, "outside.txt"), "outside before");
  git(value.sourceRepo, ["add", "."]); git(value.sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "outside fixture"]);
  let refusal: string | undefined;
  const controller = new DevelopmentController({ ...value, owner: "host", executorFactory: ({ tools }) => ({
    async *execute(request, signal) {
      try {
        await tools.find((tool) => tool.name === "sparkle_patch_file")!.execute("outside-patch", {
          path: "outside.txt", oldText: "outside before", newText: "outside after"
        }, signal);
      } catch (error) {
        refusal = error instanceof Error ? error.message : String(error);
        throw error;
      }
      yield* new ProtocolChildExecutor().execute(request, signal);
    }
  }) });
  const result = await controller.runNext();
  assert.equal(result.status, "blocked");
  assert.ok(result.candidatePath);
  assert.equal(await readFile(path.join(result.candidatePath, "outside.txt"), "utf8"), "outside before");
  assert.match(refusal ?? "", /outside task scope/);
  assert.equal(await readFile(path.join(value.sourceRepo, "outside.txt"), "utf8"), "outside before");
}));

test("controller allows an exact in-scope patch and retains source isolation", async () => fixture(async (value) => {
  const controller = new DevelopmentController({ ...value, owner: "host", executorFactory: ({ tools }) => ({
    async *execute(request, signal) {
      await tools.find((tool) => tool.name === "sparkle_patch_file")!.execute("patch", {
        path: "value.txt", oldText: "before", newText: "after"
      }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    }
  }) });
  const result = await controller.runNext();
  assert.equal(result.status, "ready-for-review");
  assert.equal(await readFile(path.join(result.candidatePath!, "value.txt"), "utf8"), "after");
  assert.equal(await readFile(path.join(value.sourceRepo, "value.txt"), "utf8"), "before");
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

test("exact patch cannot mutate a protected verifier inside the task scope", async () => fixture(async (value) => {
  const checker = "if(require('node:fs').readFileSync('value.txt','utf8')!=='after') process.exit(1)";
  await writeFile(path.join(value.sourceRepo, "checker.cjs"), checker);
  git(value.sourceRepo, ["add", "."]); git(value.sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "host checker"]);
  const queue = await new WorkItemStore(value.queuePath).load();
  const definition = queue.items[0]!.definition;
  await rm(value.queuePath);
  await new WorkItemStore(value.queuePath).create(createWorkQueue({ id: queue.id, authorityRef: queue.authorityRef,
    items: [{ ...definition, allowedScope: ["value.txt", "checker.cjs"],
      acceptance: [{ ...definition.acceptance[0]!, args: ["checker.cjs"], protectedPaths: ["checker.cjs"] }] }] }));
  let refusal: string | undefined;
  const controller = new DevelopmentController({ ...value, owner: "host", executorFactory: ({ tools }) => ({
    async *execute(request, signal) {
      try {
        await tools.find((tool) => tool.name === "sparkle_patch_file")!.execute("checker-patch", {
          path: "checker.cjs", oldText: checker, newText: "process.exit(0)"
        }, signal);
      } catch (error) {
        refusal = error instanceof Error ? error.message : String(error);
        throw error;
      }
      yield* new ProtocolChildExecutor().execute(request, signal);
    }
  }) });
  const result = await controller.runNext();
  assert.equal(result.status, "blocked");
  assert.ok(result.candidatePath);
  assert.equal(await readFile(path.join(result.candidatePath, "checker.cjs"), "utf8"), checker);
  assert.match(refusal ?? "", /protected verifier dependency/);
  assert.equal(await readFile(path.join(value.sourceRepo, "checker.cjs"), "utf8"), checker);
}));

for (const toolName of ["sparkle_write_file", "sparkle_patch_file"]) {
  test(`${toolName} refuses an allowed alias before mutating its protected canonical target`, async () => fixture(async (value) => {
    const checker = "if(require('node:fs').readFileSync('value.txt','utf8')!=='after') process.exit(1)";
    await mkdir(path.join(value.sourceRepo, "protected"));
    await writeFile(path.join(value.sourceRepo, "protected/checker.cjs"), checker);
    git(value.sourceRepo, ["add", "."]); git(value.sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "host checker"]);
    const queue = await new WorkItemStore(value.queuePath).load();
    const definition = queue.items[0]!.definition;
    await rm(value.queuePath);
    await new WorkItemStore(value.queuePath).create(createWorkQueue({ id: queue.id, authorityRef: queue.authorityRef,
      items: [{ ...definition, allowedScope: ["value.txt", "allowed", "protected"],
        acceptance: [{ ...definition.acceptance[0]!, args: ["protected/checker.cjs"], protectedPaths: ["protected/checker.cjs"] }] }] }));
    let refusal: string | undefined;
    const controller = new DevelopmentController({ ...value, owner: "host", executorFactory: async ({ tools, candidatePath }) => {
      await symlink(path.join(candidatePath, "protected"), path.join(candidatePath, "allowed"), process.platform === "win32" ? "junction" : "dir");
      return {
        async *execute(request, signal) {
          try {
            await tools.find((tool) => tool.name === toolName)!.execute("alias-mutation", toolName === "sparkle_patch_file"
              ? { path: "allowed/checker.cjs", oldText: checker, newText: "process.exit(0)" }
              : { path: "allowed/checker.cjs", contents: "process.exit(0)" }, signal);
          } catch (error) {
            refusal = error instanceof Error ? error.message : String(error);
            throw error;
          }
          yield* new ProtocolChildExecutor().execute(request, signal);
        }
      };
    } });
    const result = await controller.runNext();
    assert.equal(result.status, "blocked");
    assert.ok(result.candidatePath);
    assert.equal(await readFile(path.join(result.candidatePath, "protected/checker.cjs"), "utf8"), checker);
    assert.match(refusal ?? "", /protected verifier dependency/);
    assert.equal(await readFile(path.join(value.sourceRepo, "protected/checker.cjs"), "utf8"), checker);
  }));
}

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
