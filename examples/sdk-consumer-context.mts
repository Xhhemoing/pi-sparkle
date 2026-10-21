import assert from "node:assert/strict";
import { createContributionHost, type ContributionRequest } from "pi-sparkle/sdk/host.js";
import { FakeExecutor, type AgentExecutionRequest, type ExecutionEvent } from "pi-sparkle/sdk/testing.js";

const host = createContributionHost({
  generationId: "consumer-1", capabilities: ["selected-files"],
  plugins: [{
    id: "selected-context", enabled: true, apiVersion: 1,
    requiredCapabilities: ["selected-files"], contributions: [{ kind: "context", id: "selected" }],
    load: async () => [{ kind: "context", id: "selected", provide: async (request) => ({ items: [{ text: request.objective, source: request.selectedFiles[0]?.path ?? "task" }] }) }],
  }],
});
const request: ContributionRequest = { generationId: "consumer-1", revision: "revision-1", objective: "Inspect selected source", selectedFiles: [{ path: "example.ts" }] };
const result = await host.context("selected", request);
assert.equal(result.status, "available");
if (result.status !== "available") throw new Error("Context unavailable: use host fallback");
assert.equal(result.value.items[0]?.source, "example.ts");
const executor = new FakeExecutor([{ type: "TEXT_DELTA", text: result.value.items[0]!.text }, { type: "EXECUTION_FINISHED", outcome: "SUCCESS" }]);
const execution: AgentExecutionRequest = {
  runId: "run_sdk" as AgentExecutionRequest["runId"], taskId: "task_sdk" as AgentExecutionRequest["taskId"],
  agentInstanceId: "agent_sdk" as AgentExecutionRequest["agentInstanceId"], prompt: request.objective, workingDirectory: process.cwd(),
};
const events: ExecutionEvent[] = [];
for await (const event of executor.execute(execution, new AbortController().signal)) events.push(event);
assert.deepEqual(events, [{ type: "TEXT_DELTA", text: "Inspect selected source" }, { type: "EXECUTION_FINISHED", outcome: "SUCCESS" }]);
await host.close();
