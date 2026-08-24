import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
import { DomainValidationError } from "../../../src/domain/errors.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import {
  PROTOCOL_VERSION,
  assertAtMostOneTerminal,
  isAgentMessage,
  isApprovalReply,
  isTerminalMessage,
  validateAgentMessage,
  validateApprovalReply,
  validateApprovalReplyForPlan,
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

function validPeer(): Record<string, unknown> {
  return {
    ...base({ to: "SUPERVISOR" }),
    type: "PEER_MESSAGE",
    body: "found three candidate files",
    addressRole: "implementer"
  };
}

test("all protocol v1 message types validate with conforming fixtures", () => {
  for (const message of [validRequest(), validProgress(), validQuestion(), validPeer(), validResult()]) {
    assert.deepEqual(validateAgentMessage(message), message);
    assert.equal(isAgentMessage(message), true);
  }
});

test("proto-pollution keys remain inert protocol data", () => {
  const message = validRequest();
  Object.defineProperties(message, {
    ["__proto__"]: {
      value: { polluted: true },
      enumerable: true,
      configurable: true,
      writable: true
    },
    constructor: {
      value: { prototype: { polluted: true } },
      enumerable: true,
      configurable: true,
      writable: true
    }
  });

  const validated = validateAgentMessage(message);
  assert.equal(Object.hasOwn(validated, "__proto__"), true);
  assert.equal(Object.hasOwn(validated, "constructor"), true);
  assert.equal(Object.getPrototypeOf(validated), Object.prototype);
  assert.equal(({} as { polluted?: unknown }).polluted, undefined);
});

