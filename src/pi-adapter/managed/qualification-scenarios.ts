/* eslint-disable @typescript-eslint/no-explicit-any -- Generic Pi provider proxy arguments stay within this adapter fixture. */
import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { Type, createModels, fauxAssistantMessage, fauxProvider, fauxToolCall, getSystemMessageText, type Context, type MutableModels } from "@earendil-works/pi-ai";
import { setTimeout as delay } from "node:timers/promises";
import { createAgentInstanceId, createRunId, createTaskId } from "../../domain/ids.js";
import type { ExecutionEvent } from "../../execution/contract.js";
import type { ModelInvocation } from "../../telemetry/model-invocation.js";
import { SparkleKernel } from "../kernel.js";
import { PiAgentExecutor, type CostGateEvent } from "../pi-executor.js";

export interface UsageObservation { readonly inputTokens: number; readonly outputTokens: number }
export interface ExecutionObservation {
  readonly scenario: "priced-stop" | "unpriced-cap" | "preabort" | "blocked-tool-cancel";
  readonly streamEntries: number;
  readonly streamAborted: readonly boolean[];
  readonly providerDispatches: number;
  readonly dispatchAborted: readonly boolean[];
  readonly providerHandlers: number;
  readonly modelLookups: number;
  readonly retries: number;
  readonly sleeps: number;
  readonly pendingResponses: number;
  readonly toolStarts: number;
  readonly toolCompletions: number;
  readonly toolErrors: number;
  /** Actual prompt serialization observed at each dispatched faux call. */
  readonly contexts: readonly string[];
  readonly turns: readonly (UsageObservation | null)[];
  readonly invocations: number;
  readonly invocation: { readonly outcome: string; readonly tokensIn: number | null; readonly tokensOut: number | null; readonly cacheHit: boolean | null } | null;
  readonly taskResults: readonly string[];
  readonly executionFinished: readonly string[];
  readonly costEvents: readonly unknown[];
  readonly eventTypes: readonly string[];
  readonly held?: { readonly runSettled: boolean; readonly toolStarts: number; readonly toolCompletions: number; readonly toolSignalAborted: boolean; readonly providerDispatches: number; readonly taskResults: number; readonly executionFinished: number; readonly invocations: number };
  readonly released?: { readonly runSettled: boolean; readonly toolSignalAborted: boolean };
}
export interface SettlementObservation {
  readonly scenario: "deferred-agent-end";
  readonly held: { readonly promptSettled: boolean; readonly agentIdleSettled: boolean; readonly kernelIdleSettled: boolean; readonly isStreaming: boolean; readonly pendingTools: number };
  readonly released: { readonly promptSettled: boolean; readonly agentIdleSettled: boolean; readonly kernelIdleSettled: boolean; readonly isStreaming: boolean; readonly pendingTools: number; readonly activeSignalAbsent: boolean };
  readonly agentEndCount: number;
  readonly providerHandlers: number;
}
export type QualificationObservation = ExecutionObservation | SettlementObservation;
function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`qualification scenario deadline: ${label}`)), 2000); })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
function contextText(context: Context): string {
  const content = (value: any): string => typeof value === "string" ? value : value.map((block: any) => {
    if (block.type === "text") return block.text;
    if (block.type === "thinking") return block.thinking;
    if (block.type === "toolCall") return `${block.name}:${JSON.stringify(block.arguments)}`;
    throw new Error("unexpected non-text qualification context");
  }).join("\n");
  return context.messages.map((message) => {
    if (message.role === "system") return `system:${[getSystemMessageText(message), ...(message.toolsRemoved?.map((tool) => `tool-:${JSON.stringify(tool)}`) ?? []), ...(message.toolsAdded?.map((tool) => `tool+:${JSON.stringify(tool)}`) ?? [])].filter((part) => part.length > 0).join("\n")}`;
    if (message.role === "toolResult") return `toolResult:${[message.toolName, content(message.content)].join("\n")}`;
    return `${message.role}:${content(message.content)}`;
  }).join("\n\n");
}
function harness(providerId: string, tools: AgentTool<any>[], priced: boolean, responseText: string) {
  const faux = fauxProvider({ provider: providerId, api: `${providerId}-api`, tokenSize: { min: 4, max: 4 }, models: [{ id: "probe-model", name: "Probe model", cost: { input: priced ? 1_000_000 : 0, output: priced ? 1_000_000 : 0, cacheRead: 0, cacheWrite: 0 } }] });
  const contexts: string[] = [];
  faux.setResponses([(context) => { contexts.push(contextText(context)); return fauxAssistantMessage(fauxToolCall("probe_tool", {}, { id: "probe-tool-1" }), { stopReason: "toolUse", timestamp: 1 }); },
    (context) => { contexts.push(contextText(context)); return fauxAssistantMessage(responseText, { timestamp: 1 }); }]);
  const streamAborted: boolean[] = [], dispatchAborted: boolean[] = [];
  const provider = new Proxy(faux.provider, { get(target, key) {
    if (key === "streamSimple") return (...args: any[]) => {
      dispatchAborted.push(args[2]?.signal?.aborted ?? false);
      return (target.streamSimple as any)(...args);
    };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  const base = createModels(); base.setProvider(provider);
  let modelLookups = 0, retries = 0, sleeps = 0;
  const models = new Proxy(base, { get(target, key) {
    if (key === "streamSimple") return (...args: Parameters<MutableModels["streamSimple"]>) => { streamAborted.push(args[2]?.signal?.aborted ?? false); return target.streamSimple(...args); };
    if (key === "getModel") return (...args: Parameters<MutableModels["getModel"]>) => { modelLookups++; return target.getModel(...args); };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  const events: ExecutionEvent[] = [], invocations: ModelInvocation[] = [], costEvents: CostGateEvent[] = [];
  const executor = new PiAgentExecutor({ providerId, modelId: "probe-model", models, tools,
    retry: { onRetry: () => { retries++; }, sleep: async () => { sleeps++; } },
    onCostGate: (event) => { costEvents.push(event); }, onInvocation: (event) => { invocations.push(event); } });
  const controller = new AbortController();
  const run = async (cap?: number): Promise<void> => {
    for await (const event of executor.execute({ runId: createRunId(), taskId: createTaskId(), agentInstanceId: createAgentInstanceId(), prompt: "Call probe_tool, then finish.", workingDirectory: ".", ...(cap === undefined ? {} : { maxCostUsd: cap }) }, controller.signal)) events.push(event);
  };
  const observe = (scenario: ExecutionObservation["scenario"], toolStarts: number, toolCompletions: number): ExecutionObservation => {
    const invocation = invocations[0];
    return { scenario, streamEntries: streamAborted.length, streamAborted, providerDispatches: dispatchAborted.length, dispatchAborted, providerHandlers: faux.state.callCount, modelLookups, retries, sleeps,
      pendingResponses: faux.getPendingResponseCount(), toolStarts, toolCompletions, toolErrors: events.filter((event) => event.type === "TOOL_FINISHED" && event.isError).length, contexts,
      turns: events.filter((event) => event.type === "TURN_FINISHED").map((event) => event.usage === undefined ? null : { inputTokens: event.usage.inputTokens!, outputTokens: event.usage.outputTokens! }),
      invocations: invocations.length, invocation: invocation === undefined ? null : { outcome: invocation.callOutcome ?? "unknown", tokensIn: invocation.tokensIn ?? null, tokensOut: invocation.tokensOut ?? null, cacheHit: invocation.cacheHit ?? null },
      taskResults: events.flatMap((event) => event.type === "MESSAGE" && event.message.type === "TASK_RESULT" ? [event.message.outcome] : []),
      executionFinished: events.flatMap((event) => event.type === "EXECUTION_FINISHED" ? [event.outcome] : []),
      costEvents: costEvents.map((event) => event.kind === "stopped" ? { kind: event.kind, maxCostUsd: event.maxCostUsd, ledger: event.ledger } : { kind: event.kind, maxCostUsd: event.maxCostUsd, reason: event.reason }),
      eventTypes: events.map((event) => event.type) };
  };
  return { run, observe, controller };
}
async function pricedOrUnpriced(priced: boolean): Promise<ExecutionObservation> {
  let started = 0, completed = 0;
  const tool: AgentTool = { name: "probe_tool", label: "Probe tool", description: "Complete one turn", parameters: Type.Object({}), execute: async () => { started++; completed++; return { content: [{ type: "text", text: "complete" }], details: {} }; } };
  const h = harness(priced ? "priced-probe-faux" : "unpriced-probe-faux", [tool], priced, priced ? "must remain unused" : "second turn completed");
  await bounded(h.run(priced ? 0.5 : 0.000001), "cost run");
  return h.observe(priced ? "priced-stop" : "unpriced-cap", started, completed);
}
async function preabort(): Promise<ExecutionObservation> {
  const h = harness("preabort-probe-faux", [], true, "must remain unused");
  h.controller.abort();
  await bounded(h.run(), "preabort");
  return h.observe("preabort", 0, 0);
}
async function blockedTool(): Promise<ExecutionObservation> {
  const entered = deferred(), release = deferred();
  let started = 0, completed = 0, toolSignal: AbortSignal | undefined, runSettled = false;
  const tool: AgentTool = { name: "probe_tool", label: "Probe tool", description: "Hold until explicit release", parameters: Type.Object({}), execute: async (_id, _args, signal) => { started++; toolSignal = signal; entered.resolve(); await release.promise; completed++; return { content: [{ type: "text", text: "released" }], details: {} }; } };
  const h = harness("abort-probe-faux", [tool], true, "must remain unused");
  const running = h.run().then(() => { runSettled = true; });
  try {
    await bounded(entered.promise, "tool entry"); h.controller.abort(); await delay(30);
    const observed = h.observe("blocked-tool-cancel", started, completed);
    const held = { runSettled, toolStarts: started, toolCompletions: completed, toolSignalAborted: toolSignal?.aborted === true, providerDispatches: observed.providerDispatches, taskResults: observed.taskResults.length, executionFinished: observed.executionFinished.length, invocations: observed.invocations };
    release.resolve(); await bounded(running, "tool release");
    return { ...h.observe("blocked-tool-cancel", started, completed), held, released: { runSettled, toolSignalAborted: toolSignal?.aborted === true } };
  } finally { release.resolve(); await bounded(running, "tool cleanup"); }
}
async function deferredAgentEnd(): Promise<SettlementObservation> {
  const entered = deferred(), release = deferred();
  const faux = fauxProvider({ provider: "settlement-faux", api: "settlement-api", tokenSize: { min: 4, max: 4 } });
  faux.setResponses([fauxAssistantMessage("settled", { timestamp: 1 })]);
  const models = createModels(); models.setProvider(faux.provider);
  const agent = new Agent({ initialState: { model: faux.getModel(), systemPrompt: "", thinkingLevel: "off", tools: [] }, streamFn: (model, context, options) => models.streamSimple(model, context, options) });
  const kernel = SparkleKernel.fromAgent(agent);
  let agentEndCount = 0, promptSettled = false, agentIdleSettled = false, kernelIdleSettled = false;
  const unsubscribe = agent.subscribe(async (event) => { if (event.type === "agent_end") { agentEndCount++; entered.resolve(); await release.promise; } });
  const prompt = agent.prompt("Reply settled").then(() => { promptSettled = true; });
  try {
    await bounded(entered.promise, "agent_end entry");
    const agentIdle = agent.waitForIdle().then(() => { agentIdleSettled = true; });
    const kernelIdle = kernel.waitForIdle().then(() => { kernelIdleSettled = true; });
    await delay(30);
    const held = { promptSettled, agentIdleSettled, kernelIdleSettled, isStreaming: agent.state.isStreaming, pendingTools: agent.state.pendingToolCalls.size };
    release.resolve(); await bounded(Promise.all([prompt, agentIdle, kernelIdle]), "agent_end release");
    return { scenario: "deferred-agent-end", held, released: { promptSettled, agentIdleSettled, kernelIdleSettled, isStreaming: agent.state.isStreaming, pendingTools: agent.state.pendingToolCalls.size, activeSignalAbsent: agent.signal === undefined }, agentEndCount, providerHandlers: faux.state.callCount };
  } finally { release.resolve(); await bounded(prompt, "agent_end cleanup"); unsubscribe(); }
}
/** Fixed credential-free in-process tools and faux provider only; no network or command tools. */
export async function observeManagedQualification(): Promise<QualificationObservation[]> {
  return [await pricedOrUnpriced(true), await pricedOrUnpriced(false), await preabort(), await blockedTool(), await deferredAgentEnd()];
}
