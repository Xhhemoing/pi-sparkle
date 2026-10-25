import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { Type, calculateCost, createAssistantMessageEventStream, createModels, createProvider,
  fauxAssistantMessage, fauxProvider, fauxToolCall, type Model, type SimpleStreamOptions, type Usage } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { PiAgentExecutor, type ExecutionCostReport, type PiExecutorOptions } from "../../../src/pi-adapter/pi-executor.js";
import * as PiExecutorModule from "../../../src/pi-adapter/pi-executor.js";
import { createConfiguredPiExecutor } from "../../../src/pi-adapter/runtime.js";
import { createAgentInstanceId, createRunId, createTaskId } from "../../../src/domain/ids.js";
import type { AgentExecutionRequest, ExecutionEvent } from "../../../src/execution/contract.js";

function latch() { let release!: () => void; const promise = new Promise<void>((resolve) => { release = resolve; }); return { promise, release }; }
async function bounded<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([pending, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Error("strict held work did not settle")), 8000); })]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
interface Response { readonly output?: number; readonly cacheRead?: number; readonly missing?: boolean; readonly partial?: boolean;
  readonly stop?: "stop" | "error" | "toolUse"; readonly throwBeforeStream?: boolean;
  readonly held?: { entered: ReturnType<typeof latch>; release: ReturnType<typeof latch>; aborted: ReturnType<typeof latch> }; }
