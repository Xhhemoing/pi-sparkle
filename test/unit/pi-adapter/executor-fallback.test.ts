import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  Type
} from "@earendil-works/pi-ai";
import { PiAgentExecutor, REPORT_TASK_RESULT_TOOL, type CostGateEvent } from "../../../src/pi-adapter/pi-executor.js";
import type { AgentExecutionRequest, ExecutionEvent } from "../../../src/execution/contract.js";
import type { ModelInvocation } from "../../../src/telemetry/model-invocation.js";

/**
 * 2026-10-06 model fallback: when the primary executor model fails after the
 * retry cap, the executor must try a fallback model chain rather than fail the
 * whole run. This also covers `--executor-model` routing the executor to a
 * model distinct from the track router's primary.
 */

function request(): AgentExecutionRequest {
  return {
    runId: "run_1",
    taskId: "tsk_1",
    agentInstanceId: "agt_1",
    prompt: "Reply with exactly: OK",
    workingDirectory: "/tmp/project"
  } as unknown as AgentExecutionRequest;
}

function providerError(status: number, body: string): () => never {
  return () => {
    throw new Error(`${status}: ${body}`);
  };
}

async function drain(
  executor: PiAgentExecutor,
  signal: AbortSignal = new AbortController().signal
): Promise<ExecutionEvent[]> {
  const events: ExecutionEvent[] = [];
  for await (const event of executor.execute(request(), signal)) {
    events.push(event);
  }
  return events;
}

function outcomeOf(events: readonly ExecutionEvent[]): string {
  const finished = events.find((event) => event.type === "EXECUTION_FINISHED");
  return finished?.type === "EXECUTION_FINISHED" ? finished.outcome : "none";
}

