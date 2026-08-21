import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  collectSignalsFromEvents,
  collectSignalsFromSubagentRun
} from "../../../src/learning/signals.js";
import {
  taskSuccessFromExitCode,
  taskSuccessFromResult
} from "../../../src/learning/task-success.js";
import {
  createEpisodeId,
  createEventId,
  createProjectId,
  createRunId,
  parseTaskId
} from "../../../src/domain/ids.js";
import { nowIso } from "../../../src/domain/timestamp.js";
import type { Event } from "../../../src/run/events.js";
import type { TaskOutcome, VerificationKind } from "../../../src/protocol/v1.js";

test("TASK_RESULT with PASSED verification writes taskSuccess PASS from deterministic source", () => {
  const observed = taskSuccessFromResult("SUCCESS", "PASSED");
  assert.equal(observed?.criterion, "taskSuccess");
  assert.equal(observed?.outcomeKind, "PASS");
  assert.equal(observed?.source, "deterministic");
});

test("TASK_RESULT with FAILED verification writes taskSuccess FAIL from deterministic source", () => {
  const observed = taskSuccessFromResult("FAILURE", "FAILED");
  assert.equal(observed?.criterion, "taskSuccess");
  assert.equal(observed?.outcomeKind, "FAIL");
  assert.equal(observed?.source, "deterministic");
});

test("UNOBSERVED verification does not write taskSuccess even when outcome is FAILURE", () => {
  assert.equal(taskSuccessFromResult("FAILURE", "UNOBSERVED"), undefined);
  assert.equal(taskSuccessFromResult("SUCCESS", "UNOBSERVED"), undefined);
});

test("PARTIAL and CANCELLED outcomes do not write taskSuccess", () => {
  assert.equal(taskSuccessFromResult("PARTIAL", "PASSED"), undefined);
  assert.equal(taskSuccessFromResult("PARTIAL", "FAILED"), undefined);
  assert.equal(taskSuccessFromResult("CANCELLED", "PASSED"), undefined);
  assert.equal(taskSuccessFromResult("CANCELLED", "FAILED"), undefined);
  assert.equal(taskSuccessFromResult("CANCELLED", "UNOBSERVED"), undefined);
});

test("project test command exit code 0 maps to taskSuccess PASS", () => {
  const observed = taskSuccessFromExitCode(0);
  assert.equal(observed.criterion, "taskSuccess");
  assert.equal(observed.outcomeKind, "PASS");
  assert.equal(observed.source, "deterministic");
});

test("project test command non-zero exit code maps to taskSuccess FAIL", () => {
  const observed = taskSuccessFromExitCode(1);
  assert.equal(observed.criterion, "taskSuccess");
  assert.equal(observed.outcomeKind, "FAIL");
  const other = taskSuccessFromExitCode(2);
  assert.equal(other.outcomeKind, "FAIL");
});

test("adapter does not invent a modelId when the route binding is missing", () => {
  const fromResult = taskSuccessFromResult("SUCCESS", "PASSED");
  assert.equal(fromResult?.modelId, undefined);
  assert.equal(fromResult?.modelVersion, undefined);
  assert.equal(fromResult?.featureVersion, undefined);
  const fromExit = taskSuccessFromExitCode(0);
  assert.equal(fromExit.modelId, undefined);
});

test("TASK_RESULT PASSED or FAILED without MODEL_ROUTED has no modelId", () => {
  const projectId = createProjectId();
  const runId = createRunId();
  const taskId = parseTaskId("tsk_orphan");
  for (const [outcome, verification] of [
    ["SUCCESS", "PASSED"],
    ["FAILURE", "FAILED"]
  ] as const) {
    const signals = collectSignalsFromEvents(
      [
        projectEvent(runId, projectId),
        childTaskResult(runId, taskId, outcome, verification)
      ],
      { episodeId: createEpisodeId() }
    );
    const taskSuccess = signals.filter((signal) => signal.criterion === "taskSuccess");
    assert.equal(taskSuccess.length, 1);
    assert.equal(taskSuccess[0]?.modelId, undefined);
    assert.equal(taskSuccess[0]?.modelVersion, undefined);
    assert.equal(taskSuccess[0]?.featureVersion, undefined);
    assert.equal(taskSuccess[0]?.family, undefined);
  }
});

