import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collectSignalsFromEvents,
  collectSignalsFromSubagentRun,
  scoreTaskResult,
  scoreUserAnswer
} from "../../../src/learning/signals.js";
import {
  createEpisodeId,
  createEventId,
  createProjectId,
  createRunId,
  parseTaskId
} from "../../../src/domain/ids.js";
import { nowIso } from "../../../src/domain/timestamp.js";
import type { Event } from "../../../src/run/events.js";

test("task results and user answers map to 0-100 scores", () => {
  assert.equal(scoreTaskResult("FAILURE", "FAILED"), 15);
  assert.ok((scoreTaskResult("SUCCESS", "PASSED") ?? 0) >= 80);
  assert.ok((scoreTaskResult("SUCCESS", "UNOBSERVED") ?? 100) < 60);
  assert.equal(scoreUserAnswer("this is wrong, revert it"), 10);
  assert.equal(scoreUserAnswer("lgtm, ship it"), 90);
  assert.equal(scoreUserAnswer("ok noted"), undefined);
});

test("run events collect user, subagent, and deterministic signals keyed by model and project", () => {
  const projectId = createProjectId();
  const runId = createRunId();
  const taskId = parseTaskId("tsk_impl1");
  const events: Event[] = [
    makeEvent(runId, "PROJECT_DISCOVERED", {
      project: { id: projectId, rootPath: "E:/proj", discoveredAt: nowIso(), instructionFiles: [], manifests: [], commands: [], facts: [] }
    }),
    makeEvent(runId, "MODEL_ROUTED", {
      taskId,
      role: "actor",
      complexity: "MEDIUM",
      model: "cheap",
      justification: "cheapest eligible",
      confidence: 0.9,
      approvalPlan: { id: "ap_1", actions: [{ id: "go", label: "go" }], defaultActionIds: ["go"] },
      statusAfterRoute: "RUNNING",
      policyVersion: "v1",
      estimatedCostUsd: 0.01,
      estimatedDurationMs: 1000,
      family: "edit",
      featureVersion: "assign-v2",
      modelVersion: "cheap-v1",
      highRisk: false,
      eligibleModels: ["cheap"],
      rejections: [],
      behaviorDistribution: { cheap: 1 }
    }),
    makeEvent(runId, "CHILD_MESSAGE", {
      message: {
        protocolVersion: 1,
        id: "msg_result1",
        occurredAt: nowIso(),
        runId,
        taskId,
        from: "agt_child",
        to: "SUPERVISOR",
        type: "TASK_RESULT",
        outcome: "FAILURE",
        summary: "tests failed",
        artifactIds: [],
        evidenceIds: ["evd_t1"],
        verification: { kind: "FAILED", evidenceIds: ["evd_t1"] }
      }
    }),
    makeEvent(runId, "USER_ANSWER", {
      messageId: "msg_q1",
      answer: "no, this is wrong"
    })
  ];
  const signals = collectSignalsFromEvents(events, { episodeId: createEpisodeId() });
  assert.ok(signals.some((signal) => signal.source === "subagent" && signal.modelId === "cheap"));
  assert.ok(signals.some((signal) => signal.source === "user" && signal.score <= 20));
  assert.ok(signals.every((signal) => signal.projectId === projectId));
  const user = signals.find((signal) => signal.source === "user");
  assert.equal(user?.modelId, undefined);
  assert.equal(user?.criterion, "userAcceptance");
  const task = signals.find((signal) => signal.source === "subagent");
  assert.equal(task?.criterion, "taskSuccess");
  assert.equal(task?.taskId, taskId);
});

test("Pi subagent runs contribute model-attributed feedback and drop thinking traces", () => {
  const projectId = createProjectId();
  const signals = collectSignalsFromSubagentRun(
    {
      id: "run-1",
      status: "failed",
      request: { agent: "implementer", cwd: "E:/proj", task: "Implement parser" },
      results: [
        {
          agent: "implementer",
          exitCode: 1,
          messages: [
            {
              role: "assistant",
              model: "gpt-x",
              content: [
                { type: "thinking", thinking: "SECRET_CHAIN" },
                { type: "text", text: "Unknown agent: implementer" }
              ]
            }
          ]
        }
      ]
    },
    { projectId, projectRoot: "E:/proj", episodeId: createEpisodeId() }
  );
  assert.equal(signals.length, 1);
  assert.equal(signals[0]?.modelId, "gpt-x");
  assert.equal(signals[0]?.role, "implementer");
  assert.ok((signals[0]?.score ?? 100) < 40);
  assert.doesNotMatch(signals[0]?.summary ?? "", /SECRET_CHAIN/);
  assert.notEqual(signals[0]?.criterion, "taskSuccess");
});

function makeEvent(runId: ReturnType<typeof createRunId>, type: Event["type"], payload: unknown): Event {
  return {
    id: createEventId(),
    schemaVersion: 1,
    occurredAt: nowIso(),
    runId,
    type,
    actor: "coordinator",
    payload
  } as Event;
}
