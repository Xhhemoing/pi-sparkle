import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { Type, calculateCost, createAssistantMessageEventStream, createModels, createProvider,
  fauxAssistantMessage, fauxProvider, fauxToolCall, type Model, type SimpleStreamOptions, type Usage } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { AgentSession } from "@earendil-works/pi-coding-agent";
import { PiAgentExecutor, type ExecutionCostReport as Report } from "../../../src/pi-adapter/pi-executor.js";
import { createConfiguredPiExecutor } from "../../../src/pi-adapter/runtime.js";
import { createAgentInstanceId, createRunId, createTaskId } from "../../../src/domain/ids.js";
import type { ExecutionEvent } from "../../../src/execution/contract.js";

function latch() { let release!: () => void; const promise = new Promise<void>((resolve) => { release = resolve; }); return { promise, release }; }
async function bounded<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([pending, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Error("held callback did not settle")), 8000); })]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
interface Response { readonly output?: number; readonly cacheRead?: number; readonly cacheWrite?: number;
  readonly missingUsage?: boolean; readonly partialCost?: boolean; readonly stop?: "stop" | "error" | "toolUse";
  readonly throwBeforeStream?: boolean;
  readonly held?: { entered: ReturnType<typeof latch>; release: ReturnType<typeof latch>; aborted: ReturnType<typeof latch> }; }
function provider(responses: readonly Response[], cost?: Model<"faux">["cost"], fallbackCost?: Model<"faux">["cost"]) {
  const model = { ...fauxProvider().getModel()!, provider: "execution-cost-local", id: "primary",
    cost: cost ?? { input: 1_000_000, output: 1_000_000, cacheRead: 2_000_000, cacheWrite: 3_000_000 } };
  let calls = 0;
  const amounts: number[] = [];
  const retries: (number | undefined)[] = [];
  const stream = (selected: Model<"faux">, _context: unknown, options?: SimpleStreamOptions) => {
    retries.push(options?.maxRetries);
    const response = responses[calls++];
    assert.ok(response, "unexpected extra provider dispatch");
    if (response.throwBeforeStream) throw Error("HTTP 503 local transport failed before any stream result");
    const usage: Usage = { input: 0, output: response.output ?? 1, cacheRead: response.cacheRead ?? 0,
      cacheWrite: response.cacheWrite ?? 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
    usage.totalTokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
    calculateCost(selected, usage); amounts.push(usage.cost.total);
    if (response.partialCost) usage.cost.total += 1;
    const stopReason = response.stop ?? "stop";
    const message = { ...fauxAssistantMessage(stopReason === "toolUse" ? fauxToolCall("cost_tool", {}) : "local cost observation", {
      stopReason, ...(stopReason === "error" ? { errorMessage: "HTTP 503 local synthetic failure" } : {}) }),
      api: selected.api, provider: selected.provider, model: selected.id, usage };
    if (response.missingUsage) delete (message as { usage?: Usage }).usage;
    const result = createAssistantMessageEventStream();
    queueMicrotask(async () => {
      result.push({ type: "start", partial: { ...message, content: [], stopReason: "pending" } });
      if (response.held !== undefined) {
        assert.ok(options?.signal);
        options.signal.addEventListener("abort", response.held.aborted.release, { once: true });
        result.push({ type: "text_start", contentIndex: 0, partial: message });
        result.push({ type: "text_delta", contentIndex: 0, delta: "held", partial: message });
        response.held.entered.release();
        await response.held.release.promise;
      }
      if (stopReason === "error") result.push({ type: "error", reason: "error", error: message });
      else result.push({ type: "done", reason: stopReason, message });
      result.end(message);
    });
    return result;
  };
  const models = createModels();
  models.setProvider(createProvider({ id: model.provider, models: [model, { ...model, id: "fallback", ...(fallbackCost === undefined ? {} : { cost: fallbackCost }) }],
    auth: { apiKey: { name: "Local synthetic", resolve: async () => ({ auth: {} }) } }, api: { stream, streamSimple: stream } }));
  return { model, models, amounts, retries, calls: () => calls };
}
const request = () => ({ runId: createRunId(), taskId: createTaskId(), agentInstanceId: createAgentInstanceId(),
  workingDirectory: process.cwd(), prompt: "Local synthetic transport; report only the scripted result." });
async function drain(executor: PiAgentExecutor, signal = new AbortController().signal): Promise<ExecutionEvent[]> {
  const events: ExecutionEvent[] = []; for await (const event of executor.execute(request(), signal)) events.push(event); return events;
}
const tool: AgentTool = { name: "cost_tool", label: "Cost test tool", description: "Synthetic local tool", parameters: Type.Object({}),
  execute: async () => ({ content: [{ type: "text", text: "local" }], details: {} }) };

test("execution cost reports ordinary settled success even when legacy gate emits nothing", async () => {
  const f = provider([{ output: 2, cacheRead: 3, cacheWrite: 4 }]);
  const reports: Report[] = []; const legacy: unknown[] = [];
  const executor = new PiAgentExecutor({ providerId: f.model.provider, modelId: f.model.id, models: f.models,
    onCostGate: (event) => legacy.push(event), ...{ onExecutionCost: (report: Report) => reports.push(report) } });
  await drain(executor);
  assert.equal(f.calls(), 1); assert.deepEqual(legacy, []);
  assert.equal(reports.length, 1);
  assert.equal(reports[0]!.knownReferenceUsd, 20);
  assert.equal(reports[0]!.coverage, "complete"); assert.equal(reports[0]!.settled, true);
  assert.equal(reports[0]!.streamDispatches, 1); assert.equal(reports[0]!.ledger.turns, 1);
  assert.deepEqual(f.retries, [0], "the actual SDK transport must disable hidden provider retries");
  assert.ok(Object.isFrozen(reports[0])); assert.ok(Object.isFrozen(reports[0]!.ledger));
});

for (const continuation of ["retry", "fallback"] as const) test(`execution cost keeps failed cache usage across actual ${continuation}`, async () => {
  const f = provider([{ output: 1, cacheRead: 50, stop: "error" }, { output: 1, cacheWrite: 20 }]);
  const reports: Report[] = [];
  const executor = new PiAgentExecutor({ providerId: f.model.provider, modelId: f.model.id, models: f.models,
    retry: { maxAttempts: continuation === "retry" ? 2 : 1, sleep: async () => undefined },
    ...(continuation === "fallback" ? { fallbackModels: [{ providerId: f.model.provider, modelId: "fallback" }] } : {}),
    ...{ onExecutionCost: (report: Report) => reports.push(report) } });
  await drain(executor);
  assert.equal(f.calls(), 2); assert.equal(reports.length, 1);
  assert.equal(reports[0]!.knownReferenceUsd, 162); assert.equal(reports[0]!.ledger.turns, 2);
  assert.equal(reports[0]!.coverage, "complete");
});

for (const mode of ["missing", "partial", "unpriced"] as const) test(`execution cost retains ${mode} coverage without manufacturing complete zero`, async () => {
  const f = provider([{ output: 2, missingUsage: mode === "missing", partialCost: mode === "partial" }],
    mode === "unpriced" ? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } : undefined);
  const reports: Report[] = [];
  await drain(new PiAgentExecutor({ providerId: f.model.provider, modelId: f.model.id, models: f.models,
    ...{ onExecutionCost: (report: Report) => reports.push(report) } }));
  assert.equal(reports.length, 1); assert.equal(reports[0]!.streamDispatches, 1);
  assert.equal(reports[0]!.coverage, mode === "partial" ? "partial" : "unknown");
  assert.equal(reports[0]!.knownReferenceUsd, mode === "partial" ? 2 : 0);
});

