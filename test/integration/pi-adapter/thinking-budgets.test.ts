import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { InMemoryCredentialStore, Type, createModels, fauxAssistantMessage, fauxProvider, fauxToolCall, normalizeContext,
  type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { createAgentSession, createExtensionRuntime, ModelRuntime, SessionManager, SettingsManager, type ResourceLoader } from "@earendil-works/pi-coding-agent";
import { createControlledCodingSession } from "../../../src/pi-adapter/coding-session.js";
import { PiAgentExecutor, type PiExecutorOptions } from "../../../src/pi-adapter/pi-executor.js";
import { createAgentInstanceId, createRunId, createTaskId } from "../../../src/domain/ids.js";
import { captureNativeHostContext } from "../../../src/pi-adapter/native-host-context.js";
import { createNativeWriteExecutorFactory } from "../../../src/pi-adapter/native-write-executor.js";
import { createNativeExecutor } from "../../../src/pi-adapter/native-executor.js";
import { createWorktreeCodingTools } from "../../../src/pi-adapter/worktree-coding-tools.js";
import type { AgentExecutor } from "../../../src/execution/contract.js";
import type { NativeWriteExecutorFactoryInput } from "../../../src/native/write-session.js";

function resources(): ResourceLoader {
  return { getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }), getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }), getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => "LOCAL THINKING CONFIGURATION", getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [],
    extendResources: () => { throw Error("ambient discovery forbidden"); }, reload: async () => { throw Error("reload forbidden"); } };
}
async function cwd(): Promise<string> {
  const parent = path.resolve(".agent_workspace/phase1-thinking-budgets"); await mkdir(parent, { recursive: true });
  return mkdtemp(path.join(parent, "sdk-"));
}
function local(responses = [fauxAssistantMessage("done")]) {
  const faux = fauxProvider({ provider: "thinking-budgets-local", models: [{ id: "primary", reasoning: true }, { id: "fallback", reasoning: true }] });
  const model = faux.getModel("primary")!; faux.setResponses(responses);
  const models = createModels(); models.setProvider(faux.provider);
  const wires: { reasoning: SimpleStreamOptions["reasoning"]; thinkingBudgets: SimpleStreamOptions["thinkingBudgets"] }[] = [];
  const stream: typeof models.streamSimple = (selected, context, options) => {
    wires.push({ reasoning: options?.reasoning, thinkingBudgets: options?.thinkingBudgets === undefined ? undefined : { ...options.thinkingBudgets } });
    return models.streamSimple(selected, context, options);
  };
  return { faux, model, models, wires, stream };
}
async function drain(executor: AgentExecutor, root: string) {
  for await (const _event of executor.execute({ runId: createRunId(), taskId: createTaskId(), agentInstanceId: createAgentInstanceId(),
    workingDirectory: root, prompt: "One synthetic local response" }, new AbortController().signal)) { /* Complete actual SDK settlement. */ }
}

test("direct SDK and controlled SDK preserve identical explicitly approved thinking budgets on the actual wire", async () => {
  const root = await cwd(), f = local([fauxAssistantMessage("direct"), fauxAssistantMessage("controlled")]);
  const budgets = { minimal: 0, low: -1, medium: 1.5, high: 1234 };
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  const refresh = runtime.refresh.bind(runtime), registrations: ReturnType<ModelRuntime["refresh"]>[] = [];
  runtime.refresh = (options = {}) => { const pending = refresh({ ...options, providers: [f.model.provider], allowNetwork: false }); registrations.push(pending); return pending; };
  runtime.registerNativeProvider({ id: f.model.provider, name: "Local only", getModels: () => [f.model],
    auth: { apiKey: { name: "Local", check: async () => ({ type: "api_key", source: "local" }), resolve: async () => ({ auth: {} }) } },
    stream: () => { throw Error("the independent SDK baseline must use its public simple-stream path"); },
    streamSimple: (selected, context, options) => f.stream(selected, normalizeContext({ messages: context.messages }), options) });
  await Promise.all(registrations);
  // Independent baseline: only the public SDK factory/settings, with no Sparkle snapshot helper.
  const { session: direct } = await createAgentSession({ cwd: root, modelRuntime: runtime, model: f.model, thinkingLevel: "high", tools: [],
    resourceLoader: resources(), sessionManager: SessionManager.inMemory(root), settingsManager: SettingsManager.inMemory({ thinkingBudgets: budgets,
      retry: { enabled: false, provider: { maxRetries: 0 } }, compaction: { enabled: false }, cacheWarming: "off" }) });
  const controlled = await createControlledCodingSession({ cwd: root, model: f.model, thinkingLevel: "high", systemPrompt: "LOCAL THINKING CONFIGURATION",
    tools: [], streamFn: f.stream, ...{ thinkingBudgets: budgets } });
  try {
    await direct.prompt("One local response"); await direct.waitForIdle();
    await controlled.prompt("One local response"); await controlled.waitForIdle();
    assert.equal(f.faux.state.callCount, 2); assert.equal(f.wires[0]!.reasoning, "high");
    assert.deepEqual(f.wires[0]!.thinkingBudgets, budgets); assert.deepEqual(f.wires[1], f.wires[0]);
  } finally { await direct.abort(); await direct.waitForIdle(); direct.dispose(); controlled.dispose(); }
});