const priced = { input: 1_000_000, output: 1_000_000, cacheRead: 2_000_000, cacheWrite: 3_000_000 };
const unpriced = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
function provider(responses: readonly Response[], primaryCost: Model<"faux">["cost"] = priced, fallbackCost: Model<"faux">["cost"] = priced) {
  const model = { ...fauxProvider().getModel()!, provider: "strict-execution-cost-local", id: "primary", cost: primaryCost };
  let calls = 0;
  const dispatched: string[] = [];
  const amounts: number[] = [];
  const stream = (selected: Model<"faux">, _context: unknown, options?: SimpleStreamOptions) => {
    const response = responses[calls++]; dispatched.push(selected.id);
    assert.ok(response, "unexpected extra local transport dispatch");
    assert.equal(options?.maxRetries, 0);
    if (response.throwBeforeStream) throw Error("HTTP 503 local transport failed before stream creation");
    const usage: Usage = { input: 0, output: response.output ?? 1, cacheRead: response.cacheRead ?? 0, cacheWrite: 0,
      totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
    usage.totalTokens = usage.input + usage.output + usage.cacheRead;
    calculateCost(selected, usage);
    if (response.partial) usage.cost.total += 1;
    amounts.push(usage.cost.total);
    const stopReason = response.stop ?? "stop";
    const message = { ...fauxAssistantMessage(stopReason === "toolUse" ? fauxToolCall("strict_cost_tool", {}) : "local strict reference test", {
      stopReason, ...(stopReason === "error" ? { errorMessage: "HTTP 503 local synthetic failure" } : {}) }),
      api: selected.api, provider: selected.provider, model: selected.id, usage };
    if (response.missing) delete (message as { usage?: Usage }).usage;
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
  models.setProvider(createProvider({ id: model.provider, models: [model, { ...model, id: "fallback", cost: fallbackCost }],
    auth: { apiKey: { name: "Local synthetic", resolve: async () => ({ auth: {} }) } }, api: { stream, streamSimple: stream } }));
  return { model, models, calls: () => calls, dispatched, amounts };
}
const tool: AgentTool = { name: "strict_cost_tool", label: "Strict cost tool", description: "Synthetic local continuation",
  parameters: Type.Object({}), execute: async () => ({ content: [{ type: "text", text: "continue" }], details: {} }) };
function request(maxCostUsd = 10): AgentExecutionRequest {
  return { runId: createRunId(), taskId: createTaskId(), agentInstanceId: createAgentInstanceId(),
    workingDirectory: process.cwd(), prompt: "Local synthetic strict reference test", maxCostUsd };
}
async function drain(executor: PiAgentExecutor, input = request(), signal = new AbortController().signal) {
  const events: ExecutionEvent[] = [];
  for await (const event of executor.execute(input, signal)) events.push(event);
  return events;
}
function executor(f: ReturnType<typeof provider>, reports: ExecutionCostReport[], options: Partial<PiExecutorOptions> = {}) {
  return new PiAgentExecutor({ providerId: f.model.provider, modelId: f.model.id, models: f.models, tools: [tool],
    retry: { maxAttempts: 2, sleep: async () => undefined },
    fallbackModels: [{ providerId: f.model.provider, modelId: "fallback" }],
    ...{ strictReferenceBudget: true }, ...options, onExecutionCost: (report) => reports.push(report) });
}

for (const continuation of ["turn", "retry", "fallback"] as const) {
  for (const coverage of ["missing", "partial"] as const) {
    test(`strict reference budget refuses a ${continuation} after ${coverage} usage`, async () => {
      const f = provider([{ [coverage]: true, stop: continuation === "turn" ? "toolUse" : "error" }, { output: 1 }]);
      const reports: ExecutionCostReport[] = [];
      const events = await drain(executor(f, reports, continuation === "fallback" ? { retry: { maxAttempts: 1 } } : {}));
      assert.equal(f.calls(), 1, "uncovered dispatch must not authorize more provider work");
      assert.equal(reports.length, 1); assert.equal(reports[0]!.streamDispatches, 1);
      assert.equal(reports[0]!.settled, true); assert.notEqual(reports[0]!.coverage, "complete");
      assert.deepEqual(events.at(-1), { type: "EXECUTION_FINISHED", outcome: "FAILURE" });
    });
  }
}

test("strict reference budget refuses an unpriced primary before any dispatch", async () => {
  const f = provider([{ output: 1 }], unpriced); const reports: ExecutionCostReport[] = [];
  const events = await drain(executor(f, reports));
  assert.equal(f.calls(), 0); assert.equal(reports.length, 1); assert.equal(reports[0]!.streamDispatches, 0);
  assert.deepEqual(events.at(-1), { type: "EXECUTION_FINISHED", outcome: "FAILURE" });
});

test("strict reference budget refuses an unpriced fallback after a fully priced failure", async () => {
  const f = provider([{ output: 2, stop: "error" }, { output: 1 }], priced, unpriced); const reports: ExecutionCostReport[] = [];
  await drain(executor(f, reports, { retry: { maxAttempts: 1 } }));
  assert.deepEqual(f.dispatched, ["primary"]); assert.equal(reports.length, 1);
  assert.equal(reports[0]!.knownReferenceUsd, 2); assert.equal(reports[0]!.streamDispatches, 1);
});

test("strict reference budget latches an uncovered transport exception before retry or fallback", async () => {
  const f = provider([{ throwBeforeStream: true }, { output: 1 }]); const reports: ExecutionCostReport[] = [];
  await drain(executor(f, reports));
  assert.equal(f.calls(), 1); assert.equal(reports.length, 1); assert.equal(reports[0]!.coverage, "unknown");
});

test("strict reference budget requires a valid positive allowance before dispatch", async () => {
  for (const cap of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const f = provider([{ output: 1 }]); const reports: ExecutionCostReport[] = [];
    const input = request(); if (cap === undefined) delete input.maxCostUsd; else input.maxCostUsd = cap;
    const events = await drain(executor(f, reports), input);
    assert.equal(f.calls(), 0, `invalid allowance ${String(cap)} must not send work`);
    assert.equal(reports.length, 1);
    assert.deepEqual(events.at(-1), { type: "EXECUTION_FINISHED", outcome: "FAILURE" });
  }
});

test("configured runtime forwards strict reference dispatch policy", async () => {
  const f = provider([{ missing: true, stop: "toolUse" }, { output: 1 }]); const reports: ExecutionCostReport[] = [];
  const configured = await createConfiguredPiExecutor({ stateRoot: process.cwd(), customProviders: [],
    providerId: f.model.provider, modelId: f.model.id, tools: [tool],
    ...{ strictReferenceBudget: true }, onExecutionCost: (report) => reports.push(report) }, async () => ({ models: f.models }));
  await drain(configured);
  assert.equal(f.calls(), 1); assert.equal(reports.length, 1); assert.notEqual(reports[0]!.coverage, "complete");
});

for (const spend of [2, 3]) test(`strict complete successful spend ${spend} keeps success at or above the ceiling`, async () => {
  const f = provider([{ output: spend }]); const reports: ExecutionCostReport[] = [];
  const events = await drain(executor(f, reports), request(2));
  assert.equal(f.calls(), 1); assert.equal(reports.length, 1); assert.equal(reports[0]!.coverage, "complete");
  assert.equal(reports[0]!.knownReferenceUsd, spend);
  assert.deepEqual(events.at(-1), { type: "EXECUTION_FINISHED", outcome: "SUCCESS" });
});

test("strict fully priced failures retain bounded retry and fallback while allowance remains", async () => {
  const f = provider([{ output: 1, cacheRead: 1, stop: "error" }, { output: 1, stop: "error" }, { output: 1 }]);
  const reports: ExecutionCostReport[] = [];
  await drain(executor(f, reports));
  assert.deepEqual(f.dispatched, ["primary", "primary", "fallback"]);
  assert.equal(reports.length, 1); assert.equal(reports[0]!.knownReferenceUsd, 5); assert.equal(reports[0]!.coverage, "complete");
});

test("legacy incomplete usage still permits ordinary continuation without strict opt-in", async () => {
  const f = provider([{ missing: true, stop: "toolUse" }, { output: 1 }]); const reports: ExecutionCostReport[] = [];
  const legacy = new PiAgentExecutor({ providerId: f.model.provider, modelId: f.model.id, models: f.models,
    tools: [tool], onExecutionCost: (report) => reports.push(report) });
  await drain(legacy); assert.equal(f.calls(), 2); assert.equal(reports[0]!.coverage, "partial");
});

test("only the original Pi finalizer report authenticates its sink and strict policy", async () => {
  const authenticates = (PiExecutorModule as unknown as { isPiExecutionCostReportFor?:
    (report: unknown, sink: (report: ExecutionCostReport) => void, options?: { requireStrict?: true }) => boolean }).isPiExecutionCostReportFor;
  assert.equal(typeof authenticates, "function", "the Native owner needs an identity-only report query");
  assert.ok(authenticates);
  for (const strict of [false, true]) {
    const f = provider([{ output: 1 }]); const reports: ExecutionCostReport[] = [];
    const sink = (report: ExecutionCostReport): void => {
      assert.equal(authenticates(report, sink), true, "identity must be registered before invoking the sink");
      reports.push(report);
    };
    const instance = new PiAgentExecutor({ providerId: f.model.provider, modelId: f.model.id, models: f.models,
      ...(strict ? { strictReferenceBudget: true } : {}), onExecutionCost: sink });
    await drain(instance);
    assert.equal(reports.length, 1);
    const original = reports[0]!;
    assert.equal(authenticates(original, sink), true);
    assert.equal(authenticates(original, sink, { requireStrict: true }), strict);
    assert.equal(authenticates(original, () => undefined), false);
    assert.equal(authenticates(JSON.parse(JSON.stringify(original)) as unknown, sink), false);
    assert.equal(authenticates({ ...original }, sink), false);
    assert.equal(authenticates(null, sink), false);
    assert.equal(authenticates({}, undefined as never), false);
  }
});

test("report strict authentication keeps the actual execute-start policy when host options change", async () => {
  const authenticates = (PiExecutorModule as unknown as { isPiExecutionCostReportFor:
    (report: unknown, sink: (report: ExecutionCostReport) => void, options?: { requireStrict?: true }) => boolean }).isPiExecutionCostReportFor;
  for (const initiallyStrict of [false, true]) {
    const f = provider([{ output: 1, stop: "toolUse" }, { output: 1 }]); const reports: ExecutionCostReport[] = [];
    const sink = (report: ExecutionCostReport): void => { reports.push(report); };
    const options: PiExecutorOptions = { providerId: f.model.provider, modelId: f.model.id, models: f.models,
      ...(initiallyStrict ? { strictReferenceBudget: true } : {}), onExecutionCost: sink };
    options.tools = [{ ...tool, execute: async () => {
      if (initiallyStrict) delete options.strictReferenceBudget; else options.strictReferenceBudget = true;
      return { content: [{ type: "text", text: "host policy mutated" }], details: {} };
    } }];
    await drain(new PiAgentExecutor(options));
    assert.equal(f.calls(), 2); assert.equal(reports.length, 1);
    assert.equal(authenticates(reports[0], sink, { requireStrict: true }), initiallyStrict);
  }
});

for (const continuation of ["turn", "retry", "fallback"] as const) test(`strict exhausted allowance prevents a ${continuation}`, async () => {
  const f = provider([{ output: 2, stop: continuation === "turn" ? "toolUse" : "error" }, { output: 1 }]);
  const reports: ExecutionCostReport[] = [];
  await drain(executor(f, reports, continuation === "fallback" ? { retry: { maxAttempts: 1 } } : {}), request(2));
  assert.equal(f.calls(), 1); assert.equal(reports.length, 1);
  assert.equal(reports[0]!.knownReferenceUsd, 2); assert.equal(reports[0]!.coverage, "complete");
});

for (const held of ["provider", "tool"] as const) for (const stop of ["return", "abort"] as const) {
  test(`strict cost waits for held ${held} ${stop} and preserves late usage and cancellation`, { timeout: 20000 }, async () => {
    const entered = latch(), release = latch(), aborted = latch();
    const f = provider(held === "provider" ? [{ output: 2, cacheRead: 2, held: { entered, release, aborted } }]
      : [{ output: 2, cacheRead: 2, stop: "toolUse" }]);
    const reports: ExecutionCostReport[] = []; const controller = new AbortController();
    const heldTool: AgentTool = { ...tool, execute: async (_id, _args, signal) => {
      assert.ok(signal); signal.addEventListener("abort", aborted.release, { once: true }); entered.release();
      await release.promise; return { content: [{ type: "text", text: "released" }], details: {} };
    } };
    const instance = executor(f, reports, { tools: [heldTool] });
    const iterator = instance.execute(request(6), controller.signal)[Symbol.asyncIterator]() as AsyncGenerator<ExecutionEvent>;
    let closing: Promise<unknown> | undefined; let closed = false; const terminal: ExecutionEvent[] = [];
    try {
      for (let n = 0; n < 20; n++) {
        const step = await bounded(iterator.next()); assert.equal(step.done, false);
        if (held === "provider" ? step.value.type === "TEXT_DELTA" : step.value.type === "TOOL_STARTED") break;
      }
      await bounded(entered.promise);
      if (stop === "return") closing = iterator.return(undefined as never).then(() => { closed = true; });
      else {
        controller.abort(); closing = (async () => {
          for (;;) { const step = await iterator.next(); if (step.done) break; terminal.push(step.value); }
          closed = true;
        })();
      }
      await bounded(aborted.promise); await setImmediate();
      assert.equal(closed, false); assert.equal(reports.length, 0, "cost rejection and cancellation intent do not establish settlement");
    } finally { release.release(); if (closing === undefined) closing = iterator.return(undefined as never); await bounded(closing); }
    assert.equal(f.calls(), 1); assert.equal(reports.length, 1);
    assert.equal(reports[0]!.knownReferenceUsd, 6); assert.equal(reports[0]!.settled, true); assert.equal(reports[0]!.coverage, "complete");
    if (stop === "abort") assert.deepEqual(terminal.at(-1), { type: "EXECUTION_FINISHED", outcome: "CANCELLED" });
  });
}

for (const continuation of ["turn", "retry", "fallback"] as const) {
  test(`strict sub-microdollar overrun prevents a ${continuation} and retains actual reference`, async () => {
    const rates = { input: 0.2, output: 0.2, cacheRead: 0.2, cacheWrite: 0.2 };
    const f = provider([{ output: 1, stop: continuation === "turn" ? "toolUse" : "error" }, { output: 1 }], rates, rates);
    const reports: ExecutionCostReport[] = [];
    await drain(executor(f, reports, continuation === "fallback" ? { retry: { maxAttempts: 1 } } : {}), request(1e-7));
    assert.equal(f.calls(), 1, "display rounding must never authorize another dispatch after actual overrun");
    assert.equal(reports.length, 1); assert.equal(reports[0]!.coverage, "complete");
    assert.equal(reports[0]!.knownReferenceUsd, f.amounts[0]);
    assert.ok(reports[0]!.knownReferenceUsd! > 1e-7);
    assert.equal(reports[0]!.ledger.spentUsd, f.amounts[0]);
  });
}

test("host reference report preserves sub-microdollar cache tier amounts without changing legacy gate events", async () => {
  const rates = { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4,
    tiers: [{ inputTokensAbove: 1, input: 0.2, output: 0.4, cacheRead: 0.6, cacheWrite: 0.8 }] };
  const f = provider([{ output: 1, cacheRead: 2, stop: "error" }, { output: 1, cacheRead: 1 }], rates, rates);
  const reports: ExecutionCostReport[] = [];
  await drain(executor(f, reports), request(1));
  assert.equal(f.calls(), 2); assert.equal(reports.length, 1); assert.equal(reports[0]!.coverage, "complete");
  assert.equal(reports[0]!.knownReferenceUsd, f.amounts.reduce((sum, amount) => sum + amount, 0));
  assert.equal(reports[0]!.ledger.spentUsd, reports[0]!.knownReferenceUsd);
});

test("unrounded host report leaves legacy CostGate event rounding unchanged", async () => {
  const rates = { input: 0.8, output: 0.8, cacheRead: 0.8, cacheWrite: 0.8 };
  const f = provider([{ output: 1, stop: "toolUse" }, { output: 1 }], rates, rates);
  const reports: ExecutionCostReport[] = []; const gateReports: import("../../../src/pi-adapter/pi-executor.js").CostGateEvent[] = [];
  const legacy = new PiAgentExecutor({ providerId: f.model.provider, modelId: f.model.id, models: f.models, tools: [tool],
    onExecutionCost: (report) => reports.push(report), onCostGate: (event) => gateReports.push(event) });
  await drain(legacy, request(5e-7));
  assert.equal(f.calls(), 1); assert.equal(reports.length, 1); assert.equal(reports[0]!.knownReferenceUsd, f.amounts[0]);
  assert.equal(gateReports.length, 1); const gate = gateReports[0]; assert.ok(gate?.kind === "stopped");
  assert.equal(gate.ledger.spentUsd, 1e-6, "legacy event amount remains on its existing six-decimal display scale");
});

for (const continuation of ["turn", "retry", "fallback"] as const) {
  test(`strict actual remaining allowance permits a ${continuation} despite rounded legacy exhaustion`, async () => {
    const rates = { input: 0.6, output: 0.6, cacheRead: 0.6, cacheWrite: 0.6 };
    const f = provider([{ output: 1, stop: continuation === "turn" ? "toolUse" : "error" }, { output: 1 }], rates, rates);
    const reports: ExecutionCostReport[] = [];
    await drain(executor(f, reports, continuation === "fallback" ? { retry: { maxAttempts: 1 } } : {}), request(9e-7));
    assert.equal(f.calls(), 2, "a display-rounded amount must not erase the actual remaining allowance");
    assert.equal(reports.length, 1); assert.equal(reports[0]!.coverage, "complete");
    assert.equal(reports[0]!.knownReferenceUsd, f.amounts.reduce((sum, amount) => sum + amount, 0));
  });
}

test("strict fractional and exact allowances retain actual sums through successive turns", async () => {
  const f = provider([{ output: 1, stop: "toolUse" }, { output: 2, stop: "toolUse" }, { output: 1 }],
    { input: 100_000, output: 100_000, cacheRead: 100_000, cacheWrite: 100_000 });
  const reports: ExecutionCostReport[] = [];
  await drain(executor(f, reports), request(0.3));
  assert.equal(f.calls(), 2); assert.equal(reports[0]!.coverage, "complete");
  assert.equal(reports[0]!.knownReferenceUsd, f.amounts.reduce((sum, amount) => sum + amount, 0));
  assert.ok(reports[0]!.knownReferenceUsd! >= 0.3);
  const exact = provider([{ output: 1 }], { input: 125_000, output: 125_000, cacheRead: 125_000, cacheWrite: 125_000 });
  const exactReports: ExecutionCostReport[] = [];
  const events = await drain(executor(exact, exactReports), request(0.125));
  assert.equal(exact.calls(), 1); assert.equal(exactReports[0]!.knownReferenceUsd, 0.125);
  assert.deepEqual(events.at(-1), { type: "EXECUTION_FINISHED", outcome: "SUCCESS" });
});

test("strict sub-microdollar exhaustion preserves a successful retry before queued steering replay", { timeout: 20000 }, async () => {
  const rates = { input: 0.1, output: 0.1, cacheRead: 0.1, cacheWrite: 0.1 };
  const f = provider([{ output: 1, stop: "toolUse" }, { output: 1, stop: "error" },
    { output: 1, stop: "toolUse" }, { output: 1 }], rates, rates);
  const reports: ExecutionCostReport[] = []; const entered = latch(), release = latch();
  const heldTool: AgentTool = { ...tool, execute: async () => {
    entered.release(); await release.promise;
    return { content: [{ type: "text", text: "released" }], details: {} };
  } };
  const instance = executor(f, reports, { tools: [heldTool] });
  const events: ExecutionEvent[] = []; let steered = false;
  try {
    for await (const event of instance.execute(request(3e-7), new AbortController().signal)) {
      events.push(event);
      if (event.type === "TOOL_STARTED" && !steered) {
        await bounded(entered.promise); instance.steerText("Keep the accepted correction through retry"); steered = true; release.release();
      }
    }
  } finally { release.release(); }
  assert.equal(steered, true); assert.equal(f.calls(), 3); assert.equal(reports.length, 1);
  assert.equal(reports[0]!.coverage, "complete"); assert.equal(reports[0]!.settled, true);
  assert.equal(reports[0]!.knownReferenceUsd, f.amounts.reduce((sum, amount) => sum + amount, 0));
  assert.deepEqual(events.at(-1), { type: "EXECUTION_FINISHED", outcome: "SUCCESS" });
});