describe("PiAgentExecutor model fallback", () => {
  it("falls back to the secondary model when the primary fails after the retry cap", async () => {
    const faux = fauxProvider({ models: [{ id: "faux-1" }, { id: "faux-2" }] });
    const models = createModels();
    models.setProvider(faux.provider);
    const invocations: ModelInvocation[] = [];

    const executor = new PiAgentExecutor({
      providerId: "faux",
      modelId: "faux-1",
      models,
      fallbackModels: [{ providerId: "faux", modelId: "faux-2" }],
      retry: { maxAttempts: 1, baseDelayMs: 1, jitterRatio: 0, random: () => 0, sleep: async () => {} },
      onInvocation: (invocation) => invocations.push(invocation)
    });

    // Script the primary model's response to fail, then append the fallback
    // response. The faux provider serves responses in order regardless of
    // which model calls it, so the same faux model carries both steps.
    faux.setResponses([
      providerError(502, '{"error":{"code":"upstream_error"}}'),
      fauxAssistantMessage("fallback response")
    ]);

    const events = await drain(executor);
    assert.equal(outcomeOf(events), "SUCCESS");
    assert.equal(faux.state.callCount, 2);
    assert.equal(invocations.length, 2, "one invocation record per attempted model");
    const primaryRecord = invocations[0];
    const fallbackRecord = invocations[1];
    assert.ok(primaryRecord !== undefined);
    assert.ok(fallbackRecord !== undefined);
    assert.equal(primaryRecord.config.model, "faux-1");
    assert.equal(primaryRecord.callOutcome, "error");
    assert.equal(fallbackRecord.config.model, "faux-2");
    assert.equal(fallbackRecord.callOutcome, "ok");
    const terminal = events.find((event) => event.type === "MESSAGE" && event.message.type === "TASK_RESULT");
    assert.ok(terminal?.type === "MESSAGE" && terminal.message.type === "TASK_RESULT");
    assert.equal(terminal.message.failure, undefined, "a recovered execution must not inherit its primary error");
    assert.equal(terminal.message.summary, "pi agent finished");
  });

  for (const error of ["401: invalid key", "403: forbidden", "400: invalid request", '429: {"remedy_hint":"do not retry"}']) {
    it(`does not fall back after a non-retryable error: ${error}`, async () => {
      const faux = fauxProvider({ models: [{ id: "faux-1" }, { id: "faux-2" }] });
      const models = createModels();
      models.setProvider(faux.provider);
      const executor = new PiAgentExecutor({
        providerId: "faux", modelId: "faux-1", models,
        fallbackModels: [{ providerId: "faux", modelId: "faux-2" }],
        retry: { maxAttempts: 1 }
      });
      faux.setResponses([() => { throw new Error(error); }, fauxAssistantMessage("must not run")]);
      const events = await drain(executor);
      assert.equal(faux.state.callCount, 1);
      assert.equal(outcomeOf(events), "FAILURE");
    });
  }

  it("emits one execution terminal after its task result when every model fails", async () => {
    const faux = fauxProvider({ models: [{ id: "faux-1" }, { id: "faux-2" }] });
    const models = createModels();
    models.setProvider(faux.provider);
    const executor = new PiAgentExecutor({
      providerId: "faux", modelId: "faux-1", models,
      fallbackModels: [{ providerId: "faux", modelId: "faux-2" }],
      retry: { maxAttempts: 1 }
    });
    faux.setResponses([providerError(502, "primary"), providerError(503, "fallback")]);
    const events = await drain(executor);
    assert.equal(faux.state.callCount, 2);
    assert.equal(events.filter((event) => event.type === "EXECUTION_FINISHED").length, 1);
    assert.equal(events.at(-1)?.type, "EXECUTION_FINISHED");
    const terminal = events.find((event) => event.type === "MESSAGE" && event.message.type === "TASK_RESULT");
    assert.ok(terminal?.type === "MESSAGE" && terminal.message.type === "TASK_RESULT");
    assert.match(terminal.message.failure?.detail ?? "", /503: fallback/);
  });

  for (const verification of ["PASSED", "FAILED"] as const) {
    it(`suppresses the final failed model's ${verification} report`, async () => {
      const faux = fauxProvider({ models: [{ id: "faux-1" }, { id: "faux-2" }] });
      const models = createModels();
      models.setProvider(faux.provider);
      const executor = new PiAgentExecutor({
        providerId: "faux", modelId: "faux-1", models,
        fallbackModels: [{ providerId: "faux", modelId: "faux-2" }],
        retry: { maxAttempts: 1 }
      });
      faux.setResponses([
        providerError(502, "primary"),
        fauxAssistantMessage(fauxToolCall(REPORT_TASK_RESULT_TOOL, {
          verification, summary: "unreliable final report", evidenceIds: ["evd_final"]
        })),
        providerError(503, "final model failed after reporting")
      ]);
      const events = await drain(executor);
      const terminals = events.flatMap((event) =>
        event.type === "MESSAGE" && event.message.type === "TASK_RESULT" ? [event.message] : []);
      assert.equal(terminals.length, 1);
      assert.equal(terminals[0]?.outcome, "FAILURE");
      assert.deepEqual(terminals[0]?.verification, { kind: "UNOBSERVED", evidenceIds: [] });
      assert.equal(terminals[0]?.failure?.category, "PROVIDER_ERROR");
    });
  }

  it("carries priced primary spend into the fallback ceiling at the fallback's own price", async () => {
    const faux = fauxProvider({ models: [
      { id: "faux-1", cost: { input: 0, output: 100_000, cacheRead: 0, cacheWrite: 0 } },
      { id: "faux-2", cost: { input: 0, output: 300_000, cacheRead: 0, cacheWrite: 0 } }
    ] });
    const models = createModels();
    models.setProvider(faux.provider);
    const costEvents: CostGateEvent[] = [];
    const executor = new PiAgentExecutor({
      providerId: "faux", modelId: "faux-1", models,
      fallbackModels: [{ providerId: "faux", modelId: "faux-2" }],
      retry: { maxAttempts: 1 }, maxCostUsd: 1,
      onCostGate: (event) => costEvents.push(event),
      tools: [{
        name: "noop", label: "noop", description: "No-op test tool", parameters: Type.Object({}),
        execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} })
      }]
    });
    faux.setResponses([
      fauxAssistantMessage("abcdefghijklmnopqrst", { stopReason: "error", errorMessage: "502: partial billed response" }),
      fauxAssistantMessage(fauxToolCall("noop", {})),
      fauxAssistantMessage("must not call again")
    ]);
    await drain(executor);
    assert.equal(faux.state.callCount, 2, "$0.50 primary + $0.60 fallback exhaust the same $1 execution cap");
    const stopped = costEvents.filter((event) => event.kind === "stopped");
    assert.equal(stopped.length, 1);
    assert.equal(stopped[0]?.maxCostUsd, 1);
    assert.equal(stopped[0]?.ledger.spentUsd, 1.1);
    assert.equal(stopped[0]?.ledger.turns, 2);
    assert.equal(stopped[0]?.ledger.tokensOut, 7);
  });

  it("discards a failed primary's buffered verdict before a silent fallback succeeds", async () => {
    const faux = fauxProvider({ models: [{ id: "faux-1" }, { id: "faux-2" }] });
    const models = createModels();
    models.setProvider(faux.provider);
    const executor = new PiAgentExecutor({
      providerId: "faux", modelId: "faux-1", models,
      fallbackModels: [{ providerId: "faux", modelId: "faux-2" }],
      retry: { maxAttempts: 1 }
    });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall(REPORT_TASK_RESULT_TOOL, {
        verification: "PASSED", summary: "superseded primary", evidenceIds: ["evd_primary"]
      })),
      providerError(502, "failed after reporting"),
      fauxAssistantMessage("fallback response without a verdict")
    ]);
    const events = await drain(executor);
    const terminals = events.flatMap((event) =>
      event.type === "MESSAGE" && event.message.type === "TASK_RESULT" ? [event.message] : []);
    assert.equal(faux.state.callCount, 3);
    assert.equal(terminals.length, 1, "a discarded primary must never cause duplicate TASK_RESULTs");
    assert.deepEqual(terminals[0]?.verification, { kind: "UNOBSERVED", evidenceIds: [] });
  });

  it("stops before fallback when the failed primary has already exhausted the ceiling", async () => {
    const faux = fauxProvider({ models: [
      { id: "faux-1", cost: { input: 0, output: 100_000, cacheRead: 0, cacheWrite: 0 } },
      { id: "faux-2" }
    ] });
    const models = createModels();
    models.setProvider(faux.provider);
    const costEvents: CostGateEvent[] = [];
    const executor = new PiAgentExecutor({
      providerId: "faux", modelId: "faux-1", models,
      fallbackModels: [{ providerId: "faux", modelId: "faux-2" }],
      retry: { maxAttempts: 1 }, maxCostUsd: 0.1,
      onCostGate: (event) => costEvents.push(event)
    });
    faux.setResponses([
      fauxAssistantMessage("billed", { stopReason: "error", errorMessage: "502: failed" }),
      fauxAssistantMessage("must not run")
    ]);
    assert.equal(outcomeOf(await drain(executor)), "FAILURE");
    assert.equal(faux.state.callCount, 1);
    assert.equal(costEvents.filter((event) => event.kind === "stopped").length, 1);
  });

  it("keeps cancellation terminal when it arrives between model attempts", async () => {
    const faux = fauxProvider({ models: [{ id: "faux-1" }, { id: "faux-2" }] });
    const models = createModels();
    models.setProvider(faux.provider);
    const controller = new AbortController();
    const executor = new PiAgentExecutor({
      providerId: "faux", modelId: "faux-1", models,
      fallbackModels: [{ providerId: "faux", modelId: "faux-2" }],
      retry: { maxAttempts: 1 },
      onInvocation: () => controller.abort()
    });
    faux.setResponses([providerError(502, "primary"), fauxAssistantMessage("must not run")]);
    const events = await drain(executor, controller.signal);
    assert.equal(faux.state.callCount, 1);
    assert.equal(outcomeOf(events), "CANCELLED");
    const terminal = events.find((event) => event.type === "MESSAGE" && event.message.type === "TASK_RESULT");
    assert.ok(terminal?.type === "MESSAGE" && terminal.message.type === "TASK_RESULT");
    assert.equal(terminal.message.failure, undefined);
  });

  it("drops a failed attempt's reported verdict when cancellation interrupts retry backoff", async () => {
    const faux = fauxProvider({ models: [{ id: "faux-1" }, { id: "faux-2" }] });
    const models = createModels();
    models.setProvider(faux.provider);
    const controller = new AbortController();
    const executor = new PiAgentExecutor({
      providerId: "faux", modelId: "faux-1", models,
      fallbackModels: [{ providerId: "faux", modelId: "faux-2" }],
      retry: { maxAttempts: 2, sleep: async () => controller.abort() }
    });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall(REPORT_TASK_RESULT_TOOL, {
        verification: "PASSED", summary: "discarded attempt", evidenceIds: ["evd_primary"]
      })),
      providerError(502, "after report"),
      fauxAssistantMessage("must not run")
    ]);
    const events = await drain(executor, controller.signal);
    assert.equal(faux.state.callCount, 2);
    const terminal = events.find((event) => event.type === "MESSAGE" && event.message.type === "TASK_RESULT");
    assert.ok(terminal?.type === "MESSAGE" && terminal.message.type === "TASK_RESULT");
    assert.equal(terminal.message.outcome, "CANCELLED");
    assert.deepEqual(terminal.message.verification, { kind: "UNOBSERVED", evidenceIds: [] });
    assert.equal(outcomeOf(events), "CANCELLED");
  });

  it("commits one terminal result when cancellation arrives while its buffered verdict is published", async () => {
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    const executor = new PiAgentExecutor({ providerId: "faux", modelId: "faux-1", models });
    const controller = new AbortController();
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall(REPORT_TASK_RESULT_TOOL, {
        verification: "PASSED", summary: "complete", evidenceIds: ["evd_result"]
      })),
      fauxAssistantMessage("done")
    ]);
    const events: ExecutionEvent[] = [];
    for await (const event of executor.execute(request(), controller.signal)) {
      events.push(event);
      if (event.type === "MESSAGE" && event.message.type === "TASK_RESULT") controller.abort();
    }
    const terminals = events.flatMap((event) =>
      event.type === "MESSAGE" && event.message.type === "TASK_RESULT" ? [event.message] : []);
    assert.equal(terminals.length, 1, "late cancellation cannot retract an already-published task verdict");
    assert.equal(terminals[0]?.outcome, "SUCCESS");
    assert.equal(outcomeOf(events), "SUCCESS", "the completed execution was committed before publication");
  });

  it("stops at an exact decimal ceiling across two differently priced models", async () => {
    const faux = fauxProvider({ models: [
      { id: "faux-1", cost: { input: 0, output: 100_000, cacheRead: 0, cacheWrite: 0 } },
      { id: "faux-2", cost: { input: 0, output: 350_000, cacheRead: 0, cacheWrite: 0 } }
    ] });
    const models = createModels();
    models.setProvider(faux.provider);
    const costEvents: CostGateEvent[] = [];
    const executor = new PiAgentExecutor({
      providerId: "faux", modelId: "faux-1", models,
      fallbackModels: [{ providerId: "faux", modelId: "faux-2" }],
      retry: { maxAttempts: 1 }, maxCostUsd: 0.8,
      onCostGate: (event) => costEvents.push(event),
      tools: [{
        name: "noop", label: "noop", description: "No-op test tool", parameters: Type.Object({}),
        execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} })
      }]
    });
    faux.setResponses([
      fauxAssistantMessage("abcd", { stopReason: "error", errorMessage: "502: paid" }),
      fauxAssistantMessage(fauxToolCall("noop", {})),
      fauxAssistantMessage("unexpected extra")
    ]);
    await drain(executor);
    assert.equal(faux.state.callCount, 2, "$0.10 + $0.70 exactly exhaust the $0.80 ceiling");
    const stopped = costEvents.find((event) => event.kind === "stopped");
    assert.equal(stopped?.ledger.spentUsd, 0.8);
  });

  it("skips unresolved fallback entries without preventing a later usable model", async () => {
    const faux = fauxProvider({ models: [{ id: "faux-1" }, { id: "faux-2" }] });
    const models = createModels();
    models.setProvider(faux.provider);
    const executor = new PiAgentExecutor({
      providerId: "faux", modelId: "faux-1", models,
      fallbackModels: [{ providerId: "faux", modelId: "absent" }, { providerId: "faux", modelId: "faux-2" }],
      retry: { maxAttempts: 1 }
    });
    faux.setResponses([providerError(502, "primary"), fauxAssistantMessage("fallback response")]);
    assert.equal(outcomeOf(await drain(executor)), "SUCCESS");
    assert.equal(faux.state.callCount, 2);
  });

  it("discloses unpriced fallback without inventing spent dollars", async () => {
    const faux = fauxProvider({ models: [{ id: "faux-1" }, { id: "faux-2" }] });
    const models = createModels();
    models.setProvider(faux.provider);
    const costEvents: CostGateEvent[] = [];
    const executor = new PiAgentExecutor({
      providerId: "faux", modelId: "faux-1", models,
      fallbackModels: [{ providerId: "faux", modelId: "faux-2" }],
      retry: { maxAttempts: 1 }, maxCostUsd: 0.01,
      onCostGate: (event) => costEvents.push(event)
    });
    faux.setResponses([providerError(502, "primary"), fauxAssistantMessage("fallback response")]);
    assert.equal(outcomeOf(await drain(executor)), "SUCCESS");
    assert.deepEqual(costEvents.map((event) => event.kind), ["disarmed", "disarmed"]);
    assert.ok(costEvents.every((event) => event.kind === "disarmed" && event.reason === "unpriced-model"));
  });

  it("does not invoke the fallback when the primary succeeds on its own", async () => {
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);

    const executor = new PiAgentExecutor({
      providerId: "faux",
      modelId: "faux-1",
      models,
      retry: { maxAttempts: 3, baseDelayMs: 1, jitterRatio: 0, random: () => 0, sleep: async () => {} }
    });

    faux.setResponses([fauxAssistantMessage("primary response")]);

    const events = await drain(executor);
    assert.equal(outcomeOf(events), "SUCCESS");
    assert.equal(faux.state.callCount, 1);
  });
});
