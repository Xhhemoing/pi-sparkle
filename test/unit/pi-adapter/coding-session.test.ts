import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import type { AgentTool, ThinkingLevel } from "@earendil-works/pi-agent-core";
import { Type, InMemoryCredentialStore, getCurrentTools, getCurrentSystemPrompt, createModels, fauxProvider, fauxAssistantMessage, fauxToolCall, type TranscriptContext, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { AgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createControlledCodingSession } from "../../../src/pi-adapter/coding-session.js";

function latch() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
async function fixture(suffix: string, tools: AgentTool[] = [], stop = false, prepare?: (cwd: string) => Promise<void>, thinkingLevel: ThinkingLevel = "off", systemPrompt = "CONTROLLED_SYSTEM") {
  const parent = join(process.cwd(), ".agent_workspace", "phase0-sdk", "session-tests");
  await mkdir(parent, { recursive: true });
  const cwd = await mkdtemp(join(parent, `${suffix}-`));
  await prepare?.(cwd);
  const faux = fauxProvider({ provider: `controlled-session-${suffix}`, models: [{ id: "synthetic" }] });
  const model = faux.getModel(), models = createModels();
  models.setProvider(faux.provider);
  const dispatchContexts: TranscriptContext[] = [];
  const dispatchOptions: Array<SimpleStreamOptions | undefined> = [];
  const session = await createControlledCodingSession({ cwd, model, tools, thinkingLevel, systemPrompt,
    streamFn: (selected, context, options) => {
      dispatchContexts.push(context); dispatchOptions.push(options);
      assert.equal(selected, model, "host dispatch preserves the exact host model object");
      return models.streamSimple(selected, context, options);
    }, shouldStopAfterTurn: () => stop });
  return { cwd, faux, model, session, dispatchContexts, dispatchOptions };
}
function heldTool(entered: ReturnType<typeof latch>, release: ReturnType<typeof latch>, terminate = false): AgentTool {
  return { name: "read", label: "Owned read", description: "Synthetic controlled tool", parameters: Type.Object({}),
    execute: async () => { entered.release(); await release.promise;
      return { content: [{ type: "text", text: "OWNED_TOOL_RESULT" }], details: {}, ...(terminate ? { terminate: true } : {}) };
    } };
}

test("real public SDK prompt executes an owned builtin-name override and exact host model", { timeout: 10000 }, async () => {
  const entered = latch(), release = latch(); release.release();
  let promptCalls = 0;
  const original = AgentSession.prototype.prompt;
  AgentSession.prototype.prompt = async function(...args: Parameters<typeof original>) { promptCalls++; return original.apply(this, args); };
  const read = heldTool(entered, release), write = { ...read, name: "write", parameters: Type.Object({ path: Type.String() }) };
  const tools = [read, write];
  const f = await fixture("factory", tools);
  let observed = false;
  try {
    f.faux.setResponses([fauxAssistantMessage(fauxToolCall("read", {})), (context) => {
      assert.deepEqual(getCurrentTools(context.messages).map((tool) => tool.name), ["read", "write"]);
      observed = JSON.stringify(context).includes("OWNED_TOOL_RESULT");
      return fauxAssistantMessage("done");
    }]);
    await f.session.prompt("Synthetic owned read");
    assert.equal(observed, true, "custom read executes instead of SDK builtin filesystem read");
    assert.equal(promptCalls, 1);
    assert.ok(f.dispatchContexts.length >= 2);
    for (const context of f.dispatchContexts) {
      assert.equal(getCurrentSystemPrompt(context.messages), "CONTROLLED_SYSTEM");
      assert.deepEqual(getCurrentTools(context.messages).map((tool) => ({ name: tool.name, parameters: tool.parameters })),
        tools.map((tool) => ({ name: tool.name, parameters: tool.parameters })));
    }
    assert.equal(f.faux.state.callCount, 2);
    assert.equal(f.session.errorMessage, undefined);
    assert.throws(() => f.session.steerText("late"), /closed/);
  } finally { AgentSession.prototype.prompt = original; f.session.dispose(); }
});

for (const [name, prompt] of [["empty", ""], ["opaque", "  HOST_ONLY\r\n保留原文\n  "]] as const) {
  test(`provider receives the exact ${name} host system prompt`, async () => {
    const f = await fixture(`prompt-${name}`, [], false, undefined, "off", prompt);
    try {
      f.faux.setResponses([fauxAssistantMessage("done")]);
      await f.session.prompt("Synthetic exact prompt");
      assert.equal(f.faux.state.callCount, 1);
      assert.equal(f.session.errorMessage, undefined);
      assert.equal(f.dispatchContexts.length, 1);
      assert.equal(getCurrentSystemPrompt(f.dispatchContexts[0]!.messages), prompt);
    } finally { f.session.dispose(); }
  });
}

test("accepted steering awaits serial public SDK delivery before the next provider request", { timeout: 10000 }, async () => {
  const entered = latch(), release = latch(), steerEntered = latch(), steerRelease = latch();
  const starts: string[] = [], completed: string[] = [];
  const original = AgentSession.prototype.steer;
  AgentSession.prototype.steer = async function(text, ...args) {
    starts.push(text);
    if (text === "FIRST") { steerEntered.release(); await steerRelease.promise; }
    const result = await original.call(this, text, ...args); completed.push(text); return result;
  };
  const f = await fixture("ordered", [heldTool(entered, release)]);
  let observed = false, running: Promise<void> | undefined;
  try {
    f.faux.setResponses([fauxAssistantMessage(fauxToolCall("read", {})), (context) => {
      const text = JSON.stringify(context.messages);
      observed = text.includes("FIRST") && text.indexOf("FIRST") < text.indexOf("SECOND") && text.includes("SECOND");
      return fauxAssistantMessage("done");
    }]);
    running = f.session.prompt("Synthetic steering"); await entered.promise;
    assert.equal(f.session.steerText("FIRST"), undefined); f.session.steerText("SECOND");
    await steerEntered.promise; assert.deepEqual(starts, ["FIRST"]);
    release.release(); await setImmediate(); assert.equal(f.faux.state.callCount, 1);
    steerRelease.release(); await running;
    assert.deepEqual(completed, ["FIRST", "SECOND"]); assert.equal(observed, true);
  } finally { release.release(); steerRelease.release(); await running; AgentSession.prototype.steer = original; f.session.dispose(); }
});

test("asynchronous SDK steering rejection is surfaced and never restarts provider work", { timeout: 10000 }, async () => {
  const entered = latch(), release = latch();
  const original = AgentSession.prototype.steer;
  AgentSession.prototype.steer = async function() { throw new Error("synthetic delivery rejection"); };
  const f = await fixture("rejection", [heldTool(entered, release)]);
  let running: Promise<void> | undefined;
  try {
    f.faux.setResponses([fauxAssistantMessage(fauxToolCall("read", {})), fauxAssistantMessage("forbidden")]);
    running = f.session.prompt("Synthetic rejection"); const settled = assert.rejects(running, /synthetic delivery rejection/);
    await entered.promise; f.session.steerText("FIRST"); f.session.steerText("SECOND"); release.release();
    await settled; await f.session.waitForIdle(); assert.equal(f.faux.state.callCount, 1);
  } finally { release.release(); await running?.catch(() => undefined); AgentSession.prototype.steer = original; f.session.dispose(); }
});

test("hard turn stop clears queued steering without an SDK continuation", { timeout: 10000 }, async () => {
  const entered = latch(), release = latch();
  const f = await fixture("hard-stop", [heldTool(entered, release)], true);
  let running: Promise<void> | undefined;
  try {
    f.faux.setResponses([fauxAssistantMessage(fauxToolCall("read", {})), fauxAssistantMessage("forbidden")]);
    running = f.session.prompt("Synthetic budget stop"); await entered.promise;
    f.session.steerText("QUEUED"); release.release(); await running; await f.session.waitForIdle();
    assert.equal(f.faux.state.callCount, 1); assert.throws(() => f.session.steerText("late"), /closed/);
  } finally { release.release(); await running; f.session.dispose(); }
});

test("text turn_end replay is admitted and consumed through the public SDK queue", { timeout: 10000 }, async () => {
  const f = await fixture("text-replay"); let injected = false, observed = false;
  try {
    f.session.subscribe((event) => {
      if (event.type === "turn_end" && !injected) { injected = true; f.session.steerText("REPLAY"); }
    });
    f.faux.setResponses([fauxAssistantMessage("first final"), (context) => {
      observed = JSON.stringify(context.messages.at(-1)).includes("REPLAY"); return fauxAssistantMessage("done");
    }]);
    await f.session.prompt("Synthetic final text replay");
    assert.equal(injected, true); assert.equal(observed, true); assert.equal(f.faux.state.callCount, 2);
  } finally { f.session.dispose(); }
});

test("abort waits for a genuinely held tool and rejects new admission synchronously", { timeout: 10000 }, async () => {
  const entered = latch(), release = latch(); const f = await fixture("abort", [heldTool(entered, release)]);
  let running: Promise<void> | undefined;
  try {
    f.faux.setResponses([fauxAssistantMessage(fauxToolCall("read", {})), fauxAssistantMessage("forbidden")]);
    running = f.session.prompt("Synthetic held tool abort"); await entered.promise;
    assert.equal(f.session.abort(), undefined); assert.throws(() => f.session.steerText("late"), /closed/);
    let idle = false; const idleCompletion = f.session.waitForIdle().then(() => { idle = true; });
    await setImmediate(); assert.equal(idle, false);
    release.release(); await running; await idleCompletion; assert.equal(f.faux.state.callCount, 1);
  } finally { release.release(); await running; f.session.dispose(); }
});

test("owned loader and runtime avoid project discovery and pin every registration refresh", { timeout: 10000 }, async () => {
  const refresh = ModelRuntime.prototype.refresh;
  const seen: Parameters<typeof refresh>[0][] = [];
  ModelRuntime.prototype.refresh = async function(options) { seen.push(options); return refresh.call(this, options); };
  const createRuntime = ModelRuntime.create, createSession = SessionManager.create, createSettings = SettingsManager.create;
  const defaultReload = DefaultResourceLoader.prototype.reload, fetch = globalThis.fetch;
  let runtimeCreated = false;
  ModelRuntime.create = async function(options) {
    assert.ok(options?.credentials instanceof InMemoryCredentialStore);
    assert.equal(options.modelsPath, null); assert.equal(options.refreshOnCreate, false); assert.equal(options.allowModelNetwork, false);
    runtimeCreated = true; return createRuntime.call(this, options);
  };
  SessionManager.create = () => { throw new Error("disk session discovery forbidden"); };
  SettingsManager.create = () => { throw new Error("disk settings discovery forbidden"); };
  DefaultResourceLoader.prototype.reload = async () => { throw new Error("default resource discovery forbidden"); };
  globalThis.fetch = async () => { throw new Error("ambient network forbidden"); };
  let f: Awaited<ReturnType<typeof fixture>> | undefined, observed = false;
  try {
    f = await fixture("resources", [], false, async (cwd) => {
      await writeFile(join(cwd, "AGENTS.md"), "AMBIENT_CONTEXT_MUST_NOT_APPEAR", "utf8");
      await mkdir(join(cwd, ".pi", "extensions"), { recursive: true });
      await writeFile(join(cwd, ".pi", "extensions", "tripwire.ts"), "throw new Error('AMBIENT_EXTENSION_EXECUTED');", "utf8");
    });
    assert.equal(runtimeCreated, true);
    f.faux.setResponses([(context) => { const serialized = JSON.stringify(context);
      observed = serialized.includes("CONTROLLED_SYSTEM") && !serialized.includes("AMBIENT_CONTEXT_MUST_NOT_APPEAR");
      return fauxAssistantMessage("done");
    }]);
    await f.session.prompt("Synthetic owned resources"); assert.equal(observed, true);
    assert.ok(seen.length > 0); for (const options of seen) {
      assert.deepEqual(options?.providers, [f.model.provider]); assert.equal(options?.allowNetwork, false);
    }
  } finally {
    ModelRuntime.prototype.refresh = refresh; ModelRuntime.create = createRuntime;
    SessionManager.create = createSession; SettingsManager.create = createSettings;
    DefaultResourceLoader.prototype.reload = defaultReload; globalThis.fetch = fetch;
    f?.session.dispose();
  }
});

test("abort during SDK input preparation waits for the owned prompt and forbids later dispatch", { timeout: 10000 }, async () => {
  const entered = latch(), release = latch();
  const original = AgentSession.prototype.prompt;
  AgentSession.prototype.prompt = async function(...args: Parameters<typeof original>) {
    entered.release(); await release.promise; return original.apply(this, args);
  };
  const f = await fixture("preparation-abort"); let running: Promise<void> | undefined;
  try {
    f.faux.setResponses([fauxAssistantMessage("forbidden")]);
    running = f.session.prompt("Synthetic pending SDK input"); await entered.promise; f.session.abort();
    let idle = false; const idleCompletion = f.session.waitForIdle().then(() => { idle = true; });
    await setImmediate(); assert.equal(idle, false, "session's raw idle does not settle an in-flight owned prompt");
    release.release(); await running; await idleCompletion;
    assert.equal(f.faux.state.callCount, 0, "abort before core starts must forbid later host dispatch");
  } finally { release.release(); await running; AgentSession.prototype.prompt = original; f.session.dispose(); }
});


test("terminating tool closes admission before settled observers", { timeout: 10000 }, async () => {
  const entered = latch(), release = latch(); release.release();
  const f = await fixture("terminate", [heldTool(entered, release, true)]);
  let settledObserved = false, admissionRejected = false;
  try {
    f.session.subscribe((event) => {
      if (event.type === "agent_settled") {
        settledObserved = true;
        try { f.session.steerText("late terminated input"); } catch { admissionRejected = true; }
      }
    });
    f.faux.setResponses([fauxAssistantMessage(fauxToolCall("read", {})), fauxAssistantMessage("forbidden")]);
    await f.session.prompt("Synthetic terminating tool");
    assert.equal(settledObserved, true); assert.equal(admissionRejected, true); assert.equal(f.faux.state.callCount, 1);
  } finally { f.session.dispose(); }
});

test("transient provider errors surface once without SDK retry, compaction, or replay admission", { timeout: 10000 }, async () => {
  const f = await fixture("provider-error"); let rejected = false;
  const forbiddenEvents: string[] = [];
  try {
    f.session.subscribe((event) => {
      if (event.type === "auto_retry_start" || event.type === "compaction_start") forbiddenEvents.push(event.type);
      if (event.type === "turn_end") {
        assert.throws(() => f.session.steerText("forbidden error replay"), /closed/); rejected = true;
      }
    });
    f.faux.setResponses([fauxAssistantMessage([], { stopReason: "error", errorMessage: "HTTP 503 synthetic transient" }),
      fauxAssistantMessage("forbidden retry")]);
    await f.session.prompt("Synthetic provider failure");
    assert.equal(rejected, true); assert.equal(f.faux.state.callCount, 1);
    assert.match(f.session.errorMessage ?? "", /HTTP 503 synthetic transient/); assert.deepEqual(forbiddenEvents, []);
  } finally { f.session.dispose(); }
});


test("registration refresh errors reject construction instead of becoming missing-model failures", async () => {
  const original = ModelRuntime.prototype.refresh;
  ModelRuntime.prototype.refresh = async function(options) {
    await original.call(this, options);
    return { aborted: false, errors: new Map([[options?.providers?.[0] ?? "unknown", new Error("synthetic registration failure")]]) };
  };
  let created: Awaited<ReturnType<typeof fixture>> | undefined;
  try {
    await assert.rejects(async () => { created = await fixture("registration-failure"); }, /synthetic registration failure/);
  } finally { ModelRuntime.prototype.refresh = original; created?.session.dispose(); }
});

test("unavailable delegated model rejects construction before prompting", async () => {
  const original = ModelRuntime.prototype.getAvailable;
  ModelRuntime.prototype.getAvailable = async () => [];
  let created: Awaited<ReturnType<typeof fixture>> | undefined;
  try {
    await assert.rejects(async () => { created = await fixture("unavailable-model"); }, /delegated model.*available/i);
  } finally { ModelRuntime.prototype.getAvailable = original; created?.session.dispose(); }
});


test("host-selected thinking level reaches transport even when the SDK capability default would clamp it", async () => {
  const f = await fixture("thinking-level", [], false, undefined, "low");
  try {
    f.faux.setResponses([fauxAssistantMessage("done")]); await f.session.prompt("Synthetic host options");
    assert.equal(f.dispatchOptions.length, 1); const options = f.dispatchOptions[0]; assert.ok(options);
    assert.equal(options.reasoning, "low"); assert.ok("toolExecution" in options);
    assert.equal(options.toolExecution, "parallel"); assert.ok(options.signal instanceof AbortSignal);
  } finally { f.session.dispose(); }
});
