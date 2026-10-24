import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";

import path from "node:path";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import { createModels, fauxAssistantMessage, fauxProvider, type Model } from "@earendil-works/pi-ai";
import { stream as streamAnthropic } from "@earendil-works/pi-ai/api/anthropic-messages";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import { type ConversationSessionOptions, type ConversationResponse } from "../../../src/conversation/session.js";
import { DevelopmentController } from "../../../src/development/controller.js";
import { WorkItemStore } from "../../../src/development/work-item-store.js";
import { createWorkQueue } from "../../../src/development/work-items.js";
import type { ConversationFocusSnapshot, ConversationTarget } from "../../../src/conversation/focus.js";
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
  await mkdir(path.join(process.cwd(), ".agent_workspace/conversation-tools-20261020"), { recursive: true });
  const root = await mkdtemp(path.join(process.cwd(), ".agent_workspace/conversation-tools-20261020/fixture-"));
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
const loaderUrl = new URL("./core/extensions/loader.js", import.meta.resolve("@earendil-works/pi-coding-agent"));
async function load(options: ConversationSessionOptions, initializer?: unknown) {
  await mkdir(path.join(process.cwd(), ".agent_workspace/conversation-tools-20261020"), { recursive: true });
  const directory = await mkdtemp(path.join(process.cwd(), ".agent_workspace/conversation-tools-20261020/wrapper-"));
  const key = `sparkle-test-${directory}`;
  const globals = globalThis as unknown as Record<string, unknown>;
  globals[key] = { options, initializer };
  const wrapper = path.join(directory, "extension.ts");
  await writeFile(wrapper, `import { createSparkleExtension } from ${JSON.stringify(path.join(process.cwd(), "extensions/pi-sparkle/index.ts").replaceAll("\\", "/"))};\nconst configuration = globalThis[${JSON.stringify(key)}]; configuration.initializer ??= createSparkleExtension({ conversation: configuration.options }); export default configuration.initializer;\n`, "utf8");
  try {
    const { loadExtensions } = await import(loaderUrl.href);
    const result = await loadExtensions([wrapper], process.cwd());
    assert.deepEqual(result.errors, [], "trusted wrapper must initialize through the real Pi loader");
    result.runtime.getSettings = () => ({}); // Explicit synthetic host settings after loading.
    const extension = result.extensions[0]!;
    async function execute(name: string, params: unknown, signal?: AbortSignal) {
      const tool = extension.tools.get(name);
      assert.ok(tool, `registered ${name}`);
      return tool.definition.execute("test", params, signal, undefined, {});
    }
    return {
      extension, execute, initializer: (globals[key] as { initializer: unknown }).initializer,
      async focus(params: unknown = {}) { return (await execute("sparkle_conversation_focus", params)).details as { refs: readonly ConversationTarget[]; focus: ConversationFocusSnapshot }; },
      async request(params: unknown, signal?: AbortSignal) { return (await execute("sparkle_conversation", params, signal)).details as ConversationResponse; },
      async shutdown() { for (const handler of extension.handlers.get("session_shutdown") ?? []) await handler({}, {}); }
    };
  } finally { delete globals[key]; await rm(directory, { recursive: true, force: true }); }
}

test("configured loader isolates references and tokens while refusing model authority and accessors", async () => fixture(async (value) => {
  const options = { projects: [{ projectRef: "project", controller: value.controller }], tasks: [{ ...main, input: hostInput(value) }, { ...side, input: hostInput(value) }] };
  const first = await load(options); const second = await load(options, first.initializer);
  const initial = await first.focus();
  assert.deepEqual(initial.refs, [{ projectRef: "project" }, main, side]);
  assert.equal(JSON.stringify(initial).includes(value.root), false);
  assert.equal(JSON.stringify(initial).includes("executorFactory"), false);
  const before = await tree(value.root);
  await first.request({ kind: "focus", target: main, focus: initial.focus.token, messageRef: "focus" });
  const focused = (await first.focus()).focus;
  await assert.rejects(second.request({ kind: "question", focus: focused.token, messageRef: "q" }), /stale/);
  for (let i = 0; i < 2; i++) {
    await first.request({ kind: "question", focus: focused.token, messageRef: "repeat" });
    await first.request({ kind: "status", focus: focused.token, messageRef: "repeat" });
  }
  assert.deepEqual((await first.focus()).focus, focused);
  assert.deepEqual(await tree(value.root), before);
  assert.equal((await second.focus()).focus.current, undefined);
  for (const key of ["sourceRepo", "verification", "executorFactory", "authority", "checker", "path", "taskContext"]) {
    await assert.rejects(first.request({ kind: "question", focus: focused.token, messageRef: "bad", [key]: "override" }), /unsupported/);
    await assert.rejects(first.focus({ [key]: "override" }), /unsupported/);
  }
  let reads = 0;
  await assert.rejects(first.request(Object.defineProperty({ kind: "focus", focus: focused.token, messageRef: "bad" }, "target", { get() { reads++; return main; } })), /ordinary|accessor/);
  await assert.rejects(first.focus(Object.defineProperty({}, "path", { get() { reads++; return "secret"; } })), /unsupported|ordinary/);
  assert.equal(reads, 0);
  await assert.rejects(first.request({ kind: "focus", focus: focused.token, messageRef: "bad", target: { projectRef: "missing" } }), /unknown/);
  await first.shutdown(); await second.shutdown();
}));

