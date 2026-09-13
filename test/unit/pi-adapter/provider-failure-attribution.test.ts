import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type FauxResponseStep
} from "@earendil-works/pi-ai";
import { PiAgentExecutor, REPORT_TASK_RESULT_TOOL } from "../../../src/pi-adapter/pi-executor.js";
import type { AgentExecutionRequest, ExecutionEvent } from "../../../src/execution/contract.js";
import type { AgentInstanceId, RunId, TaskId } from "../../../src/domain/ids.js";
import { validateAgentMessage, type TaskResult } from "../../../src/protocol/v1.js";
import { taskSuccessFromResult } from "../../../src/learning/task-success.js";
import { classifyTaskFailure } from "../../../src/routing/failure-class.js";

/**
 * PS-HOTFIX: provider/env failures must synthesize UNOBSERVED (not FAILED with
 * empty evidenceIds), carry explicit provider attribution, and stay out of
 * deterministic taskSuccess FAIL for the model.
 */

const RUN_ID = "run_01234567-89ab-cdef-0123-456789abcdef" as RunId;
const TASK_ID = "tsk_01234567-89ab-cdef-0123-456789abcdef" as TaskId;
const AGENT_ID = "agt_01234567-89ab-cdef-0123-456789abcdef" as AgentInstanceId;

function request(): AgentExecutionRequest {
  return {
    runId: RUN_ID,
    taskId: TASK_ID,
    agentInstanceId: AGENT_ID,
    prompt: "do the thing",
    workingDirectory: "/tmp/project"
  };
}

function providerError(status: number, body: string): () => never {
  return () => {
    throw new Error(`${status}: ${body}`);
  };
}

function executorFor(responses: FauxResponseStep[], maxAttempts = 1): PiAgentExecutor {
  const faux = fauxProvider();
  faux.setResponses(responses);
  const models = createModels();
  models.setProvider(faux.provider);
  return new PiAgentExecutor({
    providerId: "faux",
    modelId: "faux-1",
    models,
    retry: { maxAttempts, baseDelayMs: 1, jitterRatio: 0, random: () => 0, sleep: async () => {} }
  });
}

async function drain(executor: PiAgentExecutor): Promise<ExecutionEvent[]> {
  const events: ExecutionEvent[] = [];
  for await (const event of executor.execute(request(), new AbortController().signal)) {
    events.push(event);
  }
  return events;
}

function terminalsOf(events: readonly ExecutionEvent[]): TaskResult[] {
  return events.flatMap((event) =>
    event.type === "MESSAGE" && event.message.type === "TASK_RESULT" ? [event.message] : []
  );
}

describe("provider failure attribution (HOTFIX)", () => {
  it("synthesizes UNOBSERVED + PROVIDER_ERROR instead of FAILED with empty evidence", async () => {
    const events = await drain(executorFor([providerError(429, "rate limited")]));
    const terminals = terminalsOf(events);
    assert.equal(terminals.length, 1);
    const result = terminals[0]!;
    assert.equal(result.outcome, "FAILURE");
    assert.deepEqual(result.verification, { kind: "UNOBSERVED", evidenceIds: [] });
    assert.equal(result.failure?.category, "PROVIDER_ERROR");
    assert.match(result.failure?.detail ?? "", /rate-limit|429|rate limited/i);
    assert.match(result.summary, /pi agent failed:/);
    assert.equal(validateAgentMessage(result).type, "TASK_RESULT");
    assert.equal(
      taskSuccessFromResult(result.outcome, result.verification.kind),
      undefined,
      "UNOBSERVED must not enter the taskSuccess channel"
    );
    assert.equal(
      classifyTaskFailure({
        outcome: result.outcome,
        verificationKind: result.verification.kind,
        summary: result.summary,
        failure: result.failure
      }),
      "provider"
    );
  });

  it("timeouts and 5xx also attribute as provider, never model", async () => {
    for (const [status, body] of [
      [504, "gateway timeout"],
      [503, "upstream overloaded"]
    ] as const) {
      const events = await drain(executorFor([providerError(status, body)]));
      const result = terminalsOf(events)[0]!;
      assert.deepEqual(result.verification, { kind: "UNOBSERVED", evidenceIds: [] });
      assert.equal(result.failure?.category, "PROVIDER_ERROR");
      assert.notEqual(
        classifyTaskFailure({
          outcome: result.outcome,
          verificationKind: result.verification.kind,
          summary: result.summary,
          failure: result.failure
        }),
        "model"
      );
    }
  });

  it("agent-reported FAILED with evidence remains model-attributable taskSuccess FAIL", async () => {
    const events = await drain(
      executorFor([
        fauxAssistantMessage(
          fauxToolCall(
            REPORT_TASK_RESULT_TOOL,
            {
              verification: "FAILED",
              summary: "tests failed on golden fixture",
              evidenceIds: ["evd_suite-1"]
            },
            { id: "tool_call_1" }
          )
        )
      ])
    );
    const result = terminalsOf(events)[0]!;
    assert.equal(result.verification.kind, "FAILED");
    assert.ok((result.verification.evidenceIds?.length ?? 0) > 0);
    const observed = taskSuccessFromResult(result.outcome, result.verification.kind, {
      modelId: "faux-1",
      family: "edit"
    });
    assert.equal(observed?.outcomeKind, "FAIL");
    assert.equal(
      classifyTaskFailure({
        outcome: result.outcome,
        verificationKind: result.verification.kind,
        summary: result.summary
      }),
      "model"
    );
  });
});
