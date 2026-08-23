import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PiAgentExecutor } from "../../../src/pi-adapter/pi-executor.js";
import type { AgentExecutionRequest } from "../../../src/execution/contract.js";

/**
 * Regression (2026-08-22 provider smoke): model ids may contain slashes
 * themselves (openrouter "stealth/ox-alpha"). The executor's own providerId
 * is authoritative; the raw string must stay the model id instead of being
 * split into provider="stealth", model="ox-alpha".
 */

function baseRequest(): AgentExecutionRequest {
  return {
    runId: "run_1",
    taskId: "tsk_1",
    agentInstanceId: "agt_1",
    objective: "Reply with exactly: OK",
    prompt: "Reply with exactly: OK"
  } as unknown as AgentExecutionRequest;
}

function recordingModels(): { models: unknown; calls: Array<{ provider: string; model: string }> } {
  const calls: Array<{ provider: string; model: string }> = [];
  const models = {
    getModel(provider: string, model: string): undefined {
      calls.push({ provider, model });
      return undefined;
    }
  };
  return { models, calls };
}

async function collectOutcome(
  executor: PiAgentExecutor,
  request: AgentExecutionRequest = baseRequest()
): Promise<string> {
  let outcome = "none";
  for await (const event of executor.execute(request, new AbortController().signal)) {
    if (event.type === "EXECUTION_FINISHED") outcome = event.outcome;
  }
  return outcome;
}

describe("model identity resolution with slashed model ids", () => {
  it("keeps a slashed model id whole when the executor pins its provider", async () => {
    const { models, calls } = recordingModels();
    const executor = new PiAgentExecutor({
      providerId: "openrouter-ox",
      modelId: "stealth/ox-alpha",
      models: models as never
    });
    await collectOutcome(executor);
    // Before the fix this resolved as provider "stealth", model "ox-alpha".
    assert.deepEqual(calls, [{ provider: "openrouter-ox", model: "stealth/ox-alpha" }]);
  });

  it("a request-level provider override may reinterpret the model string", async () => {
    const { models, calls } = recordingModels();
    const executor = new PiAgentExecutor({
      providerId: "unused-default",
      modelId: "fallback-model",
      models: models as never
    });
    const request = {
      ...baseRequest(),
      modelId: "some/model",
      providerId: "explicit-provider"
    } as unknown as AgentExecutionRequest;
    let outcome = "none";
    for await (const event of executor.execute(request, new AbortController().signal)) {
      if (event.type === "EXECUTION_FINISHED") outcome = event.outcome;
    }
    void outcome;
    assert.deepEqual(calls, [{ provider: "explicit-provider", model: "some/model" }]);
  });

  it("a matching catalog ref still splits when the prefix equals the provider", async () => {
    const { models, calls } = recordingModels();
    const executor = new PiAgentExecutor({
      providerId: "openai",
      modelId: "gpt-mini",
      models: models as never
    });
    const request = {
      ...baseRequest(),
      modelId: "openai/gpt-mini"
    } as unknown as AgentExecutionRequest;
    await collectOutcome(executor, request);
    assert.deepEqual(calls, [{ provider: "openai", model: "gpt-mini" }]);
  });
});