for (const held of ["provider", "tool"] as const) for (const stop of ["return", "abort"] as const) {
  test(`execution cost waits for held ${held} ${stop} and includes late settled usage`, { timeout: 20000 }, async () => {
    const entered = latch(), release = latch(), aborted = latch();
    const f = provider(held === "provider" ? [{ output: 5, cacheRead: 4, held: { entered, release, aborted } }]
      : [{ output: 5, cacheRead: 4, stop: "toolUse" }]);
    const heldTool: AgentTool = { ...tool, execute: async (_id, _args, signal) => {
      assert.ok(signal); signal.addEventListener("abort", aborted.release, { once: true }); entered.release();
      await release.promise; return { content: [{ type: "text", text: "released" }], details: {} };
    } };
    const reports: Report[] = []; const controller = new AbortController();
    const executor = new PiAgentExecutor({ providerId: f.model.provider, modelId: f.model.id, models: f.models, tools: [heldTool],
      ...{ onExecutionCost: (report: Report) => reports.push(report) } });
    const iterator = executor.execute(request(), controller.signal)[Symbol.asyncIterator]() as AsyncGenerator<ExecutionEvent>;
    let closing: Promise<unknown> | undefined; let closed = false;
    try {
      for (let n = 0; n < 20; n++) {
        const step = await bounded(iterator.next()); assert.equal(step.done, false);
        if (held === "provider" ? step.value.type === "TEXT_DELTA" : step.value.type === "TOOL_STARTED") break;
      }
      await bounded(entered.promise);
      if (stop === "return") closing = iterator.return(undefined as never).then(() => { closed = true; });
      else { controller.abort(); closing = (async () => { while (!(await iterator.next()).done) { /* Drain cancellation. */ } closed = true; })(); }
      await bounded(aborted.promise); await setImmediate();
      assert.equal(closed, false); assert.equal(reports.length, 0, "abort intent is not settlement");
    } finally { release.release(); if (closing === undefined) closing = iterator.return(undefined as never); await bounded(closing); }
    assert.equal(reports.length, 1); assert.equal(reports[0]!.knownReferenceUsd, 13);
    assert.equal(reports[0]!.streamDispatches, 1); assert.equal(reports[0]!.settled, true);
    assert.equal(f.calls(), 1);
  });
}

