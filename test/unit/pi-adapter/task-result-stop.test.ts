import assert from "node:assert/strict";
import { test } from "node:test";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall, Type, type FauxResponseStep } from "@earendil-works/pi-ai";
import { PiAgentExecutor, REPORT_TASK_RESULT_TOOL, type PiExecutorOptions, type CostGateEvent } from "../../../src/pi-adapter/pi-executor.js";
import { createConfiguredPiExecutor } from "../../../src/pi-adapter/runtime.js";
import type { AgentExecutionRequest, ExecutionEvent } from "../../../src/execution/contract.js";
import type { ModelInvocation } from "../../../src/telemetry/model-invocation.js";

const request = {
  runId: "run_stop", taskId: "tsk_stop", agentInstanceId: "agt_stop",
  prompt: "Inspect and report the result", workingDirectory: "/tmp/project"
} as AgentExecutionRequest;
const report = () => fauxToolCall(REPORT_TASK_RESULT_TOOL, { verification: "PASSED", summary: "checked" });

function fixture(responses: FauxResponseStep[], extra: Partial<PiExecutorOptions> = {}) {
  const faux = fauxProvider({ models: [{ id: "faux-1", cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }] });
  faux.setResponses(responses);
  const models = createModels();
  models.setProvider(faux.provider);
  const invocations: ModelInvocation[] = [];
  const options = { providerId: "faux", modelId: "faux-1", models,
    retry: { maxAttempts: 1 }, onInvocation: (value: ModelInvocation) => invocations.push(value), ...extra };
  return { faux, models, invocations, executor: new PiAgentExecutor(options) };
}
async function drain(executor: PiAgentExecutor, signal = new AbortController().signal) {
  const events: ExecutionEvent[] = [];
  for await (const event of executor.execute(request, signal)) events.push(event);
  return events;
}
function results(events: ExecutionEvent[]) {
  return events.flatMap((event) => event.type === "MESSAGE" && event.message.type === "TASK_RESULT" ? [event.message] : []);
}

test("opt-in completes the report turn without a trailing provider request and retains usage", async () => {
  const f = fixture([fauxAssistantMessage(report()), fauxAssistantMessage("redundant done")], { stopAfterTaskResult: true });
  const events = await drain(f.executor);
  assert.equal(f.faux.state.callCount, 1);
  assert.equal(results(events).length, 1);
  assert.equal(results(events)[0]?.summary, "checked");
  assert.equal(events.filter((e) => e.type === "EXECUTION_FINISHED").length, 1);
  assert.deepEqual(events.at(-1), { type: "EXECUTION_FINISHED", outcome: "SUCCESS" });
  assert.equal(events.some((e) => e.type === "TOOL_FINISHED" && !e.isError), true);
  const turns = events.filter((e) => e.type === "TURN_FINISHED");
  assert.equal(turns.length, 1);
  assert.ok((turns[0]?.usage?.inputTokens ?? 0) > 0);
  assert.ok((turns[0]?.usage?.outputTokens ?? 0) > 0);
  assert.equal(f.invocations[0]?.tokensIn, turns[0]?.usage?.inputTokens);
  assert.equal(f.invocations[0]?.tokensOut, turns[0]?.usage?.outputTokens);
  assert.equal(f.invocations[0]?.callOutcome, "ok");
  assert.throws(() => f.executor.steerText("late", request.agentInstanceId), /no agent run/);
});

test("a rejected report does not trigger the opt-in stop", async () => {
  const f = fixture([
    fauxAssistantMessage(fauxToolCall(REPORT_TASK_RESULT_TOOL, { verification: "FAILED", summary: "missing evidence" })),
    fauxAssistantMessage(report()), fauxAssistantMessage("redundant")
  ], { stopAfterTaskResult: true });
  const events = await drain(f.executor);
  assert.equal(f.faux.state.callCount, 2);
  assert.equal(events.some((e) => e.type === "TOOL_FINISHED" && e.isError), true);
  assert.equal(results(events)[0]?.summary, "checked");
});

for (const enabled of [undefined, false]) {
  test(`completion option ${String(enabled)} preserves report followed by provider failure`, async () => {
    const f = fixture([fauxAssistantMessage(report()), () => { throw new Error("401: rejected"); }],
      enabled === undefined ? {} : { stopAfterTaskResult: enabled });
    const events = await drain(f.executor);
    assert.equal(f.faux.state.callCount, 2);
    assert.equal(results(events)[0]?.verification?.kind, "UNOBSERVED");
    assert.deepEqual(events.at(-1), { type: "EXECUTION_FINISHED", outcome: "FAILURE" });
  });
}

