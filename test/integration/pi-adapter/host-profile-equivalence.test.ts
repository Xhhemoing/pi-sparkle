import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { findPackageJSON } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { InMemoryCredentialStore, Type, createAssistantMessageEventStream, createModels, createProvider, fauxAssistantMessage, fauxProvider, fauxToolCall,
  getCurrentSystemPrompt, getCurrentTools, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { createAgentSession, createExtensionRuntime, ModelRuntime, SessionManager, SettingsManager,
  type Extension, type ResourceLoader } from "@earendil-works/pi-coding-agent";
import { createAgentInstanceId, createRunId, createTaskId } from "../../../src/domain/ids.js";
import type { ExecutionEvent } from "../../../src/execution/contract.js";
import { NativeWriteCostBudget } from "../../../src/native/write-cost-budget.js";
import { prepareApprovedResources } from "../../../src/pi-adapter/approved-resources.js";
import { captureNativeHostContext } from "../../../src/pi-adapter/native-host-context.js";
import { createNativeWriteExecutorFactory } from "../../../src/pi-adapter/native-write-executor.js";
import { createWorktreeCodingTools } from "../../../src/pi-adapter/worktree-coding-tools.js";

// A finite fresh profile, declared before either arm. This is not a parent-session
// replay or evidence of model quality, billing, or arbitrary Pi feature parity.
const profile = {
  provider: "paired-profile-local", model: "reasoner", prompt: "  DECLARED HOST H\r\n中文  ",
  objective: "Read context.txt, write output.txt, refuse protected.txt, then report.",
  context: "DECLARED_CONTEXT α\n", skill: "DECLARED_SKILL_BODY β\n",
  thinking: { minimal: 0, low: -1, medium: 1.5, high: 1234 },
  contextWindow: 4096, maxTokens: 256,
  prices: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 3 }
};
const reportParameters = Type.Object({ verification: Type.String(), summary: Type.String(), outcome: Type.Optional(Type.String()),
  evidenceIds: Type.Optional(Type.Array(Type.String())), artifactIds: Type.Optional(Type.Array(Type.String())),
  criteria: Type.Optional(Type.Array(Type.Object({ id: Type.String(), verification: Type.String(), evidenceIds: Type.Optional(Type.Array(Type.String())) }))) });
