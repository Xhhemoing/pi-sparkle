import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAgentInstanceId,
  createArtifactId,
  createEvidenceId,
  createMessageId,
  createRunId,
  createTaskId,
  type AgentInstanceId,
  type MessageId,
  type RunId,
  type TaskId
} from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import {
  PROTOCOL_VERSION,
  assertAtMostOneTerminal,
  isAgentMessage,
  isTerminalMessage,
  validateAgentMessage,
  type AgentMessage,
  type TaskRequest,
  type TaskResult
} from "../../../src/protocol/v1.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

const runId: RunId = createRunId(UUID);
const taskId: TaskId = createTaskId(UUID);
const parent: AgentInstanceId = createAgentInstanceId(UUID);
const child: AgentInstanceId = createAgentInstanceId(() => "abcdef01-2345-6789-abcd-ef0123456789");
const occurredAt = parseIsoTimestamp("2026-08-12T09:00:00.000Z");

function base(overrides: Partial<Record<"id" | "runId" | "taskId" | "from" | "to", unknown>> = {}): Record<string, unknown> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    id: overrides.id ?? createMessageId(UUID),
    occurredAt,
    runId: overrides.runId ?? runId,
    taskId: overrides.taskId ?? taskId,
    from: overrides.from ?? child,
    to: overrides.to ?? parent
  };
}

function validRequest(): Record<string, unknown> {
  return {
    ...base(),
    type: "TASK_REQUEST",
    objective: "Implement the parser",
    inputArtifactIds: [createArtifactId(UUID)],
    acceptanceCriteria: [{ id: "ac-1", description: "Parser handles empty input" }],
    limits: { maxAttempts: 2, timeoutMs: 60_000, maxWallTimeMs: 300_000 }
  };
}

function validProgress(): Record<string, unknown> {
  return {
    ...base(),
    type: "PROGRESS",
    status: "WORKING",
    summary: "Reading the module",
    evidenceIds: [createEvidenceId(UUID)]
  };
}

function validQuestion(): Record<string, unknown> {
  return {
    ...base(),
    type: "QUESTION",
    question: "Should I touch the shared helper?",
    options: ["Yes", "No"]
  };
}

function validResult(): Record<string, unknown> {
  return {
    ...base(),
    type: "TASK_RESULT",
    outcome: "SUCCESS",
    summary: "Parser implemented",
    artifactIds: [createArtifactId(UUID)],
    evidenceIds: [createEvidenceId(UUID)],
    verification: { kind: "PASSED", evidenceIds: [createEvidenceId(UUID)] }
  };
}

test("all four protocol v1 message types validate with conforming fixtures", () => {
  for (const message of [validRequest(), validProgress(), validQuestion(), validResult()]) {
    assert.deepEqual(validateAgentMessage(message), message);
    assert.equal(isAgentMessage(message), true);
  }
});

test("only TASK_RESULT is a terminal message", () => {
  const request = validateAgentMessage(validRequest()) as TaskRequest;
  const result = validateAgentMessage(validResult()) as TaskResult;
  assert.equal(isTerminalMessage(request), false);
  assert.equal(isTerminalMessage(validateAgentMessage(validProgress())), false);
  assert.equal(isTerminalMessage(validateAgentMessage(validQuestion())), false);
  assert.equal(isTerminalMessage(result), true);
});

test("malformed base fields are rejected", () => {
  const cases: Array<[string, unknown, RegExp]> = [
    ["protocolVersion", 2, /protocolVersion/],
    ["id", "nope", /id/],
    ["occurredAt", "later", /occurredAt/],
    ["runId", "RUN_x", /runId/],
    ["taskId", "not-an-id", /taskId/],
    ["from", "AGT_x", /from/],
    ["to", "nope", /to/],
    ["type", "YELL", /type/]
  ];
  for (const [field, value, pattern] of cases) {
    const message = { ...validRequest(), [field]: value };
    assert.throws(() => validateAgentMessage(message), pattern, field);
    assert.equal(isAgentMessage(message), false);
  }
});