test("configured handler executes a checked Git candidate with direct-only provenance and no apply authority", async () => fixture(async (value) => {
  const api = await load({ projects: [{ projectRef: "project" }], tasks: [{ ...main, input: hostInput(value) }] });
  await api.request({ kind: "focus", target: main, focus: (await api.focus()).focus.token, messageRef: "focus" });
  const request = { kind: "run-direct", target: main, focus: (await api.focus()).focus.token, messageRef: "run", requestId: "one" };
  const result = await api.request(request);
  assert.equal(result.kind, "direct-result");
  if (result.kind !== "direct-result") throw new Error("expected direct result");
  assert.equal(result.result.acceptance.accepted, true, result.result.reason);
  assert.equal(await readFile(path.join(result.result.candidatePath!, "value.txt"), "utf8"), "after");
  assert.equal(await readFile(path.join(value.sourceRepo, "value.txt"), "utf8"), "before");
  assert.equal(git(value.sourceRepo, ["status", "--porcelain"]), "");
  for (const duplicate of [request, { ...request, requestId: "two" }, { ...request, messageRef: "other" }]) await assert.rejects(api.request(duplicate), /provenance/);
  await assert.rejects(api.execute("sparkle_apply_candidate", { issue: { runId: result.result.runId, artifactId: "none", candidatePath: result.result.candidatePath }, candidatePath: result.result.candidatePath }), /not issued/);
  await api.shutdown();
}));

test("late handler completion preserves temporary focus and restore", async () => fixture(async (value) => {
  const entered = deferred(); const release = deferred();
  const input = hostInput(value, ({ tools }) => ({ async *execute(request, signal) {
    entered.resolve(); await release.promise;
    await tools.find((tool) => tool.name === "sparkle_patch_file")!.execute("patch", { path: "value.txt", oldText: "before", newText: "after" }, signal);
    yield* new ProtocolChildExecutor().execute(request, signal);
  } }));
  const api = await load({ projects: [{ projectRef: "project" }], tasks: [{ ...main, input }, { ...side, input: hostInput(value) }] });
  await api.request({ kind: "focus", target: main, focus: (await api.focus()).focus.token, messageRef: "main" });
  const pending = api.request({ kind: "run-direct", target: main, focus: (await api.focus()).focus.token, requestId: "run", messageRef: "run" });
  await entered.promise;
  await api.request({ kind: "focus", target: side, temporary: true, focus: (await api.focus()).focus.token, messageRef: "side" });
  const temporary = (await api.focus()).focus;
  await assert.rejects(api.request({ kind: "run-direct", target: side, focus: temporary.token, requestId: "other", messageRef: "other" }), /active/);
  release.resolve();
  const result = await pending;
  assert.equal(result.kind, "direct-result");
  if (result.kind === "direct-result") { assert.equal(result.staleFocus, true); assert.deepEqual(result.target, main); }
  assert.deepEqual((await api.focus()).focus, temporary);
  await api.request({ kind: "restore", focus: temporary.token, messageRef: "restore" });
  assert.deepEqual((await api.focus()).focus.current, main);
  await api.shutdown();
}));