type SdkProvider = Parameters<ModelRuntime["registerNativeProvider"]>[0];
type SdkModel = NonNullable<ReturnType<ModelRuntime["getModel"]>>;
type SdkMessage = Awaited<ReturnType<ModelRuntime["completeSimple"]>>;
type SdkStream = ReturnType<ModelRuntime["streamSimple"]>;
interface HostAi {
  fauxProvider(options: Parameters<typeof fauxProvider>[0]): {
    provider: SdkProvider; state: { callCount: number }; getModel(): SdkModel | undefined; setResponses(messages: SdkMessage[]): void;
  };
  fauxAssistantMessage(content: Parameters<typeof fauxAssistantMessage>[0], options?: Parameters<typeof fauxAssistantMessage>[1]): SdkMessage;
  fauxToolCall: typeof fauxToolCall;
  getCurrentSystemPrompt(messages: readonly unknown[]): string;
  getCurrentTools(messages: readonly unknown[]): ReturnType<typeof getCurrentTools>;
  AssistantMessageEventStream: new () => SdkStream;
}
async function packageEntry(name: string, base: string) {
  const located = findPackageJSON(name, base); assert.ok(located);
  const manifestPath = await realpath(located);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    name: string; version: string; exports: Record<string, string | { import: string }>;
  };
  assert.equal(manifest.name, name);
  const entry = manifest.exports["."]; assert.ok(entry);
  return { version: manifest.version, entry: pathToFileURL(await realpath(path.resolve(path.dirname(manifestPath),
    typeof entry === "string" ? entry : entry.import))).href };
}
function latch() { return Promise.withResolvers<void>(); }
async function bounded<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([pending, new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(Error("paired local operation did not settle")), 10000);
  })]); } finally { clearTimeout(timer); }
}
async function rootPair() {
  const parent = path.resolve(".agent_workspace/phase1-six-config-profile"); await mkdir(parent, { recursive: true });
  const base = await mkdtemp(path.join(parent, "pair-"));
  const roots = [path.join(base, "direct"), path.join(base, "worker")];
  for (const root of roots) {
    await mkdir(root); await writeFile(path.join(root, "context.txt"), profile.context, "utf8");
    await writeFile(path.join(root, "skill.txt"), profile.skill, "utf8");
    await writeFile(path.join(root, "protected.txt"), "PROTECTED_BYTES", "utf8");
    await writeFile(path.join(root, "AGENTS.md"), "AMBIENT_PARENT_MARKER", "utf8");
  }
  return roots as [string, string];
}
async function declaredResources(root: string) {
  return { contextFiles: [{ path: "context.txt", text: await readFile(path.join(root, "context.txt"), "utf8") }],
    skills: [{ name: "declared-skill", description: "Only explicitly approved skill", body: await readFile(path.join(root, "skill.txt"), "utf8") }] };
}
// Both arms receive the same declared five tool definitions, bound separately.
// The protection closure is part of this explicit host profile, not a claim of OS containment.
interface ToolObservation { name: string; args: unknown; result?: unknown; error?: string; }
function scopedTools(root: string, observations: ToolObservation[], held?: { entered: ReturnType<typeof latch>; release: ReturnType<typeof latch>; aborted: ReturnType<typeof latch> }): AgentTool[] {
  return createWorktreeCodingTools({ worktreeRoot: root }).filter((tool) => tool.name !== "sparkle_run_command").map((tool) => ({
    ...tool, execute: async (id: string, args: unknown, signal?: AbortSignal) => {
      const observation: ToolObservation = { name: tool.name, args: structuredClone(args) }; observations.push(observation);
      try {
      if (tool.name === "sparkle_write_file" || tool.name === "sparkle_patch_file") {
        assert.ok(args !== null && typeof args === "object" && "path" in args);
        if (args.path !== "output.txt") throw Error("DECLARED_PROTECTED_REFUSAL");
      }
      if (held !== undefined && tool.name === "sparkle_read_file") {
        assert.ok(signal); signal.addEventListener("abort", () => held.aborted.resolve(), { once: true });
        if (signal.aborted) held.aborted.resolve();
        held.entered.resolve(); await held.release.promise;
      }
      const result = await tool.execute(id, args, signal); observation.result = result; return result;
      } catch (error) { observation.error = String(error); throw error; }
    }
  }));
}
function directResources(payload: string): ResourceLoader {
  // Independent public SDK hook: H and resource bytes come from the declaration,
  // never from a captured worker prompt or Sparkle's session/resource helper.
  const owner: Extension = { path: "<inline:paired-profile>", resolvedPath: "<inline:paired-profile>",
    sourceInfo: { path: "<inline:paired-profile>", source: "inline", scope: "temporary", origin: "top-level" },
    handlers: new Map([["before_agent_start", [async () => ({ systemPrompt: profile.prompt,
      message: { customType: "paired-approved-resources", content: payload, display: false } })]]]),
    tools: new Map(), messageRenderers: new Map(), commands: new Map(), flags: new Map(), shortcuts: new Map() };
  return { getExtensions: () => ({ extensions: [owner], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }), getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }), getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => profile.prompt, getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [],
    extendResources: () => { throw Error("ambient discovery forbidden"); }, reload: async () => { throw Error("ambient reload forbidden"); } };
}
interface Wire { provider: string; model: string; system: string; tools: ReturnType<typeof getCurrentTools>;
  messages: string; reasoning: SimpleStreamOptions["reasoning"]; thinking: SimpleStreamOptions["thinkingBudgets"];
  maxTokens: number | undefined; modelMaxTokens: number; contextWindow: number; prices: SdkModel["cost"]; }
