import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  Type,
  calculateCost,
  createAssistantMessageEventStream,
  createModels,
  createProvider,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Model,
  type Usage
} from "@earendil-works/pi-ai";
import {
  createAgentInstanceId,
  createRunId,
  createTaskId
} from "../../../src/domain/ids.js";
import type { AgentExecutionRequest, ExecutionEvent } from "../../../src/execution/contract.js";
import {
  PiAgentExecutor,
  type CostGateEvent
} from "../../../src/pi-adapter/pi-executor.js";

const toolParameters = Type.Object({});
const continueTool: AgentTool<typeof toolParameters, Record<string, never>> = {
  name: "continue_tool",
  label: "Continue tool",
  description: "Force the agent loop to consider another provider turn.",
  parameters: toolParameters,
  execute: async () => ({
    content: [{ type: "text", text: "continue" }],
    details: {}
  })
};

function request(maxCostUsd: number): AgentExecutionRequest {
  return {
    runId: createRunId(),
    taskId: createTaskId(),
    agentInstanceId: createAgentInstanceId(),
    prompt: "Call continue_tool, then finish.",
    workingDirectory: ".",
    maxCostUsd
  };
}

async function drain(executor: PiAgentExecutor, input: AgentExecutionRequest): Promise<ExecutionEvent[]> {
  const events: ExecutionEvent[] = [];
  for await (const event of executor.execute(input, new AbortController().signal)) {
    events.push(event);
  }
  return events;
}

