import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collectSignalsFromEvents,
  collectSignalsFromSubagentRun,
  parseObservedSignal,
  scoreTaskResult,
  scoreUserAnswer
} from "../../../src/learning/signals.js";
import { DomainValidationError } from "../../../src/domain/errors.js";
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

test("a deterministic FAIL carries its failure attribution", () => {
  const projectId = createProjectId();
  const runId = createRunId();
  const taskId = parseTaskId("tsk_env1");
  const events: Event[] = [
    makeEvent(runId, "PROJECT_DISCOVERED", {
      project: { id: projectId, rootPath: "E:/proj", discoveredAt: nowIso(), instructionFiles: [], manifests: [], commands: [], facts: [] }
    }),
    routedEvent(runId, taskId, "cheap", "cheap-v1"),
    makeEvent(runId, "CHILD_MESSAGE", {
      message: taskResult(runId, taskId, "msg_env", {
        outcome: "FAILURE",
        summary: "spawn failed: tool crashed",
        verification: { kind: "FAILED", evidenceIds: ["evd_env"] },
        failure: { category: "TOOL_ERROR", detail: "spawn failed" }
      })
    })
  ];
  const signals = collectSignalsFromEvents(events, { episodeId: createEpisodeId() });
  const fail = signals.find((signal) => signal.criterion === "taskSuccess");
  assert.equal(fail?.outcomeKind, "FAIL");
  assert.equal(fail?.failureClass, "tool");

  const modelFailEvents: Event[] = [
    events[0]!,
    routedEvent(runId, taskId, "cheap", "cheap-v1"),
    makeEvent(runId, "CHILD_MESSAGE", {
      message: taskResult(runId, taskId, "msg_model", {
        outcome: "FAILURE",
        summary: "tests failed",
        verification: { kind: "FAILED", evidenceIds: ["evd_m"] }
      })
    })
  ];
  const modelFail = collectSignalsFromEvents(modelFailEvents, { episodeId: createEpisodeId() })
    .find((signal) => signal.criterion === "taskSuccess");
  assert.equal(modelFail?.failureClass, "model");
});