test("controlled helper snapshots thinking budgets before its first runtime await", async () => {
  const root = await cwd(), f = local(), budgets = { high: 1234 };
  const pending = createControlledCodingSession({ cwd: root, model: f.model, thinkingLevel: "high", systemPrompt: "local", tools: [], streamFn: f.stream,
    ...{ thinkingBudgets: budgets } });
  budgets.high = 9999;
  const session = await pending;
  try { await session.prompt("local"); await session.waitForIdle(); assert.deepEqual(f.wires[0]!.thinkingBudgets, { high: 1234 });
    assert.equal(Object.isFrozen(budgets), false); } finally { session.dispose(); }
});

for (const continuation of ["turn", "retry", "fallback"] as const) test(`Pi executor keeps one thinking-budget snapshot across ${continuation}`, async () => {
  const root = await cwd(), budgets = { high: 1234 };
  const f = local([fauxAssistantMessage(continuation === "turn" ? fauxToolCall("continue", {}) : [], {
    stopReason: continuation === "turn" ? "toolUse" : "error", ...(continuation === "turn" ? {} : { errorMessage: "HTTP 503 local" }) }), fauxAssistantMessage("done")]);
  const options: PiExecutorOptions = { providerId: f.model.provider, modelId: f.model.id, thinkingLevel: "high", models: {
    ...f.models, getModel: f.models.getModel.bind(f.models), getProvider: f.models.getProvider.bind(f.models),
    streamSimple: (selected, context, streamOptions) => { const result = f.stream(selected, context, streamOptions); budgets.high = 9999; return result; }
  }, retry: { maxAttempts: continuation === "fallback" ? 1 : 2, sleep: async () => undefined },
    ...(continuation === "fallback" ? { fallbackModels: [{ providerId: f.model.provider, modelId: "fallback" }] } : {}),
    tools: [{ name: "continue", label: "continue", description: "local", parameters: Type.Object({}),
      execute: async () => ({ content: [{ type: "text", text: "continue" }], details: {} }) }], ...{ thinkingBudgets: budgets } };
  await drain(new PiAgentExecutor(options), root);
  assert.equal(f.wires.length, 2); for (const wire of f.wires) assert.deepEqual(wire.thinkingBudgets, { high: 1234 });
  assert.equal(Object.isFrozen(budgets), false);
});

for (const supplied of [undefined, {}]) test(`controlled omission/empty thinking budgets preserve SDK defaults (${supplied === undefined ? "omitted" : "empty"})`, async () => {
  const root = await cwd(), f = local();
  const session = await createControlledCodingSession({ cwd: root, model: f.model, thinkingLevel: "high", systemPrompt: "local", tools: [], streamFn: f.stream,
    ...(supplied === undefined ? {} : { thinkingBudgets: supplied }) });
  try { await session.prompt("local"); await session.waitForIdle(); assert.deepEqual(f.wires[0]!.thinkingBudgets, supplied); } finally { session.dispose(); }
});

test("captured host budgets survive a resource callback and are reused by readonly and write repair factories", async () => {
  const root = await cwd(), budgets = { high: 1234 }, f = local([fauxAssistantMessage("readonly"), fauxAssistantMessage("attempt1"), fauxAssistantMessage("attempt2")]);
  const host = captureNativeHostContext({ effectiveSystemPrompt: "local", thinkingLevel: "high", models: [f.model], defaultModel: f.model,
    streamSimple: f.stream, ...{ thinkingBudgets: budgets } });
  const resourceCallback = () => { budgets.high = 9999; return "host approved resource"; }; const payload = resourceCallback();
  await drain(createNativeExecutor({ projectRoot: root, effectiveSystemPrompt: host.effectiveSystemPrompt, thinkingLevel: host.thinkingLevel,
    models: [host.defaultModel], defaultModel: host.defaultModel, streamSimple: f.stream, approvedResourcePayload: payload,
    ...(host.thinkingBudgets === undefined ? {} : { thinkingBudgets: host.thinkingBudgets }) }), root);
  const factory = createNativeWriteExecutorFactory(Object.freeze({ ...host, approvedResourcePayload: payload }));
  for (let n = 1; n <= 2; n++) {
    const instance = await factory({ candidatePath: root, sourceRevision: "fixture", objective: "local", tools: createWorktreeCodingTools({ worktreeRoot: root }), signal: new AbortController().signal,
      attempt: { number: n, maxAttempts: 2 }, onInvocation: () => undefined, onCommandCleanupUnsettled: () => undefined } as NativeWriteExecutorFactoryInput);
    await drain(instance, root);
  }
  assert.equal(f.wires.length, 3); for (const wire of f.wires) assert.deepEqual(wire.thinkingBudgets, { high: 1234 });
  assert.equal(Object.isFrozen(budgets), false);
});

test("invalid helper or executor budget data refuses before an actual provider call or getter evaluation", async () => {
  const root = await cwd(), f = local();
  await assert.rejects(createControlledCodingSession({ cwd: root, model: f.model, thinkingLevel: "high", systemPrompt: "local", tools: [], streamFn: f.stream,
    thinkingBudgets: { high: NaN } }), /thinkingBudgets/);
  let reads = 0;
  const options = Object.defineProperty({ providerId: f.model.provider, modelId: f.model.id, models: f.models }, "thinkingBudgets", {
    get() { reads++; return { high: 1234 }; }
  });
  await assert.rejects(drain(new PiAgentExecutor(options), root), /thinkingBudgets/);
  assert.equal(reads, 0); assert.equal(f.wires.length, 0); assert.equal(f.faux.state.callCount, 0);
});
