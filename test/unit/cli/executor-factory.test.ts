import assert from "node:assert/strict";
import { test } from "node:test";
import { createCliExecutor, flowchartExecutorKind, resolveCliPiExecutorOptions } from "../../../src/cli/executor-factory.js";
import { emptyProvidersConfig } from "../../../src/config/providers-config.js";
import type { ModelRef } from "../../../src/config/model-ref.js";
import type { AgentExecutionRequest, ExecutionEvent } from "../../../src/execution/contract.js";

const config = { ...emptyProvidersConfig(), primary: "saved/primary", fast: "saved/fast" };
const input = { stateRoot: "/unused-state", config, env: {} };

test("saved model configuration preserves aliases, absence of credentials and default thinking", () => {
  const options = resolveCliPiExecutorOptions(input);
  assert.equal(options.providerId, "saved");
  assert.equal(options.modelId, "primary");
  assert.equal(options.thinkingLevel, "off");
  assert.equal("apiKey" in options, false);
  assert.equal("onInvocation" in options, false);
  assert.deepEqual(options.aliases, {
    cheap: { providerId: "saved", modelId: "fast" },
    premium: { providerId: "saved", modelId: "primary" }
  });
});

test("executor override wins over primary override, environment and saved defaults", () => {
  const modelOverride = { providerId: "flag", modelId: "primary" };
  const executorModelOverride = { providerId: "pinned", modelId: "model/with/slashes" };
  const options = resolveCliPiExecutorOptions({
    ...input, modelOverride, executorModelOverride,
    env: { PI_PROVIDER: "env", PI_MODEL: "model", PI_THINKING_LEVEL: "bad", PI_API_KEY: "test-only-key" },
    thinkingLevel: "high"
  });
  assert.equal(options.providerId, "pinned");
  assert.equal(options.modelId, "model/with/slashes");
  assert.equal(options.thinkingLevel, "high");
  assert.equal(options.apiKey, "test-only-key");
  assert.deepEqual(options.aliases?.premium, executorModelOverride);
});

test("ambient executor model keeps the saved premium routing alias", () => {
  const options = resolveCliPiExecutorOptions({ ...input, env: { PI_PROVIDER: "env", PI_MODEL: "model" } });
  assert.equal(options.providerId, "env");
  assert.equal(options.modelId, "model");
  assert.deepEqual(options.aliases?.premium, { providerId: "saved", modelId: "primary" });
});

test("partial environment configuration retains existing per-field default resolution", () => {
  const options = resolveCliPiExecutorOptions({ ...input, env: { PI_PROVIDER: "env" } });
  assert.equal(options.providerId, "env");
  assert.equal(options.modelId, "primary");
});

test("missing model identity and invalid ambient thinking retain existing errors", () => {
  assert.throws(() => resolveCliPiExecutorOptions({ ...input, config: emptyProvidersConfig() }), {
    message: "--executor pi requires an enabled primary model (pi-sparkle models set-default) or PI_PROVIDER and PI_MODEL"
  });
  assert.throws(() => resolveCliPiExecutorOptions({ ...input, env: { PI_THINKING_LEVEL: "ultra" } }), {
    message: "PI_THINKING_LEVEL must be one of off, minimal, low, medium, high, xhigh, max"
  });
});

test("resolver uses only the explicit environment snapshot and preserves hooks", () => {
  const before = process.env.PI_THINKING_LEVEL;
  process.env.PI_THINKING_LEVEL = "invalid-ambient";
  try {
    const hooks = { onInvocation: () => undefined, onCostGate: () => undefined };
    const options = resolveCliPiExecutorOptions({ ...input, hooks });
    assert.equal(options.thinkingLevel, "off");
    assert.equal(options.onInvocation, hooks.onInvocation);
    assert.equal(options.onCostGate, hooks.onCostGate);
  } finally {
    if (before === undefined) delete process.env.PI_THINKING_LEVEL;
    else process.env.PI_THINKING_LEVEL = before;
  }
});

for (const source of ["saved", "environment", "primary-flag", "executor-flag"] as const) {
  test(`same concrete ${source} model is not added as its own fallback`, () => {
    const ref: ModelRef = { providerId: "saved", modelId: "fast" };
    const options = resolveCliPiExecutorOptions({
      ...input,
      ...(source === "saved" ? { config: { ...config, primary: "saved/fast" } } : {}),
      ...(source === "environment" ? { env: { PI_PROVIDER: "saved", PI_MODEL: "fast" } } : {}),
      ...(source === "primary-flag" ? { modelOverride: ref } : {}),
      ...(source === "executor-flag" ? { executorModelOverride: ref } : {})
    });
    assert.equal(options.fallbackModels, undefined);
  });
}

test("different providers with equal model names remain distinct fallbacks", () => {
  const options = resolveCliPiExecutorOptions({ ...input, executorModelOverride: { providerId: "other", modelId: "fast" } });
  assert.deepEqual(options.fallbackModels, [{ providerId: "saved", modelId: "fast" }]);
});

test("fake flowchart executor still emits one protocol task result", async () => {
  assert.equal(flowchartExecutorKind("fake"), "fake-children");
  assert.equal(flowchartExecutorKind("pi"), "pi");
  const executor = await createCliExecutor(flowchartExecutorKind("fake"), "/unused-state");
  const events: ExecutionEvent[] = [];
  const request = { runId: "run_test", taskId: "tsk_test", agentInstanceId: "agt_test", prompt: "test", workingDirectory: "/tmp" } as AgentExecutionRequest;
  for await (const event of executor.execute(request, new AbortController().signal)) events.push(event);
  assert.deepEqual(events.map((event) => event.type), ["MESSAGE", "EXECUTION_FINISHED"]);
  assert.equal(events[0]?.type === "MESSAGE" && events[0].message.type, "TASK_RESULT");
});