for (const cancellation of ["handler", "shutdown"] as const) {
  test(`${cancellation} cancellation keeps the actual handler pending until its worker settles`, async () => fixture(async (value) => {
    const entered = deferred(); const cancelled = deferred(); const release = deferred();
    const input = hostInput(value, () => ({ async *execute(request, signal) {
      entered.resolve();
      if (signal.aborted) cancelled.resolve(); else signal.addEventListener("abort", cancelled.resolve, { once: true });
      await cancelled.promise; await release.promise;
      yield* new ProtocolChildExecutor().execute(request, signal);
    } }));
    const api = await load({ projects: [{ projectRef: "project" }], tasks: [{ ...main, input }] });
    await api.request({ kind: "focus", target: main, focus: (await api.focus()).focus.token, messageRef: "focus" });
    const focused = (await api.focus()).focus;
    const abort = new AbortController();
    let returned = false; let closed = false;
    const pending = api.request({ kind: "run-direct", target: main, focus: focused.token, requestId: "run", messageRef: "run" }, abort.signal).then((result) => { returned = true; return result; });
    await entered.promise;
    const closing = cancellation === "shutdown" ? api.shutdown().then(() => { closed = true; }) : undefined;
    if (cancellation === "handler") abort.abort();
    await cancelled.promise; await setImmediate();
    assert.equal(returned, false); assert.equal(closed, false);
    if (cancellation === "shutdown") {
      await assert.rejects(api.focus(), /shut down/);
      await assert.rejects(api.request({ kind: "question", focus: focused.token, messageRef: "late" }), /shut down/);
    } else {
      await assert.rejects(api.request({ kind: "run-direct", target: main, focus: focused.token, requestId: "second", messageRef: "second" }), /active/);
    }
    release.resolve();
    const result = await pending;
    assert.equal(result.kind, "direct-result");
    if (result.kind === "direct-result") { assert.equal(result.result.acceptance.accepted, false); assert.match(result.result.reason, /cancel/); }
    await closing; await api.shutdown(); await api.shutdown();
    assert.equal(await readFile(path.join(value.sourceRepo, "value.txt"), "utf8"), "before");
  }));
}

test("shutdown waits for every pending request even when another request rejects", async () => fixture(async (value) => {
  const firstEntered = deferred(); const secondEntered = deferred(); const firstRelease = deferred(); const secondRelease = deferred();
  const original = value.controller.status.bind(value.controller);
  let calls = 0;
  value.controller.status = async () => {
    calls++;
    if (calls === 1) { firstEntered.resolve(); await firstRelease.promise; throw new Error("status failed"); }
    secondEntered.resolve(); await secondRelease.promise; return original();
  };
  const api = await load({ projects: [{ projectRef: "project", controller: value.controller }] });
  const nativeEntered = deferred(); const nativeCancelled = deferred(); const nativeRelease = deferred();
  const faux = fauxProvider({ provider: "fixture", models: [{ id: "grok-4.7" }] });
  faux.setResponses([async (_context, options) => {
    nativeEntered.resolve();
    assert.ok(options?.signal);
    if (options.signal.aborted) nativeCancelled.resolve(); else options.signal.addEventListener("abort", nativeCancelled.resolve, { once: true });
    await nativeRelease.promise;
    return fauxAssistantMessage("cancelled");
  }]);
  const models = createModels(); models.setProvider(faux.provider);
  const native = api.extension.tools.get("sparkle_delegate")!.definition.execute("native", { tasks: [{ role: "scout", objective: "Inspect value.txt" }] }, undefined, undefined, {
    cwd: value.sourceRepo, scopedModels: [], model: faux.getModel(), thinkingLevel: "off", getSystemPrompt: () => "EXPLICIT_SYNTHETIC_HOST_PROMPT",
    modelRegistry: { getAvailable: () => faux.models, streamSimple: models.streamSimple.bind(models) }
  });
  await nativeEntered.promise;
  const focus = (await api.focus()).focus.token;
  const first = api.request({ kind: "status", projectRef: "project", focus, messageRef: "one" });
  const firstFailure = assert.rejects(first, /status failed/);
  await firstEntered.promise;
  const second = api.request({ kind: "status", projectRef: "project", focus, messageRef: "two" });
  await secondEntered.promise;
  let finished = false;
  const closing = api.shutdown().then(() => { finished = true; }, (error: unknown) => { finished = true; throw error; });
  const shutdownFailure = assert.rejects(closing, /failed operations/);
  await nativeCancelled.promise;
  firstRelease.resolve(); await firstFailure; await setImmediate();
  assert.equal(finished, false);
  await assert.rejects(api.focus(), /shut down/);
  nativeRelease.resolve(); await native;
  secondRelease.resolve(); await second; await shutdownFailure;
  await assert.rejects(api.shutdown(), /failed operations/);
}));

