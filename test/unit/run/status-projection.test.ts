import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentInstanceId, createInvocationId, createMessageId, createRunId, createTaskId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { SUPERVISOR, type CriterionVerification, type TaskResult } from "../../../src/protocol/v1.js";
import type { ChildInspection } from "../../../src/run/inspection.js";
import { buildRunStatusProjection } from "../../../src/run/projection.js";
import type { ModelInvocation } from "../../../src/telemetry/model-invocation.js";
import { validateInvocation } from "../../../src/telemetry/model-invocation.js";
import { makeEvent } from "../../helpers/event-factory.js";

const runId = createRunId(() => "projection");
function child(outcome: ChildInspection["outcome"], criteria?: CriterionVerification[]): ChildInspection {
  const taskId = createTaskId();
  const childRunId = createRunId();
  const terminalResult: TaskResult | undefined = outcome === "RUNNING" || outcome === "TIMEOUT" ? undefined : {
    protocolVersion: 1, id: createMessageId(), occurredAt: parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
    runId: childRunId, taskId, from: createAgentInstanceId(), to: SUPERVISOR,
    type: "TASK_RESULT", outcome, summary: "99 percent complete (not progress authority)",
    artifactIds: [], evidenceIds: [],
    verification: { kind: outcome === "SUCCESS" ? "PASSED" : "UNOBSERVED", evidenceIds: [], ...(criteria ? { criteria } : {}) }
  };
  return { taskId, childRunId, outcome, attempts: 1, messages: [], timedOut: outcome === "TIMEOUT",
    ...(terminalResult ? { terminalResult } : {}) };
}
function invocation(overrides: Partial<ModelInvocation> = {}): ModelInvocation {
  const value: ModelInvocation = {
    id: createInvocationId(), taskId: createTaskId(), runId, agentInstanceId: createAgentInstanceId(),
    config: { provider: "fake", model: "fixture", modelVersion: undefined, parameterHash: "abc123" },
    responseHash: "abc123", tokensIn: 100, tokensOut: 50, latencyMs: 10,
    occurredAt: parseIsoTimestamp("2026-08-12T09:00:00.000Z"), callOutcome: "ok", ...overrides
  };
  validateInvocation(value);
  return value;
}
function input() {
  return { runId, status: "RUNNING" as const, children: [] as ChildInspection[], events: [], truncated: false };
}

test("existing ChildInspection terminal verification survives the projection boundary", () => {
  const children = [child("SUCCESS", [
    { id: "met", kind: "PASSED", evidenceIds: [] },
    { id: "open", kind: "UNOBSERVED", evidenceIds: [] },
    { id: "failed", kind: "FAILED", evidenceIds: [] }
  ]), child("SUCCESS"), child("PARTIAL"), child("CANCELLED"), child("TIMEOUT"), child("RUNNING")];
  const before = JSON.stringify(children);
  const result = buildRunStatusProjection({ ...input(), children });
  assert.equal(result.children[0]?.verification, "PASSED");
  assert.equal(result.children[0]?.verificationSource, "child-report");
  assert.deepEqual(result.children[0]?.unmetCriteria, ["failed"]);
  assert.deepEqual(result.children[0]?.metCriteria, ["met"]);
  assert.equal(result.children[1]?.criteriaReported, false);
  assert.equal(result.progress.criteriaNotReported, 5);
  assert.equal(result.progress.criteriaUnobserved, 1);
  assert.equal(result.progress.succeeded, 2, "counts reported outcomes, not independent acceptance");
  assert.equal(result.progress.partial, 1);
  assert.equal(result.progress.cancelled, 1);
  assert.equal(result.progress.inFlight, 1);
  assert.equal(JSON.stringify(children), before);
  assert.equal("percentComplete" in result, false);
});