function wire(selected: SdkModel, messages: readonly unknown[], options: SimpleStreamOptions | undefined,
  ai: Pick<HostAi, "getCurrentTools" | "getCurrentSystemPrompt">): Wire {
  return { provider: selected.provider, model: selected.id, system: ai.getCurrentSystemPrompt(messages),
    tools: structuredClone(ai.getCurrentTools(messages)), messages: JSON.stringify(messages), reasoning: options?.reasoning,
    thinking: options?.thinkingBudgets === undefined ? undefined : { ...options.thinkingBudgets },
    maxTokens: options?.maxTokens, modelMaxTokens: selected.maxTokens, contextWindow: selected.contextWindow, prices: structuredClone(selected.cost) };
}
function emitSynthetic(stream: Pick<SdkStream, keyof SdkStream>, message: SdkMessage, selected: SdkModel, input: number) {
  // Explicit synthetic usage: fauxProvider's built-in usage estimator reports
  // zero cost regardless of positive reference prices, so it is unsuitable for strict accounting.
  const output = 2, cacheRead = 1, cacheWrite = 0;
  const cost = { input: input * selected.cost.input / 1e6, output: output * selected.cost.output / 1e6,
    cacheRead: cacheRead * selected.cost.cacheRead / 1e6, cacheWrite: 0, total: 0 };
  cost.total = cost.input + cost.output + cost.cacheRead;
  const observed: SdkMessage = { ...message, provider: selected.provider, model: selected.id, api: selected.api,
    usage: { input, output, cacheRead, cacheWrite, totalTokens: input + output + cacheRead, cost } };
  queueMicrotask(() => { stream.push({ type: "start", partial: { ...observed, content: [], stopReason: "pending" } });
    stream.push({ type: "done", reason: "toolUse", message: observed }); stream.end(observed); });
}
function referenceObservation(usages: readonly (SdkMessage["usage"] | undefined)[], dispatches: number) {
  let known = 0, priced = 0, consistent = true;
  for (const usage of usages) {
    if (usage === undefined || ![usage.input, usage.output, usage.cacheRead, usage.cacheWrite].every((value) => Number.isFinite(value) && value >= 0)) {
      consistent = false; continue;
    }
    const amount = (usage.input * profile.prices.input + usage.output * profile.prices.output +
      usage.cacheRead * profile.prices.cacheRead + usage.cacheWrite * profile.prices.cacheWrite) / 1e6;
    known += amount; priced++;
    if (Math.abs(usage.cost.total - amount) > 1e-15) consistent = false;
  }
  return { knownReferenceUsd: priced > 0 ? known : undefined,
    coverage: priced === dispatches && usages.length === dispatches && consistent ? "complete" : priced > 0 ? "partial" : "unknown" };
}
function assertWires(wires: Wire[], ownRoot: string, otherRoot: string, tools: AgentTool[]) {
  const expected = [...tools.map((tool) => ({ name: tool.name, parameters: tool.parameters })),
    { name: "sparkle_report_task_result", parameters: reportParameters }].sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of wires) {
    assert.equal(entry.provider, profile.provider); assert.equal(entry.model, profile.model); assert.equal(entry.system, profile.prompt);
    assert.equal(entry.reasoning, "high"); assert.deepEqual(entry.thinking, profile.thinking);
    assert.equal(entry.maxTokens, undefined, "profile declares no separate output-token override");
    assert.equal(entry.modelMaxTokens, profile.maxTokens); assert.equal(entry.contextWindow, profile.contextWindow);
    assert.deepEqual(entry.prices, profile.prices);
    assert.deepEqual(entry.tools.map(({ name, parameters }) => ({ name, parameters })).sort((a, b) => a.name.localeCompare(b.name)), expected);
    // Assert each root explicitly; there is no transcript normalization or broad replacement.
    assert.ok(entry.messages.includes(JSON.stringify(ownRoot).slice(1, -1)));
    assert.ok(!entry.messages.includes(JSON.stringify(otherRoot).slice(1, -1)));
    assert.match(entry.messages, /DECLARED_CONTEXT/); assert.match(entry.messages, /context\.txt/);
    assert.match(entry.messages, /declared-skill/); assert.match(entry.messages, /Only explicitly approved skill/); assert.match(entry.messages, /DECLARED_SKILL_BODY/);
    const declaredPayload = JSON.stringify({ contextFiles: [{ path: "context.txt", text: profile.context }],
      skills: [{ name: "declared-skill", description: "Only explicitly approved skill", body: profile.skill }] });
    assert.ok(entry.messages.includes(JSON.stringify(declaredPayload).slice(1, -1)), "exact declared context and skill bytes reach the wire");
    assert.equal(entry.messages.match(/DECLARED_SKILL_BODY/g)?.length, 1, "approved skill body enters each transcript exactly once");
    assert.doesNotMatch(entry.messages, /AMBIENT_PARENT_MARKER|PARENT_TRANSCRIPT_MARKER/);
  }
}
async function arms(t: { diagnostic(message: string): void }, held = false) {
  const [aRoot, bRoot] = await rootPair();
  const sdk = await packageEntry("@earendil-works/pi-coding-agent", import.meta.url);
  const aiPackage = await packageEntry("@earendil-works/pi-ai", sdk.entry); assert.equal(aiPackage.version, sdk.version);
  t.diagnostic(JSON.stringify({ sdk, baselineAi: aiPackage, workerAi: await packageEntry("@earendil-works/pi-ai", import.meta.url) }));
  const ai: HostAi = await import(aiPackage.entry);
  const modelDefinitions = [{ id: profile.model, reasoning: true, cost: profile.prices, maxTokens: profile.maxTokens, contextWindow: profile.contextWindow }];
  const a = ai.fauxProvider({ provider: profile.provider, models: modelDefinitions });
  const b = fauxProvider({ provider: profile.provider, models: modelDefinitions });
  const aModel = a.getModel()!, bModel = b.getModel()!;
  let aCalls = 0, bCalls = 0;
  const aResponses: SdkMessage[] = [], bResponses: SdkMessage[] = [];
  const aWires: Wire[] = [], bWires: Wire[] = [];
  const aHeld = { entered: latch(), release: latch(), aborted: latch() }, bHeld = { entered: latch(), release: latch(), aborted: latch() };
  const aToolObservations: ToolObservation[] = [], bToolObservations: ToolObservation[] = [];
  const aTools = scopedTools(aRoot, aToolObservations, held ? aHeld : undefined), bTools = scopedTools(bRoot, bToolObservations, held ? bHeld : undefined);
  const reports: unknown[] = [];
  const reportTool: AgentTool = { name: "sparkle_report_task_result", label: "Declared task report", description: "Record this finite profile's task report",
    parameters: reportParameters, execute: async (_id, args) => { reports.push(args); return { content: [{ type: "text", text: "recorded" }], details: {} }; } };
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  const refresh = runtime.refresh.bind(runtime), registrations: ReturnType<ModelRuntime["refresh"]>[] = [];
  runtime.refresh = (options = {}) => { const pending = refresh({ ...options, providers: [aModel.provider], allowNetwork: false }); registrations.push(pending); return pending; };
  runtime.registerNativeProvider({ id: aModel.provider, name: "Local independent baseline", getModels: () => [aModel],
    auth: { apiKey: { name: "local", check: async () => ({ type: "api_key", source: "local" }), resolve: async () => ({ auth: {} }) } },
    stream: () => { throw Error("unexpected full stream"); }, streamSimple: (selected, context, options) => {
      aWires.push(wire(selected, context.messages, options, ai));
      aCalls++; const message = aResponses.shift(); assert.ok(message, "unexpected extra baseline dispatch");
      const stream = new ai.AssistantMessageEventStream(); emitSynthetic(stream, message, selected, 10);
      assert.ok(stream instanceof ai.AssistantMessageEventStream); return stream;
    } });
  await Promise.all(registrations);
  const aResources = await declaredResources(aRoot), bResources = await declaredResources(bRoot);
  const { session: direct } = await createAgentSession({ cwd: aRoot, modelRuntime: runtime, model: aModel, thinkingLevel: "high",
    tools: [...aTools, reportTool].map((tool) => tool.name), customTools: [...aTools, reportTool],
    resourceLoader: directResources(JSON.stringify(aResources)), sessionManager: SessionManager.inMemory(aRoot),
    settingsManager: SettingsManager.inMemory({ thinkingBudgets: profile.thinking, retry: { enabled: false, provider: { maxRetries: 0 } },
      compaction: { enabled: false }, cacheWarming: "off" }) });
  // This explicit host report-stop policy is shared; no USD enforcement is added to A.
  const originalFinish = direct.agent.finishTurn;
  direct.agent.finishTurn = async (turn, signal) => {
    if (reports.length > 0) return { action: "end" };
    const decision = await originalFinish?.(turn, signal); return decision ?? undefined;
  };
  const aUsage: SdkMessage["usage"][] = [];
  const aTerminals: string[] = [];
  direct.subscribe((event) => { if (event.type === "message_end" && event.message.role === "assistant") {
    aTerminals.push(event.message.stopReason);
    // This declared provider emits toolUse only. SDK-generated error/aborted messages
    // after held-tool cancellation are not additional provider dispatches.
    if (event.message.stopReason === "toolUse") aUsage.push(event.message.usage);
  } });
  const models = createModels();
  models.setProvider(createProvider({ id: bModel.provider, models: [bModel],
    auth: { apiKey: { name: "local worker", resolve: async () => ({ auth: {} }) } }, api: {
      streamSimple: (selected) => { bCalls++; const message = bResponses.shift(); assert.ok(message, "unexpected extra worker dispatch");
        const stream = createAssistantMessageEventStream(); emitSynthetic(stream, message, selected, 12); return stream; },
      stream: () => { throw Error("unexpected worker full stream"); }
    } }));
  const host = captureNativeHostContext({ effectiveSystemPrompt: profile.prompt, thinkingLevel: "high", thinkingBudgets: profile.thinking,
    models: [bModel], defaultModel: bModel, approvedResourcePayload: prepareApprovedResources(bResources), streamSimple: (selected, context, options) => {
      bWires.push(wire(selected, context.messages, options, { getCurrentTools, getCurrentSystemPrompt })); return models.streamSimple(selected, context, options);
    } });
  const pool = new NativeWriteCostBudget(1), slot = pool.beginAttempt(1), controller = new AbortController();
  const worker = slot.wrap(await createNativeWriteExecutorFactory(host)({ candidatePath: bRoot, sourceRevision: "synthetic-profile",
    objective: profile.objective, tools: bTools, signal: controller.signal, executionCostBudget: slot.handle,
    onInvocation: () => undefined, onCommandCleanupUnsettled: () => { throw Error("unexpected command"); } }));
  function responses(builder: Pick<HostAi, "fauxAssistantMessage" | "fauxToolCall">) {
    const result = [builder.fauxAssistantMessage(builder.fauxToolCall("sparkle_read_file", { path: "context.txt" }), { stopReason: "toolUse" })];
    if (!held) result.push(builder.fauxAssistantMessage([
      builder.fauxToolCall("sparkle_write_file", { path: "output.txt", contents: "ALLOWED_WRITE α\n" }),
      builder.fauxToolCall("sparkle_write_file", { path: "protected.txt", contents: "FORBIDDEN" })], { stopReason: "toolUse" }),
    builder.fauxAssistantMessage(builder.fauxToolCall("sparkle_report_task_result", { verification: "PASSED", summary: "declared profile completed" }), { stopReason: "toolUse" }));
    return result;
  }
  aResponses.push(...responses(ai)); bResponses.push(...responses({ fauxAssistantMessage, fauxToolCall }));
  const events: ExecutionEvent[] = [];
  const runA = async () => { await direct.prompt(`Working directory: ${aRoot}\n\n${profile.objective}`); await direct.waitForIdle(); };
  const runB = async () => {
    try { for await (const event of worker.execute({ runId: createRunId(), taskId: createTaskId(), agentInstanceId: createAgentInstanceId(),
      workingDirectory: bRoot, prompt: profile.objective }, controller.signal)) events.push(event); }
    finally { slot.complete(); }
  };
  return { aRoot, bRoot, aCalls: () => aCalls, bCalls: () => bCalls, aTools, bTools, aWires, bWires, reports, aUsage, aTerminals,
    aToolObservations, bToolObservations, events, pool, direct, controller, aHeld, bHeld, runA, runB };
}

