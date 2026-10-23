import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
  InMemoryCredentialStore, fauxProvider, fauxAssistantMessage, fauxToolCall,
  getCurrentSystemPrompt, getCurrentTools, normalizeContext, type TranscriptContext, type SimpleStreamOptions
} from "@earendil-works/pi-ai";
import {
  createEventBus, AgentSession, ModelRuntime, SessionManager, SettingsManager, createAgentSession, createExtensionRuntime,
  type ContextWithSystemEvent, type Extension, type ResourceLoader
} from "@earendil-works/pi-coding-agent";

import { createSparkleExtension } from "../../../extensions/pi-sparkle/index.js";

const HOST_TEXT = "  FINAL_HOST\r\n中文\n  ";
const PARENT_ONLY = "PARENT_TRANSCRIPT_ONLY_MUST_NOT_CROSS";
const AMBIENT_ONLY = "AMBIENT_CONTEXT_MUST_NOT_APPEAR";

async function actualParentDelegation(systemPrompt: string, approvedResources?: (input: { cwd: string }) => unknown, retryWorker = false, wireOnly = false) {
  const scratch = join(process.cwd(), ".agent_workspace", "phase0-host-context");
  await mkdir(scratch, { recursive: true });
  const cwd = await mkdtemp(join(scratch, "actual-parent-"));
  await writeFile(join(cwd, "fixture.txt"), "OWNED_READ_RESULT", "utf8");
  await writeFile(join(cwd, "approved.txt"), "APPROVED_READ_RESULT", "utf8");
  await writeFile(join(cwd, "AGENTS.md"), AMBIENT_ONLY, "utf8");
  await mkdir(join(cwd, ".pi", "extensions"), { recursive: true });
  await writeFile(join(cwd, ".pi", "extensions", "tripwire.ts"), "throw new Error('AMBIENT_EXTENSION_EXECUTED');", "utf8");
  const loaderUrl = new URL("./core/extensions/loader.js", import.meta.resolve("@earendil-works/pi-coding-agent"));
  const { loadExtensions, loadExtensionFromFactory } = await import(loaderUrl.href);
  const loaded = await loadExtensions([join(process.cwd(), "extensions/pi-sparkle/index.ts")], cwd);
  assert.deepEqual(loaded.errors, []);
  if (approvedResources !== undefined) {
    const configured = createSparkleExtension({ approvedResources } as unknown as Parameters<typeof createSparkleExtension>[0]);
    loaded.extensions = [await loadExtensionFromFactory(configured, cwd, createEventBus(), createExtensionRuntime())];
  }
  const getterPrompts: string[] = [], parentWirePrompts: string[] = [];
  const delegateTool = (loaded.extensions[0] as Extension).tools.get("sparkle_delegate")!.definition;
  const execute = delegateTool.execute;
  delegateTool.execute = (...args: Parameters<typeof execute>) => {
    getterPrompts.push(args[4].getSystemPrompt());
    return execute(...args);
  };
  let host: AgentSession | undefined;
  const late: Extension = {
    path: "<inline:late-host-context>", resolvedPath: "<inline:late-host-context>",
    sourceInfo: { path: "<inline:late-host-context>", source: "inline", scope: "temporary", origin: "top-level" },
    handlers: new Map([["before_agent_start", [async () => {
      host!.setThinkingLevel("low");
      return wireOnly ? undefined : { systemPrompt };
    }]]]),
    tools: new Map(), messageRenderers: new Map(), commands: new Map(), flags: new Map(), shortcuts: new Map()
  };
  if (wireOnly) late.handlers.set("context_with_system", [async (rawEvent: unknown) => {
    // This handler is registered for exactly this public SDK event type.
    const event = rawEvent as ContextWithSystemEvent;
    return { messages: [{ role: "system" as const, content: "TRANSFORM_FINAL", toolsAdded: getCurrentTools(event.messages), timestamp: Date.now() },
      ...event.messages.filter((message) => message.role !== "system")] };
  }]);
  const resources: ResourceLoader = {
    getExtensions: () => ({ extensions: [...loaded.extensions, late], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }), getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }), getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => wireOnly ? systemPrompt : "EARLY_HOST_PROMPT", getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [],
    extendResources: () => { throw new Error("resource discovery forbidden"); },
    reload: async () => { throw new Error("resource reload forbidden"); }
  };
  const children: Array<{ context: TranscriptContext; options: SimpleStreamOptions | undefined }> = [];
  let parentCalls = 0, childCalls = 0;
  const faux = fauxProvider({ tokensPerSecond: 1_000_000, provider: "host-context", models: [{ id: "synthetic", reasoning: true }] });
  faux.setResponses(Array.from({ length: retryWorker ? 5 : 4 }, () => async (context: TranscriptContext, options?: SimpleStreamOptions) => {
    const parent = getCurrentTools(context.messages).some((tool) => tool.name === "sparkle_delegate");
    if (parent) {
      parentCalls++;
      parentWirePrompts.push(getCurrentSystemPrompt(context.messages));
      return parentCalls === 1
        ? fauxAssistantMessage(fauxToolCall("sparkle_delegate", {
            model: "host-context/synthetic", tasks: [{ role: "scout", objective: "Inspect fixture.txt" }]
          }), { stopReason: "toolUse" })
        : fauxAssistantMessage("parent finished");
    }
    children.push({ context, options });
    childCalls++;
    if (retryWorker && childCalls === 1) return fauxAssistantMessage([], { stopReason: "error", errorMessage: "HTTP 503 synthetic retry" });
    return childCalls === (retryWorker ? 2 : 1)
      ? fauxAssistantMessage(fauxToolCall("sparkle_read_file", { path: JSON.stringify(context.messages).includes("APPROVED_READ=approved.txt") ? "approved.txt" : "fixture.txt" }), { stopReason: "toolUse" })
      : fauxAssistantMessage("worker inspected the owned fixture");
  }));
  const model = faux.getModel();
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null,
    refreshOnCreate: false, allowModelNetwork: false });
  type SdkProvider = Parameters<ModelRuntime["registerNativeProvider"]>[0];
  type SdkStream = ReturnType<SdkProvider["streamSimple"]>;
  runtime.registerNativeProvider({
    id: faux.provider.id, name: faux.provider.name, getModels: () => faux.models,
    // Parent SDK and app AI can carry different private transcript/stream
    // identities. Rebuild context through the app's public normalizer, check
    // the returned stream's public members, then bridge only its class brand.
    stream: (selected, context, options) => {
      const stream: Pick<SdkStream, keyof SdkStream> =
        faux.provider.stream(selected, normalizeContext({ messages: context.messages }), options);
      return stream as SdkStream;
    },
    streamSimple: (selected, context, options) => {
      const stream: Pick<SdkStream, keyof SdkStream> =
        faux.provider.streamSimple(selected, normalizeContext({ messages: context.messages }), options);
      return stream as SdkStream;
    },
    auth: { apiKey: { name: "Synthetic", check: async () => ({ type: "api_key", source: "synthetic" }),
      resolve: async () => ({ auth: {} }) } }
  });
  await runtime.refresh({ providers: [model.provider], allowNetwork: false });
  const sessionManager = SessionManager.inMemory(cwd);
  let promptCalls = 0;
  const prompt = AgentSession.prototype.prompt;
  AgentSession.prototype.prompt = async function(...args: Parameters<typeof prompt>) {
    promptCalls++;
    return prompt.apply(this, args);
  };
  try {
    const created = await createAgentSession({ cwd, modelRuntime: runtime, model, thinkingLevel: "off",
      tools: ["sparkle_delegate"], resourceLoader: resources, sessionManager,
      settingsManager: SettingsManager.inMemory({ retry: { enabled: false, provider: { maxRetries: 0 } },
        compaction: { enabled: false }, cacheWarming: "off" }) });
    host = created.session;
    await host.prompt(`Delegate the synthetic inspection. ${PARENT_ONLY}`);
    await host.waitForIdle();
    return { children, parentCalls, promptCalls, getterPrompts, parentWirePrompts, parentEntries: sessionManager.getEntries(),
      error: host.state.errorMessage };
  } finally {
    AgentSession.prototype.prompt = prompt;
    await host?.abort();
    await host?.waitForIdle();
    host?.dispose();
  }
}

