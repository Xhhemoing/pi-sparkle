import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createConfiguredPiExecutor } from "../../../src/pi-adapter/runtime.js";
import type { AgentExecutionRequest, ExecutionEvent } from "../../../src/execution/contract.js";
import type { ModelInvocation } from "../../../src/telemetry/model-invocation.js";
import {
  startLoopbackOpenAiProvider,
  type LoopbackOpenAiProvider
} from "../../helpers/loopback-openai-provider.js";

/**
 * F6 §2.2 cache-contamination detection, proven through the real HTTP
 * transport (not a mocked usage block): an OpenAI-style
 * `prompt_tokens_details.cached_tokens` payload must surface as
 * `cacheHit: true` on the persisted invocation, and provider silence on
 * usage must leave cacheHit undefined — never guessed.
 */

const PROVIDER_ID = "cacheloop";
const MODEL_ID = "cacheloop-1";

function request(): AgentExecutionRequest {
  return {
    runId: "run_1",
    taskId: "tsk_1",
    agentInstanceId: "agt_1",
    prompt: "Reply with exactly: OK",
    workingDirectory: "/tmp/project"
  } as unknown as AgentExecutionRequest;
}

async function runOnce(
  provider: LoopbackOpenAiProvider
): Promise<ModelInvocation> {
  // createConfiguredPiExecutor builds the Models registry from the custom
  // provider list; constructing PiAgentExecutor directly would skip that.
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-cache-prov-"));
  try {
    const invocations: ModelInvocation[] = [];
    const executor = await createConfiguredPiExecutor({
      stateRoot,
      providerId: PROVIDER_ID,
      modelId: MODEL_ID,
      apiKey: "cacheloop-test-key",
      customProviders: [
        {
          id: PROVIDER_ID,
          baseUrl: provider.baseUrl,
          models: [{ id: MODEL_ID, name: "Cache Loop", contextWindow: 8_192, maxTokens: 256 }]
        }
      ],
      onInvocation: (invocation) => invocations.push(invocation)
    });
    const events: ExecutionEvent[] = [];
    for await (const event of executor.execute(request(), new AbortController().signal)) {
      events.push(event);
    }
    assert.equal(invocations.length, 1, "exactly one invocation per attempt");
    return invocations[0]!;
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
}

test("a cached_tokens payload over real HTTP records cacheHit=true", async () => {
  const provider = await startLoopbackOpenAiProvider({
    modelIds: [MODEL_ID],
    promptTokens: 100,
    completionTokens: 5,
    cachedTokens: 80
  });
  try {
    const invocation = await runOnce(provider);
    assert.equal(invocation.executorClass, "pi");
    assert.equal(invocation.cacheHit, true);
    assert.equal(invocation.tokensIn, 20, "pi-ai nets cached tokens out of input");
    assert.equal(invocation.tokensOut, 5);
    assert.equal(invocation.callOutcome, "ok");
  } finally {
    await provider.close();
  }
});

test("provider silence on usage leaves cacheHit undefined, never guessed", async () => {
  const provider = await startLoopbackOpenAiProvider({
    modelIds: [MODEL_ID],
    omitUsage: true
  });
  try {
    const invocation = await runOnce(provider);
    assert.equal(invocation.cacheHit, undefined);
    assert.equal(invocation.tokensIn, undefined);
  } finally {
    await provider.close();
  }
});

test("a zero-cache usage block records cacheHit=false", async () => {
  const provider = await startLoopbackOpenAiProvider({
    modelIds: [MODEL_ID],
    promptTokens: 11,
    completionTokens: 5
  });
  try {
    const invocation = await runOnce(provider);
    assert.equal(invocation.cacheHit, false);
  } finally {
    await provider.close();
  }
});