test("a cascade TASK_RETRY rebinds later results to the escalated model", () => {
  const projectId = createProjectId();
  const runId = createRunId();
  const taskId = parseTaskId("tsk_casc1");
  const events: Event[] = [
    makeEvent(runId, "PROJECT_DISCOVERED", {
      project: { id: projectId, rootPath: "E:/proj", discoveredAt: nowIso(), instructionFiles: [], manifests: [], commands: [], facts: [] }
    }),
    routedEvent(runId, taskId, "cheap", "cheap-v1"),
    makeEvent(runId, "CHILD_MESSAGE", {
      message: taskResult(runId, taskId, "msg_first", {
        outcome: "FAILURE",
        summary: "tests failed",
        verification: { kind: "FAILED", evidenceIds: ["evd_1"] }
      })
    }),
    { ...makeEvent(runId, "TASK_RETRY", {
      childRunId: runId,
      attempt: 1,
      reason: "cascade cheap->premium",
      previousModel: "cheap",
      nextModel: "premium",
      nextModelVersion: "premium-v2"
    }), taskId },
    makeEvent(runId, "CHILD_MESSAGE", {
      message: taskResult(runId, taskId, "msg_second", {
        outcome: "SUCCESS",
        summary: "tests pass",
        verification: { kind: "PASSED", evidenceIds: ["evd_2"] }
      })
    })
  ];
  const signals = collectSignalsFromEvents(events, { episodeId: createEpisodeId() });
  const results = signals.filter((signal) => signal.criterion === "taskSuccess");
  assert.equal(results.length, 2);
  assert.equal(results[0]?.modelId, "cheap");
  assert.equal(results[0]?.modelVersion, "cheap-v1");
  assert.equal(results[0]?.outcomeKind, "FAIL");
  assert.equal(results[1]?.modelId, "premium", "post-cascade PASS must bind to the escalated model");
  assert.equal(results[1]?.modelVersion, "premium-v2");
  assert.equal(results[1]?.outcomeKind, "PASS");
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

test("extraSignals cannot forge failureClass; 429 summaries derive environment", () => {
  const projectId = createProjectId();
  assert.throws(
    () =>
      parseObservedSignal({
        source: "subagent",
        kind: "deterministic",
        projectId,
        score: 15,
        criterion: "taskSuccess",
        outcomeKind: "FAIL",
        failureClass: "environment",
        boundary: "execution",
        summary: "tests failed",
        createdAt: nowIso(),
        evidenceIds: []
      }),
    (error: unknown) => error instanceof DomainValidationError && /forge failureClass/.test(error.message)
  );
  const derived = parseObservedSignal({
    source: "subagent",
    kind: "deterministic",
    projectId,
    score: 15,
    criterion: "taskSuccess",
    outcomeKind: "FAIL",
    boundary: "execution",
    summary: "upstream 429 rate limited",
    createdAt: nowIso(),
    evidenceIds: []
  });
  assert.equal(derived.failureClass, "environment");
});

test("TASK_TIMEOUT attributes a later FAILED result as run, not model", () => {
  const projectId = createProjectId();
  const runId = createRunId();
  const taskId = parseTaskId("tsk_to1");
  const timeoutEvent = {
    ...makeEvent(runId, "TASK_TIMEOUT", { childRunId: runId, attempt: 1 }),
    taskId
  } as Event;
  const events: Event[] = [
    makeEvent(runId, "PROJECT_DISCOVERED", {
      project: { id: projectId, rootPath: "E:/proj", discoveredAt: nowIso(), instructionFiles: [], manifests: [], commands: [], facts: [] }
    }),
    routedEvent(runId, taskId, "cheap", "cheap-v1"),
    timeoutEvent,
    makeEvent(runId, "CHILD_MESSAGE", {
      message: taskResult(runId, taskId, "msg_to", {
        outcome: "FAILURE",
        summary: "output did not match the golden fixture",
        verification: { kind: "FAILED", evidenceIds: ["evd_to"] }
      })
    })
  ];
  const fail = collectSignalsFromEvents(events, { episodeId: createEpisodeId() })
    .find((signal) => signal.criterion === "taskSuccess");
  assert.equal(fail?.failureClass, "run");
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

function routedEvent(
  runId: ReturnType<typeof createRunId>,
  taskId: ReturnType<typeof parseTaskId>,
  model: string,
  modelVersion: string
): Event {
  return makeEvent(runId, "MODEL_ROUTED", {
    taskId,
    role: "actor",
    complexity: "MEDIUM",
    model,
    justification: "cheapest eligible",
    confidence: 0.9,
    approvalPlan: { id: "ap_1", actions: [{ id: "go", label: "go" }], defaultActionIds: ["go"] },
    statusAfterRoute: "RUNNING",
    policyVersion: "v1",
    estimatedCostUsd: 0.01,
    estimatedDurationMs: 1000,
    family: "edit",
    featureVersion: "assign-v2",
    modelVersion,
    highRisk: false,
    eligibleModels: [model],
    rejections: [],
    behaviorDistribution: { [model]: 1 }
  });
}

function taskResult(
  runId: ReturnType<typeof createRunId>,
  taskId: ReturnType<typeof parseTaskId>,
  id: string,
  body: {
    outcome: "SUCCESS" | "FAILURE";
    summary: string;
    verification: { kind: "PASSED" | "FAILED"; evidenceIds: string[] };
    failure?: { category: string; detail?: string };
  }
): unknown {
  return {
    protocolVersion: 1,
    id,
    occurredAt: nowIso(),
    runId,
    taskId,
    from: "agt_child",
    to: "SUPERVISOR",
    type: "TASK_RESULT",
    outcome: body.outcome,
    summary: body.summary,
    artifactIds: [],
    evidenceIds: body.verification.evidenceIds,
    verification: body.verification,
    ...(body.failure !== undefined ? { failure: body.failure } : {})
  };
}