test("MODEL_ROUTED binds model, modelVersion, family, and featureVersion onto taskSuccess", () => {
  const projectId = createProjectId();
  const runId = createRunId();
  const taskId = parseTaskId("tsk_bound");
  const signals = collectSignalsFromEvents(
    [
      projectEvent(runId, projectId),
      modelRoutedEvent(runId, taskId, {
        model: "cheap",
        modelVersion: "cheap-v1",
        family: "edit",
        featureVersion: "assign-v2"
      }),
      childTaskResult(runId, taskId, "SUCCESS", "PASSED")
    ],
    { episodeId: createEpisodeId() }
  );
  const taskSuccess = signals.find((signal) => signal.criterion === "taskSuccess");
  assert.ok(taskSuccess);
  assert.equal(taskSuccess.modelId, "cheap");
  assert.equal(taskSuccess.modelVersion, "cheap-v1");
  assert.equal(taskSuccess.family, "edit");
  assert.equal(taskSuccess.featureVersion, "assign-v2");
  assert.equal(taskSuccess.outcomeKind, "PASS");
});

test("UNOBSERVED PARTIAL and CANCELLED TASK_RESULT events do not write taskSuccess", () => {
  const projectId = createProjectId();
  const runId = createRunId();
  const cases: ReadonlyArray<{ outcome: TaskOutcome; verification: VerificationKind; taskId: string }> = [
    { outcome: "SUCCESS", verification: "UNOBSERVED", taskId: "tsk_unobs" },
    { outcome: "FAILURE", verification: "UNOBSERVED", taskId: "tsk_fail_unobs" },
    { outcome: "PARTIAL", verification: "PASSED", taskId: "tsk_partial" },
    { outcome: "CANCELLED", verification: "FAILED", taskId: "tsk_cancel" }
  ];
  for (const row of cases) {
    const taskId = parseTaskId(row.taskId);
    const signals = collectSignalsFromEvents(
      [
        projectEvent(runId, projectId),
        modelRoutedEvent(runId, taskId, {
          model: "cheap",
          modelVersion: "cheap-v1",
          family: "edit",
          featureVersion: "assign-v2"
        }),
        childTaskResult(runId, taskId, row.outcome, row.verification)
      ],
      { episodeId: createEpisodeId() }
    );
    assert.equal(
      signals.some((signal) => signal.criterion === "taskSuccess"),
      false,
      `${row.outcome}/${row.verification} must not write taskSuccess`
    );
  }
});

test("USER_ANSWER is userAcceptance and never taskSuccess", () => {
  const projectId = createProjectId();
  const runId = createRunId();
  const taskId = parseTaskId("tsk_user");
  const signals = collectSignalsFromEvents(
    [
      projectEvent(runId, projectId),
      modelRoutedEvent(runId, taskId, {
        model: "cheap",
        modelVersion: "cheap-v1",
        family: "edit",
        featureVersion: "assign-v2"
      }),
      makeEvent(runId, "USER_ANSWER", { messageId: "msg_q1", answer: "lgtm, ship it" })
    ],
    { episodeId: createEpisodeId() }
  );
  assert.ok(signals.length >= 1);
  assert.ok(signals.every((signal) => signal.criterion !== "taskSuccess"));
  const user = signals.find((signal) => signal.source === "user");
  assert.equal(user?.criterion, "userAcceptance");
  assert.equal(user?.modelId, undefined);
});

