import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import { ConversationSession, type ConversationRequest } from "../../../src/conversation/session.js";
import { DevelopmentController } from "../../../src/development/controller.js";
import { WorkItemStore } from "../../../src/development/work-item-store.js";
import { createWorkQueue } from "../../../src/development/work-items.js";
import { prepareTrustedVerification } from "../../../src/execution/trusted-verification.js";
import type { NativeWriteExecutorFactory } from "../../../src/native/write-session.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
async function tree(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      for (const [relative, bytes] of Object.entries(await tree(absolute))) result[`${entry.name}/${relative}`] = bytes;
    } else result[entry.name] = (await readFile(absolute)).toString("base64");
  }
  return result;
}
async function fixture(body: (value: { root: string; sourceRepo: string; stateRoot: string; sandboxRoot: string; controller: DevelopmentController }) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "sparkle-conversation-"));
  const sourceRepo = path.join(root, "source");
  const stateRoot = path.join(root, "state");
  const sandboxRoot = path.join(root, "candidates");
  try {
    await mkdir(sourceRepo); await mkdir(sandboxRoot);
    git(sourceRepo, ["init"]); git(sourceRepo, ["config", "user.name", "Conversation fixture"]);
    git(sourceRepo, ["config", "user.email", "fixture@example.invalid"]);
    await writeFile(path.join(sourceRepo, "value.txt"), "before");
    git(sourceRepo, ["add", "."]); git(sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
    const queuePath = path.join(root, "queue.json");
    await new WorkItemStore(queuePath).create(createWorkQueue({ id: "conversation", authorityRef: "host:fixture", items: [{
      id: "main", goal: "Update value.txt", dependencies: [], allowedScope: ["value.txt"], priority: 1,
      acceptance: [{ id: "check", command: process.execPath, args: ["-e", "process.exit(0)"], verifierVersion: "v1" }]
    }] }));
    const controller = new DevelopmentController({ sourceRepo, stateRoot, queuePath, owner: "host",
      executorFactory: () => { throw new Error("status must not allocate a worker"); } });
    controller.next = () => { throw new Error("query must not select or verify work"); };
    await body({ root, sourceRepo, stateRoot, sandboxRoot, controller });
  } finally { await rm(root, { recursive: true, force: true }); }
}
const main = { projectRef: "project", taskRef: "main" };
const side = { projectRef: "project", taskRef: "side" };
function hostInput(value: { sourceRepo: string; stateRoot: string; sandboxRoot: string }, factory?: NativeWriteExecutorFactory) {
  return { sourceRepo: value.sourceRepo, stateRoot: value.stateRoot, sandboxRoot: value.sandboxRoot,
    objective: "Update value.txt", verification: { command: process.execPath,
    args: ["-e", "if(require('node:fs').readFileSync('value.txt','utf8')!=='after')process.exit(1)"] },
    executorFactory: factory ?? (({ tools }) => ({
      async *execute(request, signal) {
        await tools.find((tool) => tool.name === "sparkle_patch_file")!.execute("patch", { path: "value.txt", oldText: "before", newText: "after" }, signal);
        yield* new ProtocolChildExecutor().execute(request, signal);
      }
    })) };
}
function runRequest(session: ConversationSession, requestId = "request:one", messageRef = "message:run"): Extract<ConversationRequest, { kind: "run-direct" }> {
  return { kind: "run-direct", focus: session.focus().token, target: main, messageRef, requestId };
}

test("actual status and incidental questions preserve focus and all project bytes", async () => fixture(async (value) => {
  const session = new ConversationSession({ projects: [{ projectRef: "project", controller: value.controller }],
    tasks: [{ ...main, input: hostInput(value) }] });
  await session.handle({ kind: "focus", target: main, focus: session.focus().token, messageRef: "message:main" });
  const focused = session.focus();
  const before = await tree(value.root);
  const status = await session.handle({ kind: "status", focus: focused.token, messageRef: "message:status" });
  assert.equal(status.kind, "status");
  if (status.kind === "status") assert.equal(status.status.queue.items[0]?.status, "planned");
  assert.equal((await session.handle({ kind: "question", focus: focused.token, messageRef: "message:question" })).kind, "question");
  assert.deepEqual(session.focus(), focused);
  assert.deepEqual(await tree(value.root), before);
}));