test("configured kill switch disables all tools and lifecycle hooks", async () => {
  const previous = process.env.SPARKLE_NATIVE;
  try {
    process.env.SPARKLE_NATIVE = "0";
    const api = await load({ projects: [] });
    assert.equal(api.extension.tools.size, 0);
    assert.equal(api.extension.commands.size, 0);
    assert.equal(api.extension.handlers.size, 0);
  } finally {
    if (previous === undefined) delete process.env.SPARKLE_NATIVE; else process.env.SPARKLE_NATIVE = previous;
  }
});


test("handler retains unsettled candidate evidence and refuses another direct writer", async () => fixture(async (value) => {
  const input = hostInput(value);
  const api = await load({ projects: [{ projectRef: "project" }], tasks: [{ ...main,
    input: { ...input, verification: { command: process.execPath, args: ["-e", "process.exit(3)"], unsettledExitCodes: [3] } } },
    { ...side, input: hostInput(value) }] });
  await api.request({ kind: "focus", target: main, focus: (await api.focus()).focus.token, messageRef: "focus" });
  const result = await api.request({ kind: "run-direct", target: main, focus: (await api.focus()).focus.token, requestId: "one", messageRef: "one" });
  assert.equal(result.kind, "direct-result");
  if (result.kind !== "direct-result") throw new Error("expected direct result");
  assert.equal(result.result.effectsSettled, false);
  assert.equal(result.result.acceptance.accepted, false);
  assert.ok(await readFile(result.result.artifact.path, "utf8"));
  assert.equal(await readFile(path.join(result.result.candidatePath, "value.txt"), "utf8"), "after");
  await api.request({ kind: "focus", target: side, focus: (await api.focus()).focus.token, messageRef: "side" });
  await assert.rejects(api.request({ kind: "run-direct", target: side, focus: (await api.focus()).focus.token, requestId: "two", messageRef: "two" }), /fenced/);
  assert.equal(await readFile(path.join(value.sourceRepo, "value.txt"), "utf8"), "before");
  await api.shutdown();
}));

test("Anthropic request construction retains conversation arguments without strict sampling", async () => {
  const api = await load({ projects: [{ projectRef: "project" }] });
  const tool = api.extension.tools.get("sparkle_conversation")!.definition;
  const model: Model<"anthropic-messages"> = {
    ...fauxProvider().getModel(), api: "anthropic-messages", provider: "offline-anthropic", id: "claude-test",
    baseUrl: "http://127.0.0.1:1"
  };
  let payload: unknown;
  let fetchCalls = 0;
  const response = await streamAnthropic(model, normalizeContext({ messages: [
    { role: "system", content: "Inspect available tools", toolsAdded: [tool], timestamp: 0 },
    { role: "user", content: "Read conversation focus", timestamp: 1 }
  ] }), {
    apiKey: "offline-test-key", maxTokens: 16, env: {}, maxRetries: 0,
    fetch: async () => { fetchCalls++; throw new Error("offline test refuses transport"); },
    onPayload(value) { payload = value; throw new Error("offline payload captured before transport"); }
  }).result();
  assert.equal(fetchCalls, 0, "payload inspection must terminate before HTTP transport");
  assert.equal(response.stopReason, "error");
  assert.match(response.errorMessage ?? "", /offline payload captured/);
  const request = payload as { tools: { name: string; strict?: boolean; input_schema: { properties: Record<string, unknown>; required: string[] } }[] };
  const outgoing = request.tools.find((entry) => entry.name === "sparkle_conversation")!;
  assert.notEqual(outgoing.strict, true, "exercise the pinned provider's non-strict conversion path");
  assert.deepEqual(Object.keys(outgoing.input_schema.properties).sort(), ["focus", "kind", "messageRef", "projectRef", "requestId", "target", "temporary"]);
  assert.deepEqual([...outgoing.input_schema.required].sort(), ["focus", "kind", "messageRef"]);
  const base = { focus: (await api.focus()).focus.token, messageRef: "invalid" };
  for (const branch of [
    { kind: "question", target: main }, { kind: "status", target: main },
    { kind: "focus", target: main, requestId: "invalid" }, { kind: "restore", projectRef: "project" },
    { kind: "run-direct", target: main, requestId: "invalid", temporary: true }
  ]) await assert.rejects(api.request({ ...base, ...branch }), /unsupported/);
  await assert.rejects(api.request({ ...base, kind: "focus" }), /target.*plain object/);
  await assert.rejects(api.request({ ...base, kind: "run-direct", target: main }), /requestId/);
  await api.shutdown();
});
