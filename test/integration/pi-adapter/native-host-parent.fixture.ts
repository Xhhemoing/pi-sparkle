import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  InMemoryCredentialStore, fauxProvider, fauxAssistantMessage, fauxToolCall,
  getCurrentSystemPrompt, getCurrentTools, normalizeContext, type TranscriptContext, type SimpleStreamOptions, type FauxResponseFactory
} from "@earendil-works/pi-ai";
import {
  createEventBus, AgentSession, ModelRuntime, SessionManager, SettingsManager, createAgentSession, createExtensionRuntime,
  type ContextWithSystemEvent, type Extension, type ResourceLoader
} from "@earendil-works/pi-coding-agent";

import { createSparkleExtension } from "../../../extensions/pi-sparkle/index.js";

export const PARENT_ONLY = "PARENT_TRANSCRIPT_ONLY_MUST_NOT_CROSS";
export const AMBIENT_ONLY = "AMBIENT_CONTEXT_MUST_NOT_APPEAR";

interface ParentModelScenario {
  readonly override?: string;
  readonly switchDuringApproval?: boolean;
  readonly malformedLearnedState?: boolean;
  readonly switchCwdDuringApproval?: boolean;
}

export async function actualParentDelegation(systemPrompt: string, approvedResources?: (input: { cwd: string }) => unknown, retryWorker = false, wireOnly = false, modelScenario?: ParentModelScenario) {
  const scratch = join(process.cwd(), ".agent_workspace", "phase0-host-context");
  await mkdir(scratch, { recursive: true });
  const cwd = await mkdtemp(join(scratch, "actual-parent-"));
  await writeFile(join(cwd, "fixture.txt"), "OWNED_READ_RESULT", "utf8");
  await writeFile(join(cwd, "approved.txt"), "APPROVED_READ_RESULT", "utf8");
  await writeFile(join(cwd, "AGENTS.md"), AMBIENT_ONLY, "utf8");
  await mkdir(join(cwd, ".pi", "extensions"), { recursive: true });
  await writeFile(join(cwd, ".pi", "extensions", "tripwire.ts"), "throw new Error('AMBIENT_EXTENSION_EXECUTED');", "utf8");
  const changedCwd = join(cwd, "changed-root");
  let delegateCwd = cwd;
  const approvedCwds: string[] = [];
  if (modelScenario?.switchCwdDuringApproval) {
    await mkdir(changedCwd);
    await writeFile(join(changedCwd, "fixture.txt"), "WRONG_ROOT_READ_RESULT", "utf8");
  }
  const loaderUrl = new URL("./core/extensions/loader.js", import.meta.resolve("@earendil-works/pi-coding-agent"));
  const { loadExtensions, loadExtensionFromFactory } = await import(loaderUrl.href);
  const loaded = await loadExtensions([join(process.cwd(), "extensions/pi-sparkle/index.ts")], cwd);
  assert.deepEqual(loaded.errors, []);
  if (modelScenario?.malformedLearnedState) {
    const adaptation = join(cwd, ".agent_workspace", "pi-sparkle", "adaptation");
    await mkdir(adaptation, { recursive: true });
    await writeFile(join(adaptation, "registry.json"), "MALFORMED_LEARNED_STATE_MUST_NOT_BE_READ", "utf8");
  }
  if (approvedResources !== undefined || modelScenario?.switchDuringApproval || modelScenario?.switchCwdDuringApproval) {
    const selectedResources = modelScenario?.switchDuringApproval || modelScenario?.switchCwdDuringApproval
      ? (input: { cwd: string }) => {
          approvedCwds.push(input.cwd);
          if (modelScenario.switchDuringApproval) host!.agent.state.model = faux.getModel("B")!;
          if (modelScenario.switchCwdDuringApproval) {
            delegateCwd = changedCwd;
            return { contextFiles: [{ path: "original-root-label", text: "ROOT_CAPTURE_APPROVED" }] };
          }
          return undefined;
        }
      : approvedResources;
    const configured = createSparkleExtension({ approvedResources: selectedResources } as unknown as Parameters<typeof createSparkleExtension>[0]);
    loaded.extensions = [await loadExtensionFromFactory(configured, cwd, createEventBus(), createExtensionRuntime())];
  }
  const getterPrompts: string[] = [], parentWirePrompts: string[] = [];
  const delegateResults: unknown[] = [];
  const delegateTool = (loaded.extensions[0] as Extension).tools.get("sparkle_delegate")!.definition;
  const execute = delegateTool.execute;
  delegateTool.execute = async (...args: Parameters<typeof execute>) => {
    getterPrompts.push(args[4].getSystemPrompt());
    const context = modelScenario?.switchCwdDuringApproval ? { ...args[4], get cwd() { return delegateCwd; } } : args[4];
    const result = await execute(args[0], args[1], args[2], args[3], context);
    delegateResults.push(result.details);
    return result;
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
  const children: Array<{ context: TranscriptContext; options: SimpleStreamOptions | undefined; model: string }> = [];
  let parentCalls = 0, childCalls = 0;
  const faux = fauxProvider({ tokensPerSecond: 1_000_000, provider: "host-context", models: modelScenario === undefined ? [{ id: "synthetic", reasoning: true }] : [{ id: "A", reasoning: true }, { id: "grok-4.7", reasoning: true }, { id: "B", reasoning: true }] });
  const respond: FauxResponseFactory = async (context, options, _state, selected) => {
    const parent = getCurrentTools(context.messages).some((tool) => tool.name === "sparkle_delegate");
    if (parent) {
      parentCalls++;
      parentWirePrompts.push(getCurrentSystemPrompt(context.messages));
      return parentCalls === 1
        ? fauxAssistantMessage(fauxToolCall("sparkle_delegate", {
            ...(modelScenario === undefined ? { model: "host-context/synthetic" } : modelScenario.override !== undefined ? { model: modelScenario.override } : {}),
            tasks: [{ role: "scout", objective: "Inspect fixture.txt" }, ...(modelScenario !== undefined ? [{ role: "reviewer", objective: "Review fixture.txt" }] : [])]
          }), { stopReason: "toolUse" })
        : fauxAssistantMessage("parent finished");
    }
    children.push({ context, options, model: `${selected.provider}/${selected.id}` });
    childCalls++;
    if (retryWorker && childCalls === 1) return fauxAssistantMessage([], { stopReason: "error", errorMessage: "HTTP 503 synthetic retry" });
    return childCalls === (retryWorker ? 2 : 1)
      ? fauxAssistantMessage(fauxToolCall("sparkle_read_file", { path: JSON.stringify(context.messages).includes("APPROVED_READ=approved.txt") ? "approved.txt" : "fixture.txt" }), { stopReason: "toolUse" })
      : fauxAssistantMessage("worker inspected the owned fixture");
  };
  faux.setResponses(Array.from({ length: modelScenario !== undefined ? 8 : retryWorker ? 5 : 4 }, () => respond));
  const model = modelScenario === undefined ? faux.getModel() : faux.getModel("A")!;
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
    return { cwd, changedCwd, approvedCwds, children, parentCalls, promptCalls, getterPrompts, parentWirePrompts, delegateResults, parentEntries: sessionManager.getEntries(),
      hostModel: `${host.model?.provider}/${host.model?.id}`, error: host.state.errorMessage };
  } finally {
    AgentSession.prototype.prompt = prompt;
    await host?.abort();
    await host?.waitForIdle();
    host?.dispose();
  }
}