test("JUDGE_DECISION is policyCompliance and never taskSuccess", () => {
  const projectId = createProjectId();
  const runId = createRunId();
  const taskId = parseTaskId("tsk_judge");
  const signals = collectSignalsFromEvents(
    [
      projectEvent(runId, projectId),
      modelRoutedEvent(runId, taskId, {
        model: "cheap",
        modelVersion: "cheap-v1",
        family: "edit",
        featureVersion: "assign-v2"
      }),
      makeEvent(runId, "JUDGE_DECISION", {
        taskId,
        verdict: "REJECTED",
        evidenceIds: ["evd_j1"]
      })
    ],
    { episodeId: createEpisodeId() }
  );
  assert.ok(signals.length >= 1);
  assert.ok(signals.every((signal) => signal.criterion !== "taskSuccess"));
  const judge = signals.find((signal) => signal.kind === "judge");
  assert.equal(judge?.criterion, "policyCompliance");
});

test("TRACKING_ASSESSMENT is not collected and does not write taskSuccess", () => {
  const projectId = createProjectId();
  const runId = createRunId();
  const signals = collectSignalsFromEvents(
    [
      projectEvent(runId, projectId),
      makeEvent(runId, "TRACKING_ASSESSMENT", {
        assessment: { score: 0.91, P: 0.8, H: 0.7 },
        assessmentHash: "hash_tracking",
        seq: 0
      })
    ],
    { episodeId: createEpisodeId() }
  );
  assert.equal(signals.length, 0);
  assert.ok(signals.every((signal) => signal.criterion !== "taskSuccess"));
});

test("Pi unknown-agent process exit does not write taskSuccess", () => {
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
  assert.ok((signals[0]?.score ?? 100) < 40);
  assert.equal(signals[0]?.criterion, undefined);
  assert.equal(signals[0]?.outcomeKind, undefined);
});

test("task-success adapter and signals collector do not import r1", async () => {
  const adapter = await readFile(new URL("../../../src/learning/task-success.ts", import.meta.url), "utf8");
  const signals = await readFile(new URL("../../../src/learning/signals.ts", import.meta.url), "utf8");
  assert.doesNotMatch(adapter, /routing\/r1/);
  assert.doesNotMatch(signals, /routing\/r1/);
});

function projectEvent(runId: ReturnType<typeof createRunId>, projectId: ReturnType<typeof createProjectId>): Event {
  return makeEvent(runId, "PROJECT_DISCOVERED", {
    project: {
      id: projectId,
      rootPath: "E:/proj",
      discoveredAt: nowIso(),
      instructionFiles: [],
      manifests: [],
      commands: [],
      facts: []
    }
  });
}

function modelRoutedEvent(
  runId: ReturnType<typeof createRunId>,
  taskId: ReturnType<typeof parseTaskId>,
  route: { model: string; modelVersion: string; family: string; featureVersion: string }
): Event {
  return makeEvent(runId, "MODEL_ROUTED", {
    taskId,
    role: "actor",
    complexity: "MEDIUM",
    model: route.model,
    justification: "cheapest eligible",
    confidence: 0.9,
    approvalPlan: { id: "ap_1", actions: [{ id: "go", label: "go" }], defaultActionIds: ["go"] },
    statusAfterRoute: "RUNNING",
    policyVersion: "v1",
    estimatedCostUsd: 0.01,
    estimatedDurationMs: 1000,
    family: route.family,
    featureVersion: route.featureVersion,
    modelVersion: route.modelVersion,
    highRisk: false,
    eligibleModels: [route.model],
    rejections: [],
    behaviorDistribution: { [route.model]: 1 }
  });
}

function childTaskResult(
  runId: ReturnType<typeof createRunId>,
  taskId: ReturnType<typeof parseTaskId>,
  outcome: TaskOutcome,
  verification: VerificationKind
): Event {
  return makeEvent(runId, "CHILD_MESSAGE", {
    message: {
      protocolVersion: 1,
      id: "msg_result1",
      occurredAt: nowIso(),
      runId,
      taskId,
      from: "agt_child",
      to: "SUPERVISOR",
      type: "TASK_RESULT",
      outcome,
      summary: `${outcome} ${verification}`,
      artifactIds: [],
      evidenceIds: [],
      verification: { kind: verification, evidenceIds: [] }
    }
  });
}

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