test("execution cost sink failure does not trigger provider retry or fallback", async () => {
  const f = provider([{ output: 2 }]); let reports = 0;
  const executor = new PiAgentExecutor({ providerId: f.model.provider, modelId: f.model.id, models: f.models,
    fallbackModels: [{ providerId: f.model.provider, modelId: "fallback" }],
    ...{ onExecutionCost: () => { reports++; throw Error("host cost sink failed"); } } });
  await assert.rejects(drain(executor), /host cost sink failed/);
  assert.equal(reports, 1); assert.equal(f.calls(), 1);
});

test("configured runtime passes the execution cost observer to the actual Pi executor", async () => {
  const f = provider([{ output: 2 }]); const reports: Report[] = [];
  const executor = await createConfiguredPiExecutor({ stateRoot: process.cwd(), customProviders: [],
    providerId: f.model.provider, modelId: f.model.id, ...{ onExecutionCost: (report: Report) => reports.push(report) } },
    async () => ({ models: f.models }));
  await drain(executor); assert.equal(reports.length, 1); assert.equal(reports[0]!.knownReferenceUsd, 2);
});

test("execution cost observes SDK cache tier pricing through the original gate", async () => {
  const f = provider([{ output: 1, cacheRead: 100 }], { input: 1_000_000, output: 1_000_000,
    cacheRead: 2_000_000, cacheWrite: 3_000_000,
    tiers: [{ inputTokensAbove: 50, input: 2_000_000, output: 2_000_000, cacheRead: 4_000_000, cacheWrite: 6_000_000 }] });
  const reports: Report[] = [];
  await drain(new PiAgentExecutor({ providerId: f.model.provider, modelId: f.model.id, models: f.models,
    onExecutionCost: (report) => reports.push(report) }));
  assert.equal(reports[0]!.knownReferenceUsd, 402);
  assert.equal(reports[0]!.coverage, "complete");
});

for (const unpricedFirst of [true, false]) test(`execution cost keeps the known subtotal in a mixed fallback chain (${unpricedFirst})`, async () => {
  const priced = { input: 1_000_000, output: 1_000_000, cacheRead: 2_000_000, cacheWrite: 3_000_000 };
  const unpriced = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const f = provider([{ output: 2, stop: "error" }, { output: 2 }], unpricedFirst ? unpriced : priced, unpricedFirst ? priced : unpriced);
  const reports: Report[] = [];
  await drain(new PiAgentExecutor({ providerId: f.model.provider, modelId: f.model.id, models: f.models,
    retry: { maxAttempts: 1 }, fallbackModels: [{ providerId: f.model.provider, modelId: "fallback" }],
    onExecutionCost: (report) => reports.push(report) }));
  assert.equal(f.calls(), 2); assert.equal(reports.length, 1);
  assert.equal(reports[0]!.knownReferenceUsd, 2); assert.equal(reports[0]!.ledger.spentUsd, undefined);
  assert.equal(reports[0]!.coverage, "partial"); assert.equal(reports[0]!.streamDispatches, 2);
});

test("execution cost cannot call a dispatched transport failure complete zero", async () => {
  const f = provider([{ throwBeforeStream: true }]); const reports: Report[] = [];
  await drain(new PiAgentExecutor({ providerId: f.model.provider, modelId: f.model.id, models: f.models,
    retry: { maxAttempts: 1 }, onExecutionCost: (report) => reports.push(report) }));
  assert.equal(f.calls(), 1); assert.equal(reports.length, 1);
  assert.equal(reports[0]!.streamDispatches, 1); assert.equal(reports[0]!.coverage, "unknown");
});

test("execution cost marks unresolved session settlement without inventing complete cost", async (t) => {
  const f = provider([{ output: 2 }]); const reports: Report[] = [];
  const idle = AgentSession.prototype.waitForIdle;
  t.mock.method(AgentSession.prototype, "waitForIdle", async function(this: AgentSession) {
    await idle.call(this); throw Error("local idle confirmation unavailable");
  });
  const executor = new PiAgentExecutor({ providerId: f.model.provider, modelId: f.model.id, models: f.models,
    onExecutionCost: (report) => reports.push(report) });
  await assert.rejects(drain(executor), /idle confirmation unavailable/);
  assert.equal(f.calls(), 1); assert.equal(reports.length, 1);
  assert.equal(reports[0]!.knownReferenceUsd, 2); assert.equal(reports[0]!.settled, false);
  assert.equal(reports[0]!.coverage, "partial");
});

test("execution cost pre-abort records no dispatch and exactly one report", async () => {
  const f = provider([]); const reports: Report[] = []; const abort = new AbortController(); abort.abort();
  const executor = new PiAgentExecutor({ providerId: f.model.provider, modelId: f.model.id, models: f.models,
    onExecutionCost: (report) => reports.push(report) });
  await drain(executor, abort.signal);
  assert.equal(f.calls(), 0); assert.equal(reports.length, 1);
  assert.equal(reports[0]!.streamDispatches, 0); assert.equal(reports[0]!.knownReferenceUsd, 0);
  assert.equal(reports[0]!.settled, true);
});
