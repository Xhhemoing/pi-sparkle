import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAgentInstanceId,
  createArtifactId,
  createEvidenceId,
  createMessageId,
  createRunId,
  createTaskId
} from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { SUPERVISOR, validateAgentMessage, type TaskResult } from "../../../src/protocol/v1.js";
import {
  PASSED_NODE_CONFIDENCE,
  childNodeResultFromExecution,
  executeFlowchartNode
} from "../../../src/run/flowchart-executor.js";
import { FakeExecutor, ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";
import type { AgentExecutor, ExecutionEvent } from "../../../src/execution/contract.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

function taskResult(overrides: {
  outcome?: TaskResult["outcome"];
  verificationKind?: TaskResult["verification"]["kind"];
}): TaskResult {
  const evidenceId = createEvidenceId(UUID);
  const message = validateAgentMessage({
    protocolVersion: 1,
    id: createMessageId(UUID),
    occurredAt: parseIsoTimestamp("2026-08-20T08:00:00.000Z"),
    runId: createRunId(UUID),
    taskId: createTaskId(UUID),
    from: createAgentInstanceId(UUID),
    to: SUPERVISOR,
    type: "TASK_RESULT",
    outcome: overrides.outcome ?? "SUCCESS",
    summary: "done",
    artifactIds: [createArtifactId(UUID)],
    evidenceIds: [evidenceId],
    verification: { kind: overrides.verificationKind ?? "PASSED", evidenceIds: [evidenceId] }
  });
  if (message.type !== "TASK_RESULT") throw new Error("expected TASK_RESULT");
  return message;
}

class RecordingExecutor implements AgentExecutor {
  lastPrompt: string | undefined;
  lastModelId: string | undefined;
  constructor(private readonly steps: readonly ExecutionEvent[]) {}
  async *execute(request: { prompt: string; modelId?: string }, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    this.lastPrompt = request.prompt;
    this.lastModelId = request.modelId;
    if (signal.aborted) {
      yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
      return;
    }
    for (const step of this.steps) yield step;
  }
}

test("PASSED TASK_RESULT maps to SUCCESS with high confidence", () => {
  const terminal = taskResult({ outcome: "SUCCESS", verificationKind: "PASSED" });
  assert.deepEqual(childNodeResultFromExecution({ terminal, executorOutcome: "SUCCESS" }), {
    outcome: "SUCCESS",
    confidence: PASSED_NODE_CONFIDENCE,
    evidenceIds: terminal.evidenceIds
  });
});

test("PARTIAL PASSED maps to PARTIAL with high confidence", () => {
  const terminal = taskResult({ outcome: "PARTIAL", verificationKind: "PASSED" });
  const mapped = childNodeResultFromExecution({ terminal });
  assert.equal(mapped.outcome, "PARTIAL");
  assert.equal(mapped.confidence, PASSED_NODE_CONFIDENCE);
});

test("FAILED verification maps to FAILURE even when TASK_RESULT says SUCCESS", () => {
  const terminal = taskResult({ outcome: "SUCCESS", verificationKind: "FAILED" });
  const mapped = childNodeResultFromExecution({ terminal, executorOutcome: "SUCCESS" });
  assert.equal(mapped.outcome, "FAILURE");
  assert.equal(mapped.confidence, undefined);
  assert.deepEqual(mapped.evidenceIds, terminal.evidenceIds);
});

test("UNOBSERVED SUCCESS omits confidence so confidence edges fail closed", () => {
  const terminal = taskResult({ outcome: "SUCCESS", verificationKind: "UNOBSERVED" });
  const mapped = childNodeResultFromExecution({ terminal, executorOutcome: "SUCCESS" });
  assert.equal(mapped.outcome, "SUCCESS");
  assert.equal(mapped.confidence, undefined);
});

test("CANCELLED TASK_RESULT maps to FAILURE", () => {
  const mapped = childNodeResultFromExecution({
    terminal: taskResult({ outcome: "CANCELLED", verificationKind: "UNOBSERVED" })
  });
  assert.equal(mapped.outcome, "FAILURE");
});

test("EXECUTION_FINISHED SUCCESS without TASK_RESULT maps to SUCCESS without confidence", () => {
  assert.deepEqual(childNodeResultFromExecution({ executorOutcome: "SUCCESS" }), { outcome: "SUCCESS" });
});

test("EXECUTION_FINISHED FAILURE without TASK_RESULT maps to FAILURE", () => {
  assert.deepEqual(childNodeResultFromExecution({ executorOutcome: "FAILURE" }), { outcome: "FAILURE" });
});

test("executeFlowchartNode uses ProtocolChildExecutor TASK_RESULT", async () => {
  const result = await executeFlowchartNode({
    executor: new ProtocolChildExecutor(),
    runId: createRunId(UUID),
    taskId: createTaskId(UUID),
    prompt: "flowchart node only (actor)\nObjective: Do the work\nAssigned model: cheap",
    workingDirectory: ".",
    modelId: "cheap"
  });
  assert.equal(result.outcome, "SUCCESS");
  assert.equal(result.confidence, PASSED_NODE_CONFIDENCE);
  assert.ok(result.evidenceIds && result.evidenceIds.length > 0);
});

test("executeFlowchartNode forwards prompt and model id", async () => {
  const executor = new RecordingExecutor([{ type: "EXECUTION_FINISHED", outcome: "SUCCESS" }]);
  await executeFlowchartNode({
    executor,
    runId: createRunId(UUID),
    taskId: createTaskId(UUID),
    prompt: "do impl",
    workingDirectory: ".",
    modelId: "premium"
  });
  assert.equal(executor.lastPrompt, "do impl");
  assert.equal(executor.lastModelId, "premium");
});

test("FakeExecutor without TASK_RESULT still completes as SUCCESS without confidence", async () => {
  const result = await executeFlowchartNode({
    executor: new FakeExecutor([{ type: "EXECUTION_FINISHED", outcome: "SUCCESS" }]),
    runId: createRunId(UUID),
    taskId: createTaskId(UUID),
    prompt: "x",
    workingDirectory: "."
  });
  assert.deepEqual(result, { outcome: "SUCCESS" });
});