test("a delayed actual status result is stale after a focus switch without overwriting the new pointer", async () => fixture(async (value) => {
  const entered = deferred(); const release = deferred();
  const originalStatus = value.controller.status.bind(value.controller);
  value.controller.status = async () => {
    const observed = await originalStatus();
    entered.resolve(); await release.promise;
    return observed;
  };
  const session = new ConversationSession({ projects: [{ projectRef: "project", controller: value.controller }],
    tasks: [{ ...main, input: hostInput(value) }, { ...side, input: hostInput(value) }] });
  await session.handle({ kind: "focus", target: main, focus: session.focus().token, messageRef: "message:main" });
  const before = await tree(value.root);
  const pending = session.handle({ kind: "status", focus: session.focus().token, messageRef: "message:status" });
  await entered.promise;
  await session.handle({ kind: "focus", target: side, temporary: true, focus: session.focus().token, messageRef: "message:side" });
  const switched = session.focus();
  release.resolve();
  const result = await pending;
  assert.equal(result.kind, "status");
  if (result.kind === "status") {
    assert.equal(result.staleFocus, true);
    assert.equal(result.status.queue.items[0]?.status, "planned");
  }
  assert.deepEqual(session.focus(), switched);
  assert.deepEqual(await tree(value.root), before);
}));

test("facade runs a host-bound real Git task once and rejects repeated provenance", async () => fixture(async (value) => {
  let calls = 0;
  const input = hostInput(value);
  const originalFactory = input.executorFactory;
  input.executorFactory = (context) => { calls++; return originalFactory(context); };
  const session = new ConversationSession({ projects: [{ projectRef: "project" }], tasks: [{ ...main, input }] });
  await session.handle({ kind: "focus", target: main, focus: session.focus().token, messageRef: "message:main" });
  const request = runRequest(session);
  const receipt = await session.handle(request);
  assert.equal(receipt.kind, "direct-result");
  if (receipt.kind !== "direct-result") assert.fail("missing direct result");
  assert.equal(receipt.result.acceptance.accepted, true, receipt.result.reason);
  assert.equal(receipt.staleFocus, false);
  assert.equal(session.focus().current?.runId, receipt.result.runId);
  assert.equal(await readFile(path.join(receipt.result.candidatePath, "value.txt"), "utf8"), "after");
  assert.equal(await readFile(path.join(value.sourceRepo, "value.txt"), "utf8"), "before");
  await assert.rejects(session.handle(request), /provenance|request.*used/);
  await assert.rejects(session.handle({ ...runRequest(session), requestId: "request:two" }), /provenance|message.*used/);
  await assert.rejects(session.handle({ ...runRequest(session), messageRef: "message:other" }), /provenance|request.*used/);
  assert.equal(calls, 1);
}));

test("switching focus preserves the mainline while late completion stays on its original task", async () => fixture(async (value) => {
  const entered = deferred(); const release = deferred();
  const input = hostInput(value, ({ tools }) => ({ async *execute(request, signal) {
    entered.resolve(); await release.promise;
    await tools.find((tool) => tool.name === "sparkle_patch_file")!.execute("patch", { path: "value.txt", oldText: "before", newText: "after" }, signal);
    yield* new ProtocolChildExecutor().execute(request, signal);
  } }));
  const session = new ConversationSession({ projects: [{ projectRef: "project", controller: value.controller }],
    tasks: [{ ...main, input }, { ...side, input: hostInput(value) }] });
  await session.handle({ kind: "focus", target: main, focus: session.focus().token, messageRef: "message:main" });
  const request = runRequest(session);
  const pending = session.handle(request);
  await entered.promise;
  await session.handle({ kind: "focus", target: side, temporary: true, focus: session.focus().token, messageRef: "message:side" });
  const temporary = session.focus();
  await assert.rejects(session.handle({ kind: "run-direct", target: side, focus: temporary.token, requestId: "request:side", messageRef: "message:side-run" }), /active|busy/);
  await session.handle({ kind: "status", focus: temporary.token, messageRef: "message:status" });
  release.resolve();
  const result = await pending;
  assert.equal(result.kind, "direct-result");
  if (result.kind === "direct-result") assert.equal(result.staleFocus, true);
  assert.deepEqual(session.focus(), temporary);
  await session.handle({ kind: "restore", focus: temporary.token, messageRef: "message:restore" });
  assert.deepEqual(session.focus().current, main);
}));