test("only TASK_RESULT is a terminal message", () => {
  const request = validateAgentMessage(validRequest()) as TaskRequest;
  const result = validateAgentMessage(validResult()) as TaskResult;
  assert.equal(isTerminalMessage(request), false);
  assert.equal(isTerminalMessage(validateAgentMessage(validProgress())), false);
  assert.equal(isTerminalMessage(validateAgentMessage(validQuestion())), false);
  assert.equal(isTerminalMessage(validateAgentMessage(validPeer())), false);
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

const approvalPlan = {
  id: "plan-1",
  items: [
    { id: "one", label: "First action", selectable: true, defaultSelected: true },
    { id: "two", label: "Second action", selectable: true },
    { id: "fixed", label: "Always applied", selectable: false }
  ]
};

test("TASK_REQUEST carries a validated selectable ApprovalPlan", () => {
  const request = { ...validRequest(), approvalPlan };
  assert.deepEqual(validateAgentMessage(request), request);
  assert.throws(() => validateAgentMessage({ ...request, approvalPlan: { ...approvalPlan, id: "" } }), /approvalPlan/i);
  assert.throws(() => validateAgentMessage({ ...request, approvalPlan: { items: approvalPlan.items } }), /approvalPlan/i);
  assert.throws(
    () => validateAgentMessage({ ...request, approvalPlan: { id: "p", items: [{ id: "one", label: "", selectable: true }] } }),
    /approvalPlan/i
  );
  assert.throws(
    () => validateAgentMessage({ ...request, approvalPlan: { id: "p", items: [{ id: "x", label: "X", selectable: false, defaultSelected: true }] } }),
    /approvalPlan/i
  );
});

test("ApprovalReply validates its own shape and correlates with an authoritative plan", () => {
  const reply = { approvalPlanId: "plan-1", selectedActionIds: ["two"] };
  assert.deepEqual(validateApprovalReply(reply), reply);
  assert.equal(isApprovalReply(reply), true);

  for (const bad of [
    { approvalPlanId: "", selectedActionIds: ["two"] },
    { approvalPlanId: "plan-1", selectedActionIds: ["two", "two"] },
    { approvalPlanId: "plan-1", selectedActionIds: [3] },
    { approvalPlanId: "plan-1" },
    null
  ]) {
    assert.equal(isApprovalReply(bad), false);
    assert.throws(() => validateApprovalReply(bad), /ApprovalReply/i);
  }

  assert.deepEqual(validateApprovalReplyForPlan(approvalPlan, reply), reply);
  assert.throws(
    () => validateApprovalReplyForPlan(approvalPlan, { ...reply, approvalPlanId: "plan-2" }),
    /does not match the pending plan/i
  );
  assert.throws(
    () => validateApprovalReplyForPlan(approvalPlan, { ...reply, selectedActionIds: ["fixed"] }),
    /non-selectable/i
  );
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

test("QUESTION carries an optional confidence, rationale, and approval plan", () => {
  const question = {
    ...validQuestion(),
    confidence: 0.42,
    rationale: "The refactor touches a shared helper",
    approvalPlan
  };
  assert.deepEqual(validateAgentMessage(question), question);
  // M1 questions without any of the new fields stay valid.
  assert.doesNotThrow(() => validateAgentMessage(validQuestion()));

  assert.throws(() => validateAgentMessage({ ...question, confidence: 1.5 }), /confidence/i);
  assert.throws(() => validateAgentMessage({ ...question, confidence: -0.1 }), /confidence/i);
  assert.throws(() => validateAgentMessage({ ...question, confidence: Number.NaN }), /confidence/i);
  assert.throws(() => validateAgentMessage({ ...question, confidence: "high" }), /confidence/i);
  assert.throws(() => validateAgentMessage({ ...question, rationale: "" }), /rationale/i);
  assert.throws(() => validateAgentMessage({ ...question, approvalPlan: { ...approvalPlan, items: [] } }), /approvalPlan/i);
  assert.throws(() => validateAgentMessage({ ...question, approvalPlan: { id: "p" } }), /approvalPlan/i);
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

test("assertAtMostOneTerminal rejects duplicate terminals at the first and last index", () => {
  const first = validateAgentMessage(validResult());
  const middle = validateAgentMessage(validProgress());
  const last = validateAgentMessage(validResult());
  assert.throws(
    () => assertAtMostOneTerminal([first, middle, last]),
    (error: unknown) => error instanceof Error && error.constructor === DomainValidationError
  );
});

test("maxCostUsd is declared with its non-enforcement disclosed, and nothing reads it", async () => {
  const limits = { maxAttempts: 1, timeoutMs: 1_000, maxWallTimeMs: 1_000, maxCostUsd: 0.000_001 };
  assert.doesNotThrow(() => validateAgentMessage({ ...validRequest(), limits }));

  const protocolSource = await readFile(new URL("../../../src/protocol/v1.ts", import.meta.url), "utf8");
  assert.match(protocolSource, /maxCostUsd[\s\S]{0,400}?not enforced/);
  const coordinatorSource = await readFile(
    new URL("../../../src/run/child-coordinator.ts", import.meta.url),
    "utf8"
  );
  assert.ok(
    !/limits\.maxCostUsd/.test(coordinatorSource),
    "the coordinator reads maxCostUsd: enforcement now exists and the disclosure must be rewritten"
  );
});

test("assertAtMostOneTerminal rejects malformed entries with exactly DomainValidationError", () => {
  assert.throws(
    () => assertAtMostOneTerminal([null] as unknown as AgentMessage[]),
    (error: unknown) => error instanceof Error && error.constructor === DomainValidationError
  );
});

test("oversized arrays complete with DomainValidationError discipline", () => {
  const evidenceId = createEvidenceId(UUID);
  const oversizedEvidenceIds = Array.from({ length: 10_000 }, () => evidenceId);
  const oversizedProgress = { ...validProgress(), evidenceIds: oversizedEvidenceIds };
  const validatedProgress = validateAgentMessage(oversizedProgress);
  assert.ok(validatedProgress.type === "PROGRESS");
  assert.equal(validatedProgress.evidenceIds.length, oversizedEvidenceIds.length);

  assert.throws(
    () => validateAgentMessage({ ...oversizedProgress, evidenceIds: [...oversizedEvidenceIds, null] }),
    (error: unknown) => error instanceof Error && error.constructor === DomainValidationError
  );

  const progress = validateAgentMessage(validProgress());
  const oversizedMessageArray = Array.from({ length: 10_000 }, () => progress);
  assert.doesNotThrow(() => assertAtMostOneTerminal(oversizedMessageArray));
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
