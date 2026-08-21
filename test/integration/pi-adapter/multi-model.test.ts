import assert from "node:assert/strict";
import { test } from "node:test";
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { PiAgentExecutor } from "../../../src/pi-adapter/pi-executor.js";
import { createAgentInstanceId, createRunId, createTaskId } from "../../../src/domain/ids.js";
import type { AgentExecutionRequest } from "../../../src/execution/contract.js";

function request(overrides: Partial<AgentExecutionRequest> = {}): AgentExecutionRequest {
  return {
    runId: createRunId(),
    taskId: createTaskId(),
    agentInstanceId: createAgentInstanceId(),
    prompt: "hi",
    workingDirectory: ".",
    ...overrides
  };
}

async function collectText(executor: PiAgentExecutor, req: AgentExecutionRequest): Promise<string> {
  const parts: string[] = [];
  for await (const event of executor.execute(req, new AbortController().signal)) {
    if (event.type === "TEXT_DELTA") parts.push(event.text);
  }
  return parts.join("");
}

test("PiAgentExecutor honors per-request provider and model across two faux providers", async () => {
  const alpha = fauxProvider({ provider: "alpha", models: [{ id: "one", name: "One" }] });
  const beta = fauxProvider({ provider: "beta", models: [{ id: "two", name: "Two" }] });
  alpha.setResponses([fauxAssistantMessage("from-alpha")]);
  beta.setResponses([fauxAssistantMessage("from-beta")]);
  const models = createModels();
  models.setProvider(alpha.provider);
  models.setProvider(beta.provider);

  const executor = new PiAgentExecutor({
    providerId: "alpha",
    modelId: "one",
    models
  });

  assert.equal(await collectText(executor, request()), "from-alpha");
  assert.equal(
    await collectText(executor, request({ providerId: "beta", modelId: "two" })),
    "from-beta"
  );
});

test("PiAgentExecutor resolves provider/model catalog ids and cheap aliases", async () => {
  const openaiish = fauxProvider({ provider: "openai", models: [{ id: "gpt-mini", name: "Mini" }] });
  openaiish.setResponses([fauxAssistantMessage("alias-ok")]);
  const models = createModels();
  models.setProvider(openaiish.provider);
  const executor = new PiAgentExecutor({
    providerId: "openai",
    modelId: "gpt-mini",
    models,
    aliases: { cheap: { providerId: "openai", modelId: "gpt-mini" } }
  });
  assert.equal(await collectText(executor, request({ modelId: "openai/gpt-mini" })), "alias-ok");
  openaiish.appendResponses([fauxAssistantMessage("cheap-ok")]);
  assert.equal(await collectText(executor, request({ modelId: "cheap" })), "cheap-ok");
});