test("requests cannot override host authority or evaluate accessor fields", async () => fixture(async (value) => {
  const session = new ConversationSession({ projects: [{ projectRef: "project" }], tasks: [{ ...main, input: hostInput(value) }] });
  await session.handle({ kind: "focus", target: main, focus: session.focus().token, messageRef: "message:main" });
  for (const key of ["sourceRepo", "verification", "executorFactory", "apply", "presentation"]) {
    await assert.rejects(session.handle({ ...runRequest(session), [key]: "override" } as never), /unsupported/);
  }
  let reads = 0;
  const request = Object.defineProperty({ ...runRequest(session) }, "target", { get() { reads++; return main; } });
  await assert.rejects(session.handle(request), /ordinary|accessor/);
  assert.equal(reads, 0);
  await assert.rejects(session.handle({ ...runRequest(session), target: { ...main, taskRef: "unknown" } }), /unknown/);
  await assert.rejects(session.handle({ ...runRequest(session), kind: "apply" } as never), /unsupported/);
  assert.equal(git(value.sourceRepo, ["status", "--porcelain"]), "");
}));

test("registered nested task definitions are snapshotted while verifier capabilities keep identity", async () => fixture(async (value) => {
  const input = { ...hostInput(value), acceptanceCriteria: [{ id: "value", description: "Original criterion", observableCheck: "Original check" }] };
  const descriptor = prepareTrustedVerification(input.verification);
  const registered = { ...input, verification: { ...input.verification, trustedVerification: descriptor } };
  const originalFactory = registered.executorFactory;
  registered.executorFactory = (context) => {
    assert.equal(context.objective.includes("MUTATED"), false);
    assert.equal(context.acceptanceCriteria?.[0]?.description, "Original criterion");
    return originalFactory(context);
  };
  const session = new ConversationSession({ projects: [{ projectRef: "project" }], tasks: [{ ...main, input: registered }] });
  registered.objective = "MUTATED";
  registered.verification.args[1] = "process.exit(2)";
  registered.acceptanceCriteria[0]!.description = "MUTATED";
  registered.executorFactory = () => { throw new Error("MUTATED"); };
  await session.handle({ kind: "focus", target: main, focus: session.focus().token, messageRef: "message:main" });
  const result = await session.handle(runRequest(session));
  assert.equal(result.kind, "direct-result");
  if (result.kind === "direct-result") assert.equal(result.result.acceptance.accepted, true, result.result.reason);
}));

test("full provenance capacity refuses another dispatch without evicting replay protection", async () => fixture(async (value) => {
  let calls = 0; const input = hostInput(value); const original = input.executorFactory;
  input.executorFactory = (context) => { calls++; return original(context); };
  const session = new ConversationSession({ projects: [{ projectRef: "project" }], tasks: [{ ...main, input }], maxRequests: 1 });
  await session.handle({ kind: "focus", target: main, focus: session.focus().token, messageRef: "message:main" });
  const first = runRequest(session);
  await session.handle(first);
  await assert.rejects(session.handle(runRequest(session, "request:second", "message:second")), /capacity/);
  await assert.rejects(session.handle(first), /provenance|request.*used/);
  assert.equal(calls, 1);
}));