test("Pi Agent invokes the cost stop-after-turn hook before another provider call", async () => {
  const faux = fauxProvider({
    provider: "priced-faux",
    models: [
      {
        id: "priced-model",
        name: "Priced model",
        cost: {
          input: 1_000_000,
          output: 1_000_000,
          cacheRead: 0,
          cacheWrite: 0
        }
      }
    ]
  });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("continue_tool", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage("this response must remain unused")
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  const costEvents: CostGateEvent[] = [];
  const executor = new PiAgentExecutor({
    providerId: "priced-faux",
    modelId: "priced-model",
    models,
    tools: [continueTool],
    onCostGate: (event) => costEvents.push(event)
  });

  const events = await drain(executor, request(0.5));

  assert.equal(faux.state.callCount, 1, "the Agent hook must stop before a second model call");
  assert.equal(faux.getPendingResponseCount(), 1);
  assert.equal(costEvents.length, 1);
  const stopped = costEvents[0];
  assert.equal(stopped?.kind, "stopped");
  if (stopped?.kind === "stopped") {
    assert.ok(stopped.ledger.spentUsd !== undefined);
    assert.ok(stopped.ledger.spentUsd >= stopped.maxCostUsd);
    assert.equal(stopped.ledger.turns, 1);
  }
  assert.equal(events.at(-1)?.type, "EXECUTION_FINISHED");
});

test("unknown catalog pricing reports an unenforced cap and does not invent a stop", async () => {
  const faux = fauxProvider({
    provider: "unpriced-faux",
    models: [
      {
        id: "unpriced-model",
        name: "Unpriced model",
        // A zero pair is how the custom-provider path represents absent rates.
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
      }
    ]
  });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("continue_tool", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage("second turn completed")
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  const costEvents: CostGateEvent[] = [];
  const executor = new PiAgentExecutor({
    providerId: "unpriced-faux",
    modelId: "unpriced-model",
    models,
    tools: [continueTool],
    onCostGate: (event) => costEvents.push(event)
  });

  await drain(executor, request(0.000001));

  assert.equal(faux.state.callCount, 2, "an unknown price must not fabricate a budget stop");
  assert.equal(faux.getPendingResponseCount(), 0);
  assert.deepEqual(
    costEvents.map((event) => event.kind),
    ["disarmed"]
  );
  assert.equal(costEvents[0]?.kind === "disarmed" ? costEvents[0].reason : undefined, "unpriced-model");
});

test("retry replay preserves a cost stop instead of inventing a steering failure or extra turn", { timeout: 10000 }, async () => {
  const faux = fauxProvider({ provider: "retry-budget", models: [{ id: "synthetic",
    cost: { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 } }] });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("hold", {})),
    fauxAssistantMessage([], { stopReason: "error", errorMessage: "HTTP 503 synthetic" }),
    fauxAssistantMessage("X".repeat(10000)),
    fauxAssistantMessage("must not dispatch after cost stop")
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  const costEvents: CostGateEvent[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const executor = new PiAgentExecutor({ providerId: "retry-budget", modelId: "synthetic", models,
    retry: { maxAttempts: 2, sleep: async () => undefined }, onCostGate: (event) => costEvents.push(event),
    tools: [{ name: "hold", label: "Held tool", description: "Hold until steering is accepted",
      parameters: Type.Object({}), execute: async () => {
        await held;
        return { content: [{ type: "text", text: "released" }], details: {} };
      } }]
  });
  const events: ExecutionEvent[] = [];
  const abort = new AbortController();
  const iterator = executor.execute(request(3000), abort.signal)[Symbol.asyncIterator]();
  try {
    for await (const event of { [Symbol.asyncIterator]: () => iterator }) {
      events.push(event);
      if (event.type === "TOOL_STARTED") { executor.steerText("accepted correction"); release(); }
    }
    assert.equal(faux.state.callCount, 3);
    assert.deepEqual(events.at(-1), { type: "EXECUTION_FINISHED", outcome: "SUCCESS" });
    const result = events.find((event) => event.type === "MESSAGE" && event.message.type === "TASK_RESULT");
    assert.ok(result?.type === "MESSAGE" && result.message.type === "TASK_RESULT");
    assert.match(result.message.summary, /cost ceiling/);
    assert.equal(result.message.failure, undefined);
    assert.equal(result.message.verification.kind, "UNOBSERVED");
    assert.equal(costEvents.length, 1);
    const stopped = costEvents[0];
    assert.ok(stopped?.kind === "stopped");
    assert.equal(stopped.ledger.turns, 3, "only the actual provider turns belong in the ledger");
    assert.ok((stopped.ledger.spentUsd ?? 0) >= stopped.maxCostUsd);
  } finally {
    release();
    abort.abort();
    await iterator.return?.();
  }
});

interface CachedResponse {
  readonly input?: number;
  readonly output?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
  readonly cacheWrite1h?: number;
  readonly stopReason?: "toolUse" | "error" | "stop";
  readonly afterPricing?: (usage: Usage) => void;
}

/** A real provider boundary with scripted reported counts, priced by the SDK. */
function cachedProvider(responses: readonly CachedResponse[], cost?: Model<"faux">["cost"]) {
  const model = {
    ...fauxProvider().getModel()!, provider: "charged-cache", id: "synthetic",
    cost: cost ?? { input: 1_000_000, output: 1_000_000, cacheRead: 2_000_000, cacheWrite: 3_000_000 }
  };
  let calls = 0;
  const catalogReferences: number[] = [];
  const stream = () => {
    const response = responses[calls++] ?? { stopReason: "stop" as const };
    const usage: Usage = {
      input: response.input ?? 0, output: response.output ?? 0,
      cacheRead: response.cacheRead ?? 0, cacheWrite: response.cacheWrite ?? 0,
      ...(response.cacheWrite1h !== undefined ? { cacheWrite1h: response.cacheWrite1h } : {}),
      totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    };
    usage.totalTokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
    calculateCost(model, usage);
    catalogReferences.push(usage.cost.total);
    response.afterPricing?.(usage);
    const stopReason = response.stopReason ?? "toolUse";
    const message = {
      ...fauxAssistantMessage(stopReason === "toolUse" ? fauxToolCall("continue_tool", {}) : "scripted", {
        stopReason, ...(stopReason === "error" ? { errorMessage: "HTTP 503 synthetic" } : {})
      }),
      api: model.api, provider: model.provider, model: model.id, usage
    };
    const result = createAssistantMessageEventStream();
    queueMicrotask(() => {
      result.push({ type: "start", partial: { ...message, content: [], stopReason: "pending" } });
      if (stopReason === "error") result.push({ type: "error", reason: "error", error: message });
      else result.push({ type: "done", reason: stopReason, message });
      result.end(message);
    });
    return result;
  };
  const models = createModels();
  models.setProvider(createProvider({
    id: model.provider, models: [model, { ...model, id: "fallback" }],
    auth: { apiKey: { name: "Synthetic", resolve: async () => ({ auth: {} }) } },
    api: { stream, streamSimple: stream }
  }));
  return { models, model, catalogReferences, calls: () => calls };
}

for (const cacheKind of ["cacheRead", "cacheWrite", "cacheOnly"] as const) {
  test(`charged ${cacheKind} stops before another provider request`, async () => {
    const fixture = cachedProvider([{
      output: cacheKind === "cacheOnly" ? 0 : 1,
      cacheRead: cacheKind !== "cacheWrite" ? 100 : 0,
      cacheWrite: cacheKind === "cacheWrite" ? 100 : 0
    }]);
    const costEvents: CostGateEvent[] = [];
    const executor = new PiAgentExecutor({
      providerId: fixture.model.provider, modelId: fixture.model.id, models: fixture.models,
      tools: [continueTool], onCostGate: (event) => costEvents.push(event)
    });
    await drain(executor, request(100));
    assert.equal(fixture.calls(), 1, "the first response's charged cache exceeds the cap");
    const stopped = costEvents.find((event) => event.kind === "stopped");
    assert.ok(stopped?.kind === "stopped");
    assert.deepEqual(stopped.ledger, {
      turns: 1, turnsWithoutUsage: 0, tokensIn: 0, tokensOut: cacheKind === "cacheOnly" ? 0 : 1,
      spentUsd: cacheKind === "cacheOnly" ? 200 : cacheKind === "cacheRead" ? 201 : 301
    });
  });
}

for (const missingCost of ["missing", "invalid-total", "zero-placeholder", "zero-cache-price"] as const) {
  test(`cached ${missingCost} retains the catalog reference and reports incomplete coverage`, async () => {
    const fixture = cachedProvider([{
      output: 1, cacheWrite: 100, afterPricing: (usage) => {
        if (missingCost === "missing") delete (usage as Partial<Usage>).cost;
        if (missingCost === "invalid-total") usage.cost.total += 1;
        if (missingCost === "zero-placeholder") usage.cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
      }
    }], { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: missingCost === "zero-cache-price" ? 0 : 3_000_000 });
    const costEvents: CostGateEvent[] = [];
    const executor = new PiAgentExecutor({
      providerId: fixture.model.provider, modelId: fixture.model.id, models: fixture.models,
      tools: [continueTool], onCostGate: (event) => costEvents.push(event)
    });
    await drain(executor, request(0.5));
    assert.equal(fixture.calls(), 1, "the available catalog reference already exceeds this cap");
    const stopped = costEvents.find((event) => event.kind === "stopped");
    assert.ok(stopped?.kind === "stopped");
    assert.deepEqual(stopped.ledger, {
      turns: 1, turnsWithoutUsage: 1, tokensIn: 0, tokensOut: 1, spentUsd: fixture.catalogReferences[0]
    });
  });
}

for (const continuation of ["retry", "fallback"] as const) {
  test(`charged cache accumulates across ${continuation} without duplicate turn accounting`, async () => {
    const fixture = cachedProvider([
      { output: 1, cacheRead: 50, stopReason: "error" },
      { output: 1, cacheRead: 50 }
    ]);
    const costEvents: CostGateEvent[] = [];
    const executor = new PiAgentExecutor({
      providerId: fixture.model.provider, modelId: fixture.model.id, models: fixture.models,
      tools: [continueTool], onCostGate: (event) => costEvents.push(event),
      retry: { maxAttempts: continuation === "retry" ? 2 : 1, sleep: async () => undefined },
      ...(continuation === "fallback" ? { fallbackModels: [{ providerId: fixture.model.provider, modelId: "fallback" }] } : {})
    });
    await drain(executor, request(200));
    assert.equal(fixture.calls(), 2, "two 101-dollar turns exceed the shared 200-dollar cap");
    const stopped = costEvents.find((event) => event.kind === "stopped");
    assert.ok(stopped?.kind === "stopped");
    assert.deepEqual(stopped.ledger, {
      turns: 2, turnsWithoutUsage: 0, tokensIn: 0, tokensOut: 2, spentUsd: 202
    });
  });
}

test("SDK cache retention and tier reference prices survive the internal cost observation", async () => {
  const fixture = cachedProvider([{ output: 1, cacheWrite: 100, cacheWrite1h: 50 }], {
    input: 1_000_000, output: 1_000_000, cacheRead: 2_000_000, cacheWrite: 3_000_000,
    tiers: [{ inputTokensAbove: 50, input: 2_000_000, output: 2_000_000, cacheRead: 4_000_000, cacheWrite: 6_000_000 }]
  });
  const costEvents: CostGateEvent[] = [];
  const executor = new PiAgentExecutor({
    providerId: fixture.model.provider, modelId: fixture.model.id, models: fixture.models,
    tools: [continueTool], onCostGate: (event) => costEvents.push(event)
  });
  await drain(executor, request(400));
  assert.equal(fixture.calls(), 1);
  const stopped = costEvents.find((event) => event.kind === "stopped");
  assert.ok(stopped?.kind === "stopped");
  assert.equal(stopped.ledger.spentUsd, 502, "50 short writes at 6 + 50 long writes at 4 + output 2");
});

test("the internal observation preserves an SDK-adjusted reference amount", async () => {
  const fixture = cachedProvider([{ output: 1, cacheRead: 100, afterPricing: (usage) => {
    // Mirrors a provider adapter applying its service-tier multiplier after
    // calculateCost; it must not be replaced by unadjusted model base rates.
    usage.cost.input *= 2;
    usage.cost.output *= 2;
    usage.cost.cacheRead *= 2;
    usage.cost.cacheWrite *= 2;
    usage.cost.total *= 2;
  } }]);
  const costEvents: CostGateEvent[] = [];
  const executor = new PiAgentExecutor({
    providerId: fixture.model.provider, modelId: fixture.model.id, models: fixture.models,
    tools: [continueTool], onCostGate: (event) => costEvents.push(event)
  });
  await drain(executor, request(300));
  assert.equal(fixture.calls(), 1);
  const stopped = costEvents.find((event) => event.kind === "stopped");
  assert.ok(stopped?.kind === "stopped");
  assert.equal(stopped.ledger.spentUsd, 402);
  assert.equal(stopped.ledger.turnsWithoutUsage, 1, "the raw/catalog adjustment remains incomplete coverage");
});

for (const understated of ["input", "cacheRead"] as const) {
  test(`understated raw ${understated} cannot reduce the catalog budget reference`, async () => {
    const fixture = cachedProvider([{
      input: understated === "input" ? 100 : 0,
      output: 1, cacheRead: understated === "cacheRead" ? 100 : 0,
      afterPricing: (usage) => {
        usage.cost[understated] = understated === "input" ? 0 : 1;
        usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
      }
    }]);
    const costEvents: CostGateEvent[] = [];
    const executor = new PiAgentExecutor({
      providerId: fixture.model.provider, modelId: fixture.model.id, models: fixture.models,
      tools: [continueTool], onCostGate: (event) => costEvents.push(event)
    });
    await drain(executor, request(50));
    assert.equal(fixture.calls(), 1, "a self-consistent raw cost cannot lower the known catalog reference");
    const stopped = costEvents.find((event) => event.kind === "stopped");
    assert.ok(stopped?.kind === "stopped");
    assert.equal(stopped.ledger.spentUsd, understated === "input" ? 101 : 201);
    assert.equal(stopped.ledger.turnsWithoutUsage, 1, "the raw/catalog discrepancy remains explicit");
  });
}

for (const invalid of ["cache-count", "negative-retention", "oversized-retention", "fractional-retention", "cache-rate"] as const) {
  test(`invalid ${invalid} cannot claim complete budget coverage`, async () => {
    const fixture = cachedProvider([{
      output: 1, cacheWrite: 100, afterPricing: (usage) => {
        if (invalid === "cache-count") usage.cacheWrite = Number.NaN;
        if (invalid === "negative-retention") usage.cacheWrite1h = -1;
        if (invalid === "oversized-retention") usage.cacheWrite1h = 101;
        if (invalid === "fractional-retention") usage.cacheWrite1h = 1.5;
      }
    }], {
      input: 1_000_000, output: 1_000_000, cacheRead: 2_000_000,
      cacheWrite: invalid === "cache-rate" ? Number.NaN : 3_000_000
    });
    const costEvents: CostGateEvent[] = [];
    const executor = new PiAgentExecutor({
      providerId: fixture.model.provider, modelId: fixture.model.id, models: fixture.models,
      tools: [continueTool], onCostGate: (event) => costEvents.push(event)
    });
    await drain(executor, request(0.5));
    assert.equal(fixture.calls(), 1);
    const stopped = costEvents.find((event) => event.kind === "stopped");
    assert.ok(stopped?.kind === "stopped");
    assert.equal(stopped.ledger.spentUsd, 1, "retain the independently priced output, without trusting the invalid cache dimension");
    assert.equal(stopped.ledger.turnsWithoutUsage, 1);
  });
}

for (const placeholder of ["missing", "zero"] as const) {
  test(`uncached ${placeholder} SDK cost preserves the legacy catalog fallback`, async () => {
    const fixture = cachedProvider([{ input: 100, output: 1, afterPricing: (usage) => {
      if (placeholder === "missing") delete (usage as Partial<Usage>).cost;
      else usage.cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
    } }]);
    const costEvents: CostGateEvent[] = [];
    const executor = new PiAgentExecutor({
      providerId: fixture.model.provider, modelId: fixture.model.id, models: fixture.models,
      tools: [continueTool], onCostGate: (event) => costEvents.push(event)
    });
    await drain(executor, request(50));
    assert.equal(fixture.calls(), 1);
    const stopped = costEvents.find((event) => event.kind === "stopped");
    assert.ok(stopped?.kind === "stopped");
    assert.equal(stopped.ledger.spentUsd, fixture.catalogReferences[0]);
    assert.equal(stopped.ledger.turnsWithoutUsage, 0);
  });
}

for (const longWrites of [50, 100]) {
  test(`zero short-write price with ${longWrites} long cache writes preserves pricing coverage`, async () => {
    const fixture = cachedProvider([{ output: 1, cacheWrite: 100, cacheWrite1h: longWrites }], {
      input: 1_000_000, output: 1_000_000, cacheRead: 2_000_000, cacheWrite: 0
    });
    const costEvents: CostGateEvent[] = [];
    const executor = new PiAgentExecutor({
      providerId: fixture.model.provider, modelId: fixture.model.id, models: fixture.models,
      tools: [continueTool], onCostGate: (event) => costEvents.push(event)
    });
    await drain(executor, request(50));
    assert.equal(fixture.calls(), 1);
    const stopped = costEvents.find((event) => event.kind === "stopped");
    assert.ok(stopped?.kind === "stopped");
    assert.equal(stopped.ledger.spentUsd, fixture.catalogReferences[0], "coverage does not alter the calculated reference");
    assert.equal(stopped.ledger.turnsWithoutUsage, longWrites < 100 ? 1 : 0,
      "mixed writes need a usable short-write price; an all-long write only uses the known long-write rate");
  });
}
