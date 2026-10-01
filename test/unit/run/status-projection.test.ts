// RUN_STATUS_PROJECTION is a second frozen-additive machine-readable surface,
// like INSPECT_SUMMARY before it. These tests pin the whole shape from day one:
// per-child verification with UNOBSERVED as its own count, blockers, known vs
// unknown cost, explicit truncation, and safe next steps restricted to verbs
// that exist. Existing keys never change meaning; new keys arrive only in a
// diff that updates these pins.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentInstanceId, createMessageId, createRunId, createTaskId } from "../../../src/domain/ids.js";
import type { AgentExecutionRequest } from "../../../src/execution/contract.js";
import { SUPERVISOR, type TaskResult } from "../../../src/protocol/v1.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import type { ModelInvocation } from "../../../src/telemetry/model-invocation.js";
import { gateBlockCause } from "../../../src/run/inspection.js";
import { makeEvent } from "../../helpers/event-factory.js";
import {
  buildRunStatusProjection,
  type ProjectionChildInput
} from "../../../src/run/projection.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";
const runId = createRunId(UUID);

function request(taskKey: string, childRun: string): AgentExecutionRequest {
  return {
    protocolVersion: 1,
    id: createMessageId(UUID),
    occurredAt: parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
    runId: createRunId(() => childRun),
    taskId: createTaskId(() => taskKey),
    from: SUPERVISOR,
    to: "worker",
    type: "TASK_REQUEST",
    prompt: "fixture",
    workingDirectory: ".",
    agentInstanceId: createAgentInstanceId(UUID)
  } as AgentExecutionRequest;
}

function resultMessage(
  req: AgentExecutionRequest,
  outcome: "SUCCESS" | "FAILURE",
  criteria?: TaskResult["verification"]["criteria"]
): TaskResult {
  return {
    protocolVersion: 1,
    id: createMessageId(UUID),
    occurredAt: parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
    runId: req.runId,
    taskId: req.taskId,
    from: req.agentInstanceId,
    to: SUPERVISOR,
    type: "TASK_RESULT",
    outcome,
    summary: outcome === "SUCCESS" ? "done" : "failed",
    artifactIds: [],
    evidenceIds: [],
    verification: {
      kind: outcome === "SUCCESS" ? "PASSED" : "FAILED",
      evidenceIds: [],
      ...(criteria !== undefined ? { criteria } : {})
    },
    ...(outcome === "FAILURE" ? { failure: { category: "TOOL_ERROR", detail: "boom" } } : {})
  };
}

function child(
  taskKey: string,
  childRun: string,
  outcome: ProjectionChildInput["outcome"],
  criteria?: TaskResult["verification"]["criteria"]
): ProjectionChildInput {
  if (outcome === "RUNNING") {
    return { taskId: createTaskId(() => taskKey), childRunId: createRunId(() => childRun), outcome, verification: undefined, unmetCriteria: [] };
  }
  const terminal = resultMessage(request(taskKey, childRun), outcome === "SUCCESS" ? "SUCCESS" : "FAILURE", criteria);
  return {
    taskId: terminal.taskId,
    childRunId: terminal.runId,
    outcome,
    verification: terminal.verification.kind,
    unmetCriteria: (criteria ?? []).filter((c) => c.kind === "FAILED").map((c) => c.id)
  };
}

function invocation(overrides: Partial<ModelInvocation> = {}): ModelInvocation {
  return {
    id: `inv_${UUID()}` as never,
    taskId: createTaskId(UUID),
    runId,
    agentInstanceId: createAgentInstanceId(UUID),
    config: { modelId: "cheap", purpose: "child" } as never,
    responseHash: "abc12345",
    tokensIn: 100,
    tokensOut: 50,
    latencyMs: 10,
    occurredAt: parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
    callOutcome: "ok",
    ...overrides
  };
}

test("mixed outcomes roll up with UNOBSERVED as its own count, never folded into success", () => {
  const projection = buildRunStatusProjection({
    runId,
    status: "RUNNING",
    children: [
      child("tsk_a", "aaaaaaaa-2222-3333-4444-555555555555", "SUCCESS"),
      child("tsk_b", "bbbbbbbb-2222-3333-4444-555555555555", "FAILURE"),
      child("tsk_c", "cccccccc-2222-3333-4444-555555555555", "RUNNING")
    ],
    events: [],
    truncated: false
  });
  assert.equal(projection.type, "RUN_STATUS_PROJECTION");
  assert.equal(projection.runId, runId);
  assert.equal(projection.progress.total, 3);
  assert.equal(projection.progress.succeeded, 1);
  assert.equal(projection.progress.failed, 1);
  assert.equal(projection.progress.unobserved, 0);
  assert.equal(projection.progress.inFlight, 1);
});