test("cancellation waits for the existing task to finish before releasing the active slot", async () => fixture(async (value) => {
  const entered = deferred(); const cancelled = deferred(); const release = deferred();
  const input = hostInput(value, () => ({ async *execute(_request, signal) {
    entered.resolve();
    if (signal.aborted) cancelled.resolve(); else signal.addEventListener("abort", cancelled.resolve, { once: true });
    await cancelled.promise; await release.promise;
    yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
  } }));
  const session = new ConversationSession({ projects: [{ projectRef: "project" }], tasks: [{ ...main, input }] });
  await session.handle({ kind: "focus", target: main, focus: session.focus().token, messageRef: "message:main" });
  const abort = new AbortController();
  let returned = false;
  const pending = session.handle(runRequest(session), abort.signal).then((result) => { returned = true; return result; });
  await entered.promise; abort.abort(); await cancelled.promise; await setImmediate();
  assert.equal(returned, false);
  await assert.rejects(session.handle(runRequest(session, "request:second", "message:second")), /active|busy/);
  release.resolve(); const result = await pending;
  assert.equal(result.kind, "direct-result");
  if (result.kind === "direct-result") assert.equal(result.result.status, "CANCELLED");
}));

test("an execution exception conservatively fences new direct work", async () => fixture(async (value) => {
  const session = new ConversationSession({ projects: [{ projectRef: "project", controller: value.controller }], tasks: [{ ...main, input: hostInput(value) }] });
  await session.handle({ kind: "focus", target: main, focus: session.focus().token, messageRef: "message:main" });
  await writeFile(path.join(value.sourceRepo, "untracked.txt"), "dirty source");
  await assert.rejects(session.handle(runRequest(session)), /clean/);
  await rm(path.join(value.sourceRepo, "untracked.txt"));
  await assert.rejects(session.handle(runRequest(session, "request:second", "message:second")), /reconcil|fenced/);
  assert.equal((await session.handle({ kind: "status", focus: session.focus().token, messageRef: "message:status" })).kind, "status");
}));

test("actual unsettled effects retain their evidence and fence a fresh direct request", async () => fixture(async (value) => {
  let calls = 0; const input = hostInput(value); const original = input.executorFactory;
  const session = new ConversationSession({ projects: [{ projectRef: "project", controller: value.controller }], tasks: [{ ...main,
    input: { ...input, verification: { command: process.execPath, args: ["-e", "process.exit(3)"], unsettledExitCodes: [3] },
      executorFactory: (context) => { calls++; return original(context); } } }, { ...side,
    input: { ...hostInput(value), executorFactory: (context) => { calls++; return original(context); } } }] });
  await session.handle({ kind: "focus", target: main, focus: session.focus().token, messageRef: "message:main" });
  const result = await session.handle(runRequest(session));
  assert.equal(result.kind, "direct-result");
  if (result.kind !== "direct-result") assert.fail("missing direct result");
  assert.equal(result.result.effectsSettled, false);
  assert.equal(result.result.acceptance.accepted, false);
  assert.ok(await readFile(result.result.artifact.path, "utf8"));
  assert.equal(await readFile(path.join(result.result.candidatePath, "value.txt"), "utf8"), "after");
  await session.handle({ kind: "focus", target: side, temporary: true, focus: session.focus().token, messageRef: "message:other" });
  await assert.rejects(session.handle({ kind: "run-direct", target: side, focus: session.focus().token,
    requestId: "request:second", messageRef: "message:second" }), /reconcil|fenced/);
  assert.equal((await session.handle({ kind: "status", focus: session.focus().token, messageRef: "message:status" })).kind, "status");
  assert.equal(calls, 1);
  assert.equal(await readFile(path.join(value.sourceRepo, "value.txt"), "utf8"), "before");
}));

for (const field of ["args", "tasks", "maxRequests"]) {
  test(`registration refuses malformed null ${field} instead of replacing the host definition`, async () => fixture(async (value) => {
    const input = hostInput(value);
    const options = { projects: [{ projectRef: "project" }], tasks: [{ ...main, input }] };
    const malformed = field === "args"
      ? { ...options, tasks: [{ ...main, input: { ...input, verification: { ...input.verification, args: null } } }] }
      : { ...options, [field]: null };
    assert.throws(() => new ConversationSession(malformed as never), /array|integer/);
  }));
}