function assertOwnedDelegation(result: Awaited<ReturnType<typeof actualParentDelegation>>, expectedRead = "OWNED_READ_RESULT") {
  assert.equal(result.error, undefined);
  assert.ok(result.parentCalls >= 2, "the parent must receive the real delegate result");
  assert.ok(result.children.length >= 2, "the worker must execute its own read through the real SDK");
  assert.ok(result.promptCalls >= 2, "actual parent and child AgentSession.prompt must both run");
  assert.match(JSON.stringify(result.parentEntries), new RegExp(PARENT_ONLY));
  const wire = JSON.stringify(result.children);
  assert.match(wire, new RegExp(expectedRead));
  assert.match(wire, /Do not claim independent verification/);
  assert.match(wire, /Use sparkle_report_task_result/);
  assert.match(wire, /read-only project assistant/);
  assert.doesNotMatch(wire, new RegExp(`${PARENT_ONLY}|${AMBIENT_ONLY}`));
  for (const child of result.children) {
    assert.deepEqual(getCurrentTools(child.context.messages).map((tool) => tool.name).sort(),
      ["sparkle_read_file", "sparkle_report_task_result"], "the child owns read/report tools, not parent closures");
  }
}

for (const [name, prompt] of [["opaque", HOST_TEXT], ["empty", ""]] as const) {
  test(`actual parent delegation preserves its final ${name} effective prompt`, { timeout: 20000 }, async () => {
    const result = await actualParentDelegation(prompt);
    assertOwnedDelegation(result);
    for (const child of result.children) assert.equal(getCurrentSystemPrompt(child.context.messages), prompt);
  });
}

