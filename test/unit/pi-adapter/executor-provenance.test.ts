import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type FauxResponseStep
} from "@earendil-works/pi-ai";
import { PiAgentExecutor } from "../../../src/pi-adapter/pi-executor.js";
import type { AgentExecutionRequest, ExecutionEvent } from "../../../src/execution/contract.js";
import type { ModelInvocation } from "../../../src/telemetry/model-invocation.js";

/**
 * F6 decision package §2.2/§2.9 (2026-09-04): every invocation must carry a
 * programmatic provenance class (so a holdout audit can prove no fake/loopback
 * row ever masquerades as production) and a cache observation (so provider-side
 * prompt caching contaminating a paired block is detectable). These tests pin
 * both at the executor boundary, through `execute()`.
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

function harness(responses: FauxResponseStep[]): {
  readonly executor: PiAgentExecutor;
  readonly invocations: ModelInvocation[];
} {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses(responses);
  const invocations: ModelInvocation[] = [];
  const executor = new PiAgentExecutor({
    providerId: "faux",
    modelId: "faux-1",
    models,
    onInvocation: (invocation) => invocations.push(invocation)
  });
  return { executor, invocations };
}

async function drain(executor: PiAgentExecutor): Promise<ExecutionEvent[]> {
  const events: ExecutionEvent[] = [];
  for await (const event of executor.execute(request(), new AbortController().signal)) {
    events.push(event);
  }
  return events;
}

describe("invocation provenance and cache observation (F6)", () => {
  it("stamps the faux executor class on every invocation", async () => {
    const { executor, invocations } = harness([fauxAssistantMessage("OK")]);
    await drain(executor);
    assert.equal(invocations.length, 1);
    assert.equal(invocations[0]?.executorClass, "faux");
  });

  // cacheHit=true / undefined are covered through the real HTTP transport in
  // test/integration/pi-adapter/cache-provenance.test.ts — the faux provider
  // recomputes usage from content, so a scripted cacheRead cannot reach the
  // executor through it.

  it("records cacheHit=false when usage is reported with zero cache", async () => {
    const message = fauxAssistantMessage("OK");
    message.usage = {
      ...message.usage,
      input: 42,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 44
    };
    const { executor, invocations } = harness([message]);
    await drain(executor);
    assert.equal(invocations.length, 1);
    assert.equal(invocations[0]?.cacheHit, false);
  });

});
