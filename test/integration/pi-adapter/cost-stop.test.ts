import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  Type,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall
} from "@earendil-works/pi-ai";
import {
  createAgentInstanceId,
  createRunId,
  createTaskId
} from "../../../src/domain/ids.js";
import type { AgentExecutionRequest, ExecutionEvent } from "../../../src/execution/contract.js";
import {
  PiAgentExecutor,
  type CostGateEvent
} from "../../../src/pi-adapter/pi-executor.js";

const toolParameters = Type.Object({});
const continueTool: AgentTool<typeof toolParameters, Record<string, never>> = {
  name: "continue_tool",
  label: "Continue tool",
  description: "Force the agent loop to consider another provider turn.",
  parameters: toolParameters,
  execute: async () => ({
    content: [{ type: "text", text: "continue" }],
    details: {}
  })
};

function request(maxCostUsd: number): AgentExecutionRequest {
  return {
    runId: createRunId(),
    taskId: createTaskId(),
    agentInstanceId: createAgentInstanceId(),
    prompt: "Call continue_tool, then finish.",
    workingDirectory: ".",
    maxCostUsd
  };
}

async function drain(executor: PiAgentExecutor, input: AgentExecutionRequest): Promise<ExecutionEvent[]> {
  const events: ExecutionEvent[] = [];
  for await (const event of executor.execute(input, new AbortController().signal)) {
    events.push(event);
  }
  return events;
}

test("Pi Agent invokes the cost stop-after-turn hook before another provider call", async () => {
  const faux = fauxProvider({
    provider: "priced-faux",
    models: [
      {
        id: "priced-model",
        name: "Priced model",
        cost: {
          input: 1_000_000,
          output: 1_000_000,
          cacheRead: 0,
          cacheWrite: 0
        }
      }
    ]
  });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("continue_tool", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage("this response must remain unused")
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  const costEvents: CostGateEvent[] = [];
  const executor = new PiAgentExecutor({
    providerId: "priced-faux",
    modelId: "priced-model",
    models,
    tools: [continueTool],
    onCostGate: (event) => costEvents.push(event)
  });

  const events = await drain(executor, request(0.5));

  assert.equal(faux.state.callCount, 1, "the Agent hook must stop before a second model call");
  assert.equal(faux.getPendingResponseCount(), 1);
  assert.equal(costEvents.length, 1);
  const stopped = costEvents[0];
  assert.equal(stopped?.kind, "stopped");
  if (stopped?.kind === "stopped") {
    assert.ok(stopped.ledger.spentUsd !== undefined);
    assert.ok(stopped.ledger.spentUsd >= stopped.maxCostUsd);
    assert.equal(stopped.ledger.turns, 1);
  }
  assert.equal(events.at(-1)?.type, "EXECUTION_FINISHED");
});

test("unknown catalog pricing reports an unenforced cap and does not invent a stop", async () => {
  const faux = fauxProvider({
    provider: "unpriced-faux",
    models: [
      {
        id: "unpriced-model",
        name: "Unpriced model",
        // A zero pair is how the custom-provider path represents absent rates.
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
      }
    ]
  });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("continue_tool", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage("second turn completed")
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  const costEvents: CostGateEvent[] = [];
  const executor = new PiAgentExecutor({
    providerId: "unpriced-faux",
    modelId: "unpriced-model",
    models,
    tools: [continueTool],
    onCostGate: (event) => costEvents.push(event)
  });

  await drain(executor, request(0.000001));

  assert.equal(faux.state.callCount, 2, "an unknown price must not fabricate a budget stop");
  assert.equal(faux.getPendingResponseCount(), 0);
  assert.deepEqual(
    costEvents.map((event) => event.kind),
    ["disarmed"]
  );
  assert.equal(costEvents[0]?.kind === "disarmed" ? costEvents[0].reason : undefined, "unpriced-model");
});
