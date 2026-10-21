import assert from "node:assert/strict";
import { test } from "node:test";
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { createConfiguredPiExecutor } from "../../../src/pi-adapter/runtime.js";
import type { AgentExecutionRequest, ExecutionEvent } from "../../../src/execution/contract.js";
import type { ModelInvocation } from "../../../src/telemetry/model-invocation.js";

test("configured factory forwards fallback models into actual provider dispatch", async () => {
  const faux = fauxProvider({ models: [{ id: "primary" }, { id: "fallback" }] });
  const models = createModels();
  models.setProvider(faux.provider);
  const invocations: ModelInvocation[] = [];
  const options = {
    stateRoot: "/unused-state", providerId: "faux", modelId: "primary", customProviders: [],
    fallbackModels: [{ providerId: "faux", modelId: "fallback" }],
    retry: { maxAttempts: 1 }, onInvocation: (invocation: ModelInvocation) => invocations.push(invocation)
  };
  const executor = await createConfiguredPiExecutor(options, async () => ({ models }));
  faux.setResponses([() => { throw new Error("502: primary unavailable"); }, fauxAssistantMessage("fallback response")]);
  const request = { runId: "run_test", taskId: "tsk_test", agentInstanceId: "agt_test", prompt: "test", workingDirectory: "/tmp" } as AgentExecutionRequest;
  const events: ExecutionEvent[] = [];
  for await (const event of executor.execute(request, new AbortController().signal)) events.push(event);
  assert.equal(faux.state.callCount, 2);
  assert.deepEqual(invocations.map((invocation) => [invocation.config.model, invocation.callOutcome]), [["primary", "error"], ["fallback", "ok"]]);
  assert.deepEqual(events.at(-1), { type: "EXECUTION_FINISHED", outcome: "SUCCESS" });
});