test("finite fresh profile pairs actual model/prompt/skills/tools/context/thinking wire and scoped file effects", { timeout: 20000 }, async (t) => {
  const f = await arms(t);
  try {
    await bounded(Promise.all([f.runA(), f.runB()]));
    assert.equal(f.aCalls(), 3); assert.equal(f.bCalls(), 3);
    assert.equal(f.aWires.length, 3); assert.equal(f.bWires.length, 3);
    assertWires(f.aWires, f.aRoot, f.bRoot, f.aTools); assertWires(f.bWires, f.bRoot, f.aRoot, f.bTools);
    for (const root of [f.aRoot, f.bRoot]) {
      assert.equal(await readFile(path.join(root, "output.txt"), "utf8"), "ALLOWED_WRITE α\n");
      assert.equal(await readFile(path.join(root, "protected.txt"), "utf8"), "PROTECTED_BYTES");
      assert.equal(await readFile(path.join(root, "context.txt"), "utf8"), profile.context);
    }
    for (const wires of [f.aWires, f.bWires]) { assert.match(wires[1]!.messages, /DECLARED_CONTEXT/); assert.match(wires[2]!.messages, /DECLARED_PROTECTED_REFUSAL/); }
    for (const observations of [f.aToolObservations, f.bToolObservations]) {
      assert.equal(observations.length, 3);
      assert.deepEqual(observations[0]!.args, { path: "context.txt" });
      assert.match(JSON.stringify(observations[0]!.result), /DECLARED_CONTEXT/); assert.equal(observations[0]!.error, undefined);
      assert.match(JSON.stringify(observations[1]!.result), /wrote output.txt/); assert.equal(observations[1]!.error, undefined);
      assert.match(observations[2]!.error!, /DECLARED_PROTECTED_REFUSAL/); assert.equal(observations[2]!.result, undefined);
    }
    assert.deepEqual(f.reports, [{ verification: "PASSED", summary: "declared profile completed" }]);
    assert.ok(f.events.some((event) => event.type === "MESSAGE" && event.message.type === "TASK_RESULT" && event.message.verification.kind === "PASSED"));
    assert.deepEqual(f.events.at(-1), { type: "EXECUTION_FINISHED", outcome: "SUCCESS" });
    const bCost = f.pool.snapshot(); assert.equal(bCost.coverage, "complete"); assert.equal(bCost.settled, true);
    assert.equal(f.aUsage.length, 3);
    const aCost = referenceObservation(f.aUsage, f.aCalls()); assert.equal(aCost.coverage, "complete");
    assert.ok(Math.abs(aCost.knownReferenceUsd! - 3 * 14.5e-6) < 1e-15); assert.ok(Math.abs(bCost.knownReferenceUsd! - 3 * 16.5e-6) < 1e-15);
    t.diagnostic(JSON.stringify({ direct: { ...aCost, taskWideUsdEnforcement: false },
      worker: { referenceCoverage: bCost.coverage, knownReferenceUsd: bCost.knownReferenceUsd, taskWideUsdEnforcement: true }, actualPaidCalls: 0,
      actualBill: "unknown", declaredDifferences: ["custom message type labels", "report tool description/acknowledgment", "root absolute paths", "synthetic usage amounts"],
      unsupported: ["arbitrary parent hooks/transcript", "shell/MCP", "automatic skills", "compaction", "credentials/OAuth", "cross-process resume", "quality/non-inferiority"] }));
  } finally { await f.direct.abort(); await f.direct.waitForIdle(); f.direct.dispose(); }
});

