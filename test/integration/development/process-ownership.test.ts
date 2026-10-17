import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DevelopmentController } from "../../../src/development/controller.js";
import { WorkItemStore } from "../../../src/development/work-item-store.js";
import { createWorkQueue } from "../../../src/development/work-items.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";

const posix = { skip: process.platform === "win32" };
function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function kill(pid: number): void {
  assert.ok(Number.isSafeInteger(pid) && Math.abs(pid) > 1 && Math.abs(pid) !== process.pid, "invalid fixture process identity");
  try { process.kill(pid, "SIGKILL"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
}
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function stopFixture(file: string, escaped: boolean): Promise<void> {
  let identity: { pid: number; owner: number };
  try { identity = JSON.parse(await readFile(file, "utf8")) as typeof identity; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  kill(identity.pid);
  if (process.platform !== "win32") {
    if (escaped) kill(-identity.pid);
    kill(-identity.owner);
  }
}
async function ready(file: string): Promise<{ pid: number; owner: number }> {
  for (let n = 0; n < 200; n++) {
    try { return JSON.parse(await readFile(file, "utf8")) as { pid: number; owner: number }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await delay(20);
  }
  throw new Error("recipe never became ready");
}

async function fixture(escaped: boolean, body: (f: {
  controller: DevelopmentController; sourceRepo: string; heartbeat: string;
  readyPath: string; activationPath: string; stateRoot: string; queuePath: string; calls: () => number;
}) => Promise<void>, options: { timeoutMs?: number; activation?: boolean; child?: boolean } = {}): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "sparkle-process-ownership-"));
  const sourceRepo = path.join(root, "source");
  const heartbeat = path.join(root, "heartbeat.txt");
  const readyPath = path.join(root, "ready.json");
  const activationPath = path.join(root, "activate");
  let controller: DevelopmentController | undefined;
  try {
    await mkdir(sourceRepo);
    git(sourceRepo, ["init"]);
    git(sourceRepo, ["config", "user.name", "Process fixture"]);
    git(sourceRepo, ["config", "user.email", "fixture@example.invalid"]);
    await writeFile(path.join(sourceRepo, "value.txt"), "before");
    git(sourceRepo, ["add", "."]);
    git(sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
    const stubborn = `
      const fs = require('node:fs');
      process.on('SIGTERM', () => {});
      setTimeout(() => process.exit(99), 12000);
      fs.writeFileSync(${JSON.stringify(heartbeat)}, 'start');
      setInterval(() => fs.appendFileSync(${JSON.stringify(heartbeat)}, '.'), 10);
      fs.writeFileSync(${JSON.stringify(`${readyPath}.tmp`)}, JSON.stringify({pid: process.pid, owner: Number(process.argv[1]) || process.ppid}));
      fs.renameSync(${JSON.stringify(`${readyPath}.tmp`)}, ${JSON.stringify(readyPath)});
    `;
    const script = `${options.activation ? `if (!require('node:fs').existsSync(${JSON.stringify(activationPath)})) process.exit(0);` : ""}${escaped || options.child ? `
      const {spawn} = require('node:child_process');
      const child = spawn(process.execPath, ['-e', ${JSON.stringify(stubborn)}, String(process.ppid)], {
        detached: ${escaped}, stdio: ['ignore', 'inherit', 'inherit']
      });
      child.unref();
      setTimeout(() => process.exit(98), 12000);
    ` : stubborn}`;
    const queuePath = path.join(root, "queue.json");
    const stateRoot = path.join(root, "state");
    await new WorkItemStore(queuePath).create(createWorkQueue({
      id: "ownership", authorityRef: "host:test", items: [{
        id: "change", goal: "Change value.txt", dependencies: [], allowedScope: ["value.txt"], priority: 1,
        acceptance: [{ id: "check", command: process.execPath, args: ["-e", script], verifierVersion: "v1",
          ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) }]
      }]
    }));
    let count = 0;
    controller = new DevelopmentController({ sourceRepo, queuePath, stateRoot, owner: "host",
      executorFactory: () => { count++; return new ProtocolChildExecutor(); } });
    await body({ controller, sourceRepo, heartbeat, readyPath, activationPath, stateRoot, queuePath, calls: () => count });
  } finally {
    await stopFixture(readyPath, escaped);
    // Every fixture has an independent watchdog in addition to this cleanup.
    await rm(root, { recursive: true, force: true });
  }
}

for (const trigger of ["abort", "repeated-abort", "deadline"] as const) {
  test(`real develop ${trigger} stops nested TERM-ignoring recipe writes before return`, posix, async () => {
    await fixture(false, async ({ controller, sourceRepo, heartbeat, readyPath, calls }) => {
      const abort = new AbortController();
      const running = controller.runNext({ signal: abort.signal, maxAttempts: 3,
        maxWallTimeMs: trigger === "deadline" ? 2_000 : 10_000 });
      await ready(readyPath);
      if (trigger !== "deadline") abort.abort();
      if (trigger === "repeated-abort") abort.abort();
      const result = await running;
      assert.notEqual(result.status, "ready-for-review");
      const stopped = await readFile(heartbeat, "utf8");
      await delay(150);
      assert.equal(await readFile(heartbeat, "utf8"), stopped, "recipe still writes after develop returned");
      assert.equal(calls(), 1, "cancellation must not start another repair");
      assert.equal(await readFile(path.join(sourceRepo, "value.txt"), "utf8"), "before");
    });
  });
}

test("unsettled escaped recipe preserves action and task ownership across release/restart", posix, async () => {
  await fixture(true, async ({ controller, readyPath, calls }) => {
    const abort = new AbortController();
    const running = controller.runNext({ signal: abort.signal, maxAttempts: 3, maxWallTimeMs: 10_000 });
    await ready(readyPath);
    abort.abort();
    const result = await running;
    assert.equal(result.status, "needs-reconciliation");
    assert.match(result.reason!, /cleanup|unsettled/i);
    assert.equal((await controller.ledger.get(result.actionId!))!.state, "needs-reconciliation");
    const item = (await controller.store.load()).items[0]!;
    assert.equal(item.status, "running", "unknown effects must retain their scope reservation");
    await assert.rejects(controller.accept(item.definition.id), /invalid transition/);
    assert.equal((await controller.reconcile(result.actionId!)).status, "needs-reconciliation");
    await controller.store.release(item.definition.id, item.claim!.token);
    const restarted = await controller.runNext();
    assert.equal(restarted.status, "needs-reconciliation", "release must not authorize replay");
    assert.equal(calls(), 1);
  });
});

for (const scope of [["value.txt"], ["unrelated.txt"]]) {
  test(`an unresolved checker ${scope[0] === "value.txt" ? "retains an overlapping scope" : "allows disjoint work"}`, async () => {
    await fixture(false, async ({ controller, calls }) => {
      const action = await controller.ledger.prepare({ idempotencyKey: "host:old-check", kind: "candidate-check",
        input: { itemId: "other-item", definition: { allowedScope: scope } } });
      const claim = await controller.ledger.claim(action.actionId, action.version);
      await controller.ledger.markUncertain(claim, { evidence: { summary: "test host has not confirmed the old check stopped", references: ["host:check"] } });
      const abort = new AbortController();
      if (scope[0] !== "value.txt") {
        // Stop disjoint work in its factory, before any recipe is dispatched.
        const original = controller.ledger.checkpoint.bind(controller.ledger);
        controller.ledger.checkpoint = async (...args) => { const value = await original(...args); abort.abort(); return value; };
      }
      const result = await controller.runNext({ signal: abort.signal });
      assert.equal(result.status, scope[0] === "value.txt" ? "needs-reconciliation" : "blocked");
      assert.equal((await controller.ledger.get(action.actionId))!.state, "needs-reconciliation");
      assert.equal(calls(), 0);
      const actions = await controller.ledger.list();
      assert.equal(actions.filter((entry) => entry.kind === "candidate-write").length, scope[0] === "value.txt" ? 0 : 1);
    });
  });
}

test("recipe's own deadline reports unsettled effects and does not dispatch repair", posix, async () => {
  await fixture(false, async ({ controller, heartbeat, readyPath, calls }) => {
    const running = controller.runNext({ maxAttempts: 3, maxWallTimeMs: 10_000 });
    await ready(readyPath);
    const result = await running;
    assert.equal(result.status, "needs-reconciliation");
    assert.equal((await controller.ledger.get(result.actionId!))!.state, "needs-reconciliation");
    const stopped = await readFile(heartbeat, "utf8");
    await delay(150);
    assert.equal(await readFile(heartbeat, "utf8"), stopped);
    assert.equal(calls(), 1);
  }, { timeoutMs: 1_000 });
});

test("real develop abort stops a nested recipe's inherited grandchild", posix, async () => {
  await fixture(false, async ({ controller, heartbeat, readyPath }) => {
    const abort = new AbortController();
    const running = controller.runNext({ signal: abort.signal, maxAttempts: 3, maxWallTimeMs: 10_000 });
    await ready(readyPath);
    abort.abort();
    assert.equal((await running).status, "needs-reconciliation");
    const stopped = await readFile(heartbeat, "utf8");
    await delay(150);
    assert.equal(await readFile(heartbeat, "utf8"), stopped);
  }, { child: true });
});

test("interrupted verification never attests a settled tree on any platform", async () => {
  await fixture(false, async ({ controller, readyPath, calls }) => {
    const abort = new AbortController();
    const running = controller.runNext({ signal: abort.signal, maxAttempts: 3, maxWallTimeMs: 10_000 });
    await ready(readyPath);
    abort.abort();
    const result = await running;
    assert.equal(result.status, "needs-reconciliation");
    assert.equal((await controller.store.load()).items[0]!.status, "running");
    assert.equal((await controller.ledger.get(result.actionId!))!.state, "needs-reconciliation");
    assert.equal(calls(), 1);
  });
});

test("interrupted source verification retains its view and ledger across the next continue", posix, async () => {
  await fixture(false, async ({ controller, sourceRepo, activationPath, readyPath, calls }) => {
    assert.equal((await controller.runNext()).status, "ready-for-review");
    await controller.accept("change");
    git(sourceRepo, ["-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "host source advance"]);
    await writeFile(activationPath, "activate");
    const abort = new AbortController();
    const running = controller.next({ signal: abort.signal });
    // Attach the rejection assertion before abort so no unhandled rejection races.
    const rejected = assert.rejects(running, /cancel|unsettled/i);
    await ready(readyPath);
    abort.abort();
    await rejected;
    const pending = (await controller.ledger.list()).find((action) =>
      action.kind === "candidate-check" && action.state === "needs-reconciliation")!;
    assert.ok(pending);
    const binding = JSON.parse(pending.inputCanonicalJson) as { cwd: string };
    assert.equal(await readFile(path.join(binding.cwd, "value.txt"), "utf8"), "before");
    await assert.rejects(controller.next(), /requires reconciliation/);
    assert.equal((await controller.ledger.get(pending.actionId))!.state, "needs-reconciliation");
    assert.equal(calls(), 1);
  }, { activation: true });
});

test("parent crash retains the dispatched action and restart never replays it", posix, async () => {
  await fixture(false, async ({ controller, sourceRepo, queuePath, stateRoot, readyPath, calls }) => {
    const script = `
      import {DevelopmentController} from ${JSON.stringify(new URL("../../../src/development/controller.ts", import.meta.url).href)};
      import {ProtocolChildExecutor} from ${JSON.stringify(new URL("../../../src/testing/fake-executor.ts", import.meta.url).href)};
      // The factory is process-local and never reconstructed from persisted JSON.
      const live = new DevelopmentController({...${JSON.stringify({ sourceRepo, queuePath, stateRoot, owner: "crash-fixture" })},
        executorFactory: () => new ProtocolChildExecutor()});
      await live.runNext({maxAttempts: 3, maxWallTimeMs: 10000});
    `;
    const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), "--input-type=module", "-e", script], { stdio: "ignore" });
    const exited = once(child, "exit");
    try {
      await ready(readyPath);
      child.kill("SIGKILL");
      await exited;
      const action = (await controller.ledger.list()).find((entry) => entry.kind === "candidate-write")!;
      assert.equal(action.state, "running");
      const item = (await controller.store.load()).items[0]!;
      assert.equal(item.status, "running");
      await controller.store.release(item.definition.id, item.claim!.token);
      const resumed = await controller.runNext();
      assert.equal(resumed.status, "needs-reconciliation");
      assert.equal(resumed.actionId, action.actionId);
      assert.equal(calls(), 0);
    } finally {
      child.kill("SIGKILL");
      await exited;
    }
  });
});