test("a PASSED child without per-criterion data counts unobserved, not unmet", () => {
  const projection = buildRunStatusProjection({
    runId,
    status: "RUNNING",
    children: [
      child("tsk_a", "aaaaaaaa-2222-3333-4444-555555555555", "SUCCESS"),
      child("tsk_b", "bbbbbbbb-2222-3333-4444-555555555555", "FAILURE", [
        { id: "ac-1", kind: "FAILED", evidenceIds: [] },
        { id: "ac-2", kind: "UNOBSERVED", evidenceIds: [] }
      ])
    ],
    events: [],
    truncated: false
  });
  assert.equal(projection.progress.succeeded, 1);
  assert.equal(projection.progress.failed, 1);
  const failed = projection.children.find((c) => c.outcome === "FAILURE");
  assert.deepEqual(failed?.unmetCriteria, ["ac-1"]);
  assert.equal(projection.progress.criteriaUnobserved, 1);
});

test("gate-blocked runs name the cause and route only to verbs that exist", () => {
  const events = [
    makeEvent("GATE_TRANSITION", {
      directive: "queue_analysis",
      to: "BLOCKED",
      from: "RUNNING",
      reasonCode: "REGRESSION_DETECTED",
      turnId: "tsk_b",
      assessmentHash: "deadbeef",
      seq: 1
    }),
    makeEvent("RUN_BLOCKED", { reason: "ANALYSIS_QUEUED", requiredEvidence: ["evd_1"] })
  ];
  const projection = buildRunStatusProjection({
    runId,
    status: "BLOCKED",
    children: [],
    events,
    truncated: false
  });
  assert.equal(projection.blockers.gateCause?.reasonCode, "REGRESSION_DETECTED");
  const nexts = projection.safeNextSteps.map((step) => step.command);
  assert.ok(nexts.every((c) => /^(inspect|inject|unblock|resume|answer)\b/.test(c)), "no invented verbs");
  assert.ok(projection.safeNextSteps.some((s) => s.command.startsWith("unblock")));
  assert.ok(!projection.safeNextSteps.some((s) => s.command.startsWith("answer")));
});

test("pending questions route to answer with the cannot-continue caveat", () => {
  const projection = buildRunStatusProjection({
    runId,
    status: "WAITING_FOR_USER",
    children: [],
    events: [],
    pendingQuestions: [{ id: "msg_1", question: "which db?" }],
    truncated: false
  });
  const answer = projection.safeNextSteps.find((s) => s.command.startsWith("answer"));
  assert.ok(answer !== undefined);
  assert.match(answer.note ?? "", /cannot continue/i);
});

test("cost splits known from unknown; no data never prints as zero", () => {
  const invocations = [
    invocation(),
    invocation({ id: `inv_${UUID()}` as never, callOutcome: "timeout" }),
    invocation({ id: `inv_${UUID()}` as never, tokensIn: undefined, tokensOut: undefined })
  ];
  const projection = buildRunStatusProjection({
    runId,
    status: "COMPLETED",
    children: [],
    events: [],
    invocations,
    truncated: false
  });
  assert.equal(projection.cost.known.invocations, 1);
  assert.equal(projection.cost.known.tokensIn, 100);
  assert.equal(projection.cost.known.tokensOut, 50);
  assert.equal(projection.cost.unknown.excludedNotOk, 1);
  assert.equal(projection.cost.unknown.missingUsage, 1);
  assert.equal(projection.cost.unknown.unattributed, 0);
});

test("an absent invocation log is explicit, never zero cost", () => {
  const projection = buildRunStatusProjection({
    runId,
    status: "COMPLETED",
    children: [],
    events: [],
    invocations: undefined,
    truncated: false
  });
  assert.equal(projection.cost.invocationsAvailable, false);
  assert.equal(projection.cost.known.invocations, 0);
  assert.equal(projection.cost.unknown.missingUsage, 0);
});

test("a crash-truncated tail sets the flag instead of hiding", () => {
  const projection = buildRunStatusProjection({
    runId,
    status: "FAILED",
    children: [],
    events: [],
    truncated: true
  });
  assert.equal(projection.dataQuality.truncated, true);
});

test("no terminal status is invented and no percent is accepted", () => {
  const projection = buildRunStatusProjection({
    runId,
    status: "RUNNING",
    children: [child("tsk_a", "aaaaaaaa-2222-3333-4444-555555555555", "RUNNING")],
    events: [],
    truncated: false
  });
  assert.equal("percentComplete" in projection, false);
  assert.equal(projection.status, "RUNNING");
});