test("historical gate causes do not recommend reopening terminal or unblocked runs", () => {
  const events = [makeEvent("GATE_TRANSITION", {
    directive: "queue_analysis", to: "BLOCKED", from: "RUNNING", reasonCode: "REGRESSION_DETECTED",
    turnId: "tsk_b", assessmentHash: "deadbeef", seq: 1
  }), makeEvent("RUN_BLOCKED", { reason: "ANALYSIS_QUEUED", requiredEvidence: ["evd_old"] })];
  for (const status of ["COMPLETED", "FAILED", "CANCELLED", "RUNNING"] as const) {
    const result = buildRunStatusProjection({ ...input(), status, events, requiredEvidence: ["evd_old"] });
    assert.deepEqual(result.safeNextSteps, []);
    assert.equal(result.blockers.gateCause, undefined);
    assert.deepEqual(result.blockers.requiredEvidence, []);
  }
  const blocked = buildRunStatusProjection({ ...input(), status: "BLOCKED", events });
  assert.equal(blocked.blockers.gateCause?.reasonCode, "REGRESSION_DETECTED");
  assert.deepEqual(blocked.safeNextSteps.map((step) => step.command.split(" ")[0]), ["inspect", "inject", "unblock", "resume"]);
});

test("pending child questions use answer; the clarification-only cannot-continue warning is not universal", () => {
  const pendingQuestions = [{ id: "msg_question", question: "which db?" }];
  const waiting = buildRunStatusProjection({ ...input(), status: "WAITING_FOR_USER", pendingQuestions });
  const step = waiting.safeNextSteps.find((item) => item.command.startsWith("answer"));
  assert.ok(step);
  assert.match(step.command, /msg_question/);
  assert.doesNotMatch(step.note ?? "", /cannot continue|new run/i);
  assert.deepEqual(buildRunStatusProjection({ ...input(), status: "COMPLETED", pendingQuestions }).safeNextSteps, []);
  assert.deepEqual(buildRunStatusProjection({ ...input(), status: "WAITING_FOR_USER" }).safeNextSteps, []);
  assert.match(buildRunStatusProjection({ ...input(), status: "PAUSED" }).safeNextSteps[0]?.command ?? "", /--unpause/);
});

test("cost isolates this run and reports priced subsets without pretending exclusions cost zero", () => {
  const result = buildRunStatusProjection({ ...input(), invocations: [
    invocation({ pricing: { catalogVersion: "prices-v1", inputUsdPerMTok: 2, outputUsdPerMTok: 4 } }),
    invocation({ tokensIn: undefined, tokensOut: undefined }),
    invocation({ callOutcome: "timeout" }), invocation({ callOutcome: undefined }),
    invocation({ runId: createRunId(() => "foreign"), tokensIn: 9999 })
  ] });
  assert.equal(result.cost.known.invocations, 2);
  assert.equal(result.cost.known.withUsage, 1);
  assert.equal(result.cost.known.tokensIn, 100);
  assert.equal(result.cost.known.tokensOut, 50);
  assert.equal(result.cost.known.usd, 0.0004);
  assert.equal(result.cost.unknown.missingUsage, 1);
  assert.equal(result.cost.unknown.excludedNotOk, 1);
  assert.equal(result.cost.unknown.unattributed, 1);
  assert.equal(result.cost.unknown.unpricedInvocations, 1);
});

test("missing, empty, unpriced, partial and explicitly zero usage remain distinct", () => {
  const missing = buildRunStatusProjection(input());
  const empty = buildRunStatusProjection({ ...input(), invocations: [] });
  assert.equal(missing.cost.invocationsAvailable, false);
  assert.equal(empty.cost.invocationsAvailable, true);
  for (const result of [missing, empty]) {
    assert.equal(result.cost.known.tokensIn, undefined);
    assert.equal(result.cost.known.usd, undefined);
  }
  const partial = buildRunStatusProjection({ ...input(), invocations: [invocation({ tokensOut: undefined })] });
  assert.equal(partial.cost.known.usd, undefined);
  assert.equal(partial.cost.unknown.unpricedInvocations, 1);
  const zero = buildRunStatusProjection({ ...input(), invocations: [invocation({ tokensIn: 0, tokensOut: 0,
    pricing: { catalogVersion: "v1", inputUsdPerMTok: 0, outputUsdPerMTok: 0 } })] });
  assert.equal(zero.cost.known.usd, 0);
});

test("event and invocation truncation are independent data-quality flags", () => {
  const result = buildRunStatusProjection({ ...input(), truncated: true, invocationsTruncated: true });
  assert.deepEqual(result.dataQuality, { truncated: true, invocationsTruncated: true });
});