test("TASK_REQUEST payload validation rejects bad references and limits", () => {
  assert.throws(() => validateAgentMessage({ ...validRequest(), objective: "" }), /objective/);
  assert.throws(() => validateAgentMessage({ ...validRequest(), inputArtifactIds: ["nope"] }), /inputArtifactIds/);
  assert.throws(
    () => validateAgentMessage({ ...validRequest(), acceptanceCriteria: [{ id: "", description: "x" }] }),
    /acceptanceCriteria/
  );
  assert.throws(() => validateAgentMessage({ ...validRequest(), limits: { maxAttempts: 0 } }), /limits/);
  assert.throws(() => validateAgentMessage({ ...validRequest(), limits: "fast" }), /limits/);
});

test("PROGRESS payload validation rejects bad status, empty summary, and bad blocker", () => {
  assert.throws(() => validateAgentMessage({ ...validProgress(), status: "DONE" }), /status/);
  assert.throws(() => validateAgentMessage({ ...validProgress(), summary: "" }), /summary/);
  assert.throws(() => validateAgentMessage({ ...validProgress(), evidenceIds: ["nope"] }), /evidenceIds/);
  assert.throws(
    () => validateAgentMessage({ ...validProgress(), blocker: { kind: "WHATEVER", description: "x" } }),
    /blocker/
  );
});

test("QUESTION payload validation rejects an empty question and bad options", () => {
  assert.throws(() => validateAgentMessage({ ...validQuestion(), question: "" }), /question/);
  assert.throws(() => validateAgentMessage({ ...validQuestion(), options: [""] }), /options/);
});

test("TASK_RESULT payload validation rejects bad outcome, verification, and failure", () => {
  assert.throws(() => validateAgentMessage({ ...validResult(), outcome: "DONE" }), /outcome/);
  assert.throws(() => validateAgentMessage({ ...validResult(), summary: "" }), /summary/);
  assert.throws(() => validateAgentMessage({ ...validResult(), artifactIds: ["nope"] }), /artifactIds/);
  assert.throws(() => validateAgentMessage({ ...validResult(), evidenceIds: [42] }), /evidenceIds/);
  assert.throws(
    () => validateAgentMessage({ ...validResult(), verification: { kind: "MAYBE", evidenceIds: [] } }),
    /verification/
  );
  assert.throws(
    () => validateAgentMessage({ ...validResult(), failure: { category: "WHATEVER" } }),
    /failure/
  );
});

test("assertAtMostOneTerminal rejects duplicate TASK_RESULT messages", () => {
  const one = validateAgentMessage(validResult());
  const two = validateAgentMessage(validResult());
  assert.doesNotThrow(() => assertAtMostOneTerminal([one]));
  assert.doesNotThrow(() => assertAtMostOneTerminal([one, validateAgentMessage(validProgress())]));
  assert.throws(() => assertAtMostOneTerminal([one, two]), /terminal|duplicate|TASK_RESULT/i);
});

test("non-object and non-message values fail closed", () => {
  for (const value of [null, undefined, "TASK_RESULT", 42, [], { type: "TASK_RESULT" }]) {
    assert.equal(isAgentMessage(value), false);
    assert.throws(() => validateAgentMessage(value), /Message|object/i);
  }
});

test("protocol fixtures cover all four message types end to end", () => {
  const messages: AgentMessage[] = [
    validateAgentMessage(validRequest()),
    validateAgentMessage(validProgress()),
    validateAgentMessage(validQuestion()),
    validateAgentMessage(validResult())
  ];
  assert.deepEqual(
    messages.map((m) => m.type),
    ["TASK_REQUEST", "PROGRESS", "QUESTION", "TASK_RESULT"]
  );
  const messageId: MessageId = messages[0]!.id;
  assert.match(messageId, /^msg_/);
});