test("cancellation from a tool in the report turn suppresses the buffered verdict", async () => {
  const controller = new AbortController();
  const f = fixture([fauxAssistantMessage([report(), fauxToolCall("cancel", {})]), fauxAssistantMessage("unused")], {
    stopAfterTaskResult: true,
    tools: [{ name: "cancel", label: "cancel", description: "Cancel test execution", parameters: Type.Object({}),
      execute: async () => { controller.abort(); return { content: [{ type: "text", text: "cancelled" }], details: {} }; } }]
  });
  const events = await drain(f.executor, controller.signal);
  assert.equal(f.faux.state.callCount, 1);
  assert.equal(results(events).length, 1);
  assert.equal(results(events)[0]?.verification?.kind, "UNOBSERVED");
  assert.deepEqual(events.at(-1), { type: "EXECUTION_FINISHED", outcome: "CANCELLED" });
  assert.throws(() => f.executor.steerText("late", request.agentInstanceId), /no agent run/);
});

test("report completion retains the cost ceiling observation and complete turn ledger", async () => {
  const observed: CostGateEvent[] = [];
  const f = fixture([fauxAssistantMessage(report()), fauxAssistantMessage("unused")], {
    stopAfterTaskResult: true, maxCostUsd: 0.000001, onCostGate: (event) => observed.push(event)
  });
  const events = await drain(f.executor);
  assert.equal(f.faux.state.callCount, 1);
  const stopped = observed.filter((e) => e.kind === "stopped");
  assert.equal(stopped.length, 1);
  assert.equal(stopped[0]?.ledger.turns, 1);
  assert.ok((stopped[0]?.ledger.tokensOut ?? 0) > 0);
  assert.equal(results(events)[0]?.summary, "checked");
});

test("configured executor passes the opt-in completion policy to the running Agent", async () => {
  const f = fixture([fauxAssistantMessage(report()), fauxAssistantMessage("redundant")]);
  const executor = await createConfiguredPiExecutor({
    stateRoot: "/unused", providerId: "faux", modelId: "faux-1", customProviders: [], stopAfterTaskResult: true
  }, async () => ({ models: f.models }));
  await drain(executor);
  assert.equal(f.faux.state.callCount, 1);
});

for (const position of ["before", "after"] as const) {
  test(`opt-in preserves steering injected ${position} the report in the same turn`, async () => {
    let executor: PiAgentExecutor;
    let received = "";
    const inject = fauxToolCall("inject_steer", {});
    const f = fixture([
      fauxAssistantMessage(position === "before" ? [inject, report()] : [report(), inject]),
      (context) => { received = JSON.stringify(context.messages); return fauxAssistantMessage("addressed steering"); }
    ], {
      stopAfterTaskResult: true,
      tools: [{ name: "inject_steer", label: "Inject steer", description: "Deliver a user correction", parameters: Type.Object({}),
        execute: async () => {
          executor.steerText("Check the corrected boundary", request.agentInstanceId);
          return { content: [{ type: "text", text: "accepted" }], details: {} };
        } }]
    });
    executor = f.executor;
    const events = await drain(executor);
    assert.equal(f.faux.state.callCount, 2);
    assert.match(received, /Check the corrected boundary/);
    assert.equal(results(events).length, 1);
    assert.deepEqual(events.at(-1), { type: "EXECUTION_FINISHED", outcome: "SUCCESS" });
  });
}

test("opt-in preserves accepted steering replayed after a failed attempt reports on its retry", async () => {
  let executor: PiAgentExecutor;
  let received = "";
  const f = fixture([
    fauxAssistantMessage(fauxToolCall("inject_steer", {})),
    () => { throw new Error("429: rate limited"); },
    fauxAssistantMessage(report()),
    (context) => { received = JSON.stringify(context.messages); return fauxAssistantMessage("addressed replay"); }
  ], {
    stopAfterTaskResult: true,
    retry: { maxAttempts: 2, baseDelayMs: 1, jitterRatio: 0, sleep: async () => {} },
    tools: [{ name: "inject_steer", label: "Inject steer", description: "Deliver a user correction", parameters: Type.Object({}),
      execute: async () => {
        executor.steerText("Carry correction through retry", request.agentInstanceId);
        return { content: [{ type: "text", text: "accepted" }], details: {} };
      } }]
  });
  executor = f.executor;
  const events = await drain(executor);
  assert.equal(f.faux.state.callCount, 4);
  assert.match(received, /Carry correction through retry/);
  assert.equal((received.match(/Carry correction through retry/g) ?? []).length, 1);
  assert.equal(results(events).length, 1);
  assert.deepEqual(events.at(-1), { type: "EXECUTION_FINISHED", outcome: "SUCCESS" });
});