test("finite fresh profile shares an explicit deadline and waits for both held tools after cancellation", { timeout: 20000 }, async (t) => {
  const f = await arms(t, true);
  let aDone = false, bDone = false;
  const deadline = new AbortController();
  // Both already-created arms share this one start and one absolute deadline.
  const deadlineAt = Date.now() + 1000;
  const timer = setTimeout(() => deadline.abort(), Math.max(0, deadlineAt - Date.now()));
  const aAbort = latch();
  deadline.signal.addEventListener("abort", () => { f.controller.abort(); void f.direct.abort().then(() => aAbort.resolve(), aAbort.reject); }, { once: true });
  const running = Promise.all([f.runA().finally(() => { aDone = true; }), f.runB().finally(() => { bDone = true; })]);
  try {
    await bounded(Promise.all([f.aHeld.entered.promise, f.bHeld.entered.promise]));
    await bounded(Promise.all([f.aHeld.aborted.promise, f.bHeld.aborted.promise]));
    assert.equal(deadline.signal.aborted, true); assert.ok(Date.now() >= deadlineAt);
    assert.equal(aDone, false); assert.equal(bDone, false, "neither execution may publish settlement while its tool is held");
    f.aHeld.release.resolve(); f.bHeld.release.resolve(); await bounded(running); await bounded(aAbort.promise);
    assert.equal(f.aCalls(), 1); assert.equal(f.bCalls(), 1);
    assertWires(f.aWires, f.aRoot, f.bRoot, f.aTools); assertWires(f.bWires, f.bRoot, f.aRoot, f.bTools);
    assert.deepEqual(f.events.at(-1), { type: "EXECUTION_FINISHED", outcome: "CANCELLED" });
    assert.equal(f.pool.snapshot().settled, true); assert.equal(f.reports.length, 0);
    assert.equal(f.aUsage.length, 1); assert.equal(f.aToolObservations.length, 1); assert.equal(f.bToolObservations.length, 1);
    for (const observations of [f.aToolObservations, f.bToolObservations]) {
      assert.match(observations[0]!.error!, /workspace operation cancelled/);
      assert.equal(observations[0]!.result, undefined, "released tool observes the already-aborted signal before filesystem work");
    }
    assert.equal(f.pool.snapshot().coverage, "complete");
    const aCost = referenceObservation(f.aUsage, f.aCalls()); assert.equal(aCost.coverage, "complete");
    assert.ok(Math.abs(aCost.knownReferenceUsd! - 14.5e-6) < 1e-15);
    t.diagnostic(JSON.stringify({ sharedDeadlineObserved: true, directReference: { ...aCost,
      providerUsageObservations: f.aUsage.length, sdkAssistantTerminals: f.aTerminals, taskWideUsdEnforcement: false }, workerReference: f.pool.snapshot(),
      paidCalls: 0, actualBill: "unknown", scope: "explicit profile deadline; not whole TaskSpec preflight/check/apply timing parity" }));
  } finally {
    clearTimeout(timer); f.aHeld.release.resolve(); f.bHeld.release.resolve(); f.controller.abort();
    await Promise.allSettled([running, f.direct.abort()]); await f.direct.waitForIdle(); f.direct.dispose();
  }
});