test("actual parent delegation preserves thinking selected by the late host handler", { timeout: 20000 }, async () => {
  const result = await actualParentDelegation(HOST_TEXT);
  assertOwnedDelegation(result);
  for (const child of result.children) assert.equal(child.options?.reasoning, "low");
});

for (const retryWorker of [false, true]) test(`approved resource bodies reach a real delegated worker${retryWorker ? " through provider retry" : ""} and direct its owned read`, { timeout: 20000 }, async () => {
  let calls = 0;
  let selectedCwd: string | undefined;
  const original = {
    contextFiles: [{ path: "opaque-host-label", text: "APPROVED_CONTEXT APPROVED_READ=approved.txt" }],
    skills: [{ name: "approved-skill", description: "Approved description", body: "APPROVED_SKILL_BODY" }]
  };
  const result = await actualParentDelegation(HOST_TEXT, ({ cwd }) => {
    calls++;
    selectedCwd = cwd;
    queueMicrotask(() => {
      original.contextFiles[0]!.text = "MUTATED_CONTEXT";
      original.skills[0]!.body = "MUTATED_SKILL";
    });
    return original;
  }, retryWorker);
  assertOwnedDelegation(result, "APPROVED_READ_RESULT");
  assert.equal(calls, 1);
  assert.equal(typeof selectedCwd, "string");
  for (const child of result.children) {
    assert.equal(getCurrentSystemPrompt(child.context.messages), HOST_TEXT);
    const wire = JSON.stringify(child.context.messages);
    assert.match(wire, /APPROVED_CONTEXT/);
    assert.match(wire, /APPROVED_SKILL_BODY/);
    const bodyMessages = child.context.messages.filter((message) => message.role === "user" && JSON.stringify(message.content).includes("APPROVED_SKILL_BODY"));
    assert.equal(bodyMessages.length, 1, "the owned custom message is converted to user content once");
    assert.equal(wire.match(/APPROVED_SKILL_BODY/g)?.length, 1, "each attempt receives the captured resource message once");
    assert.doesNotMatch(wire, /MUTATED_CONTEXT|MUTATED_SKILL/);
  }
});

test("delegation inherits the host getter rather than a later non-forced parent wire transform", { timeout: 20000 }, async () => {
  const result = await actualParentDelegation("BASE_HOST_PROMPT", undefined, false, true);
  assertOwnedDelegation(result);
  assert.equal(result.getterPrompts.length, 1);
  assert.match(result.getterPrompts[0]!, /BASE_HOST_PROMPT/);
  assert.doesNotMatch(result.getterPrompts[0]!, /TRANSFORM_FINAL/);
  assert.ok(result.parentWirePrompts.length > 0);
  for (const prompt of result.parentWirePrompts) assert.equal(prompt, "TRANSFORM_FINAL");
  for (const child of result.children) assert.equal(getCurrentSystemPrompt(child.context.messages), result.getterPrompts[0]);
});
