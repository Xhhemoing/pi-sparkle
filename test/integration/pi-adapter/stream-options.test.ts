import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type Api,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions
} from "@earendil-works/pi-ai";
import { PiAgentExecutor } from "../../../src/pi-adapter/pi-executor.js";
import { createAgentInstanceId, createRunId, createTaskId } from "../../../src/domain/ids.js";

/**
 * The executor forwards Pi's own SimpleStreamOptions verbatim and only adds the
 * api key. Fields Pi grows over time (0.84.3 added `toolChoice`) therefore reach
 * the provider without the adapter naming them; hand-copying fields here would
 * silently drop them.
 */
test("PiAgentExecutor forwards Pi's stream options verbatim and adds the api key", async () => {
  const faux = fauxProvider({ provider: "alpha", models: [{ id: "one", name: "One" }] });
  faux.setResponses([fauxAssistantMessage("ok")]);
  const models = createModels();
  models.setProvider(faux.provider);

  const seen: SimpleStreamOptions[] = [];
  const forward = models.streamSimple.bind(models);
  models.streamSimple = (
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions
  ): AssistantMessageEventStream => {
    if (options !== undefined) seen.push(options);
    return forward(model, context, options);
  };

  const executor = new PiAgentExecutor({
    providerId: "alpha",
    modelId: "one",
    models,
    thinkingLevel: "low",
    apiKey: "test-key"
  });

  for await (const event of executor.execute(
    {
      runId: createRunId(),
      taskId: createTaskId(),
      agentInstanceId: createAgentInstanceId(),
      prompt: "hi",
      workingDirectory: "."
    },
    new AbortController().signal
  )) {
    void event;
  }

  assert.equal(seen.length, 1);
  const options = seen[0] as SimpleStreamOptions & Record<string, unknown>;
  assert.equal(options.reasoning, "low");
  assert.equal(options.apiKey, "test-key");
  // Options Pi sets that the adapter never names: proof the spread is verbatim.
  assert.equal(options.toolExecution, "parallel");
  assert.ok(options.signal instanceof AbortSignal);
});
