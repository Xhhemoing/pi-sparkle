import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider
} from "@earendil-works/pi-ai";
import { PiAgentExecutor } from "../../../src/pi-adapter/pi-executor.js";
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
