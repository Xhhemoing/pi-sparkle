import assert from "node:assert/strict";
import { test } from "node:test";
import { createEmptyContext } from "../../../src/context/index.js";
import { compileContextPacket, estimateTokens, type ContextRequest } from "../../../src/context/packet.js";
import { createProjectId, createTaskId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";

function request(): ContextRequest {
  return {
    taskId: createTaskId(() => "admission"),
    index: createEmptyContext(createProjectId(() => "admission"), parseIsoTimestamp("2026-09-29T00:00:00.000Z")),
    contract: { schemaVersion: 1, objective: "Inspect", deliverables: [], constraints: [], nonGoals: [],
      acceptanceCriteria: [], assumptions: [], questions: [], authority: [], sourceRefs: [] },
    tokenBudget: 1000, selectorVersion: 1
  };
}

test("packet budgets refuse negative, non-finite, fractional and unsafe values", () => {
  for (const tokenBudget of [-1, NaN, Infinity, -Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => compileContextPacket({ ...request(), tokenBudget }), /CONTEXT_INVALID_BUDGET/);
  }
  assert.deepEqual(compileContextPacket({ ...request(), tokenBudget: 0 }).requiredFacts, []);
});

test("mandatory budget refusal discloses counts but never constraint content", () => {
  const req = request();
  const secret = "private-boundary-must-not-leak";
  assert.throws(() => compileContextPacket({ ...req, tokenBudget: 1,
    contract: { ...req.contract, constraints: [{ id: "private", description: secret, enforceable: true }] }
  }), (error: unknown) => error instanceof Error && /CONTEXT_MANDATORY_BUDGET_EXCEEDED/.test(error.message)
    && !error.message.includes(secret) && !error.message.includes("private"));
});

test("mandatory admission is all-or-nothing at the exact budget boundary", () => {
  const req = request();
  const contract = { ...req.contract, constraints: [
    { id: "a", description: "abcd", enforceable: true },
    { id: "b", description: "efgh", enforceable: true }
  ] };
  assert.throws(() => compileContextPacket({ ...req, contract, tokenBudget: 1 }), /CONTEXT_MANDATORY_BUDGET_EXCEEDED/);
  const packet = compileContextPacket({ ...req, contract, tokenBudget: 2 });
  assert.deepEqual(packet.requiredFacts, ["abcd", "efgh"]);
  assert.deepEqual(packet.omissions, []);
});

test("non-goals and instruction references survive or refuse instead of dropping", () => {
  const req = request();
  const contract = { ...req.contract, nonGoals: ["Do not upgrade dependencies"] };
  const index = { ...req.index, instructionPrecedence: ["/project/AGENTS.md"] };
  const packet = compileContextPacket({ ...req, contract, index });
  assert.ok(packet.requiredFacts.some((fact) => fact.includes("Do not upgrade dependencies")));
  assert.deepEqual(packet.relevantFiles, ["/project/AGENTS.md"]);
  assert.throws(() => compileContextPacket({ ...req, contract, index, tokenBudget: 1 }), /CONTEXT_MANDATORY_BUDGET_EXCEEDED/);
});

test("all existing mandatory categories refuse insufficient budgets", () => {
  const req = request();
  const cases: ContextRequest[] = [
    { ...req, contract: { ...req.contract, authority: [{ scope: "src", actions: ["read"] }] } },
    { ...req, contract: { ...req.contract, questions: [{ id: "q", question: "Which version?", options: ["v1", "v2"] }] } },
    { ...req, index: { ...req.index, validationRoutes: ["test"] } },
    { ...req, dependencyOutputs: ["a predecessor result"] }
  ];
  for (const item of cases) {
    assert.throws(() => compileContextPacket({ ...item, tokenBudget: 0 }), /CONTEXT_MANDATORY_BUDGET_EXCEEDED/);
  }
});

test("identical constraints dedupe but conflicting mandatory keys refuse", () => {
  const req = request();
  const one = { id: "limit", description: "read only", enforceable: true };
  const contract = { ...req.contract, constraints: [one, one] };
  assert.deepEqual(compileContextPacket({ ...req, contract }).requiredFacts, ["read only"]);
  assert.throws(() => compileContextPacket({ ...req, contract: { ...contract,
    constraints: [one, { ...one, description: "write allowed" }]
  } }), /CONTEXT_MANDATORY_CONFLICT/);
  assert.throws(() => compileContextPacket({ ...req, contract: { ...req.contract, authority: [
    { scope: "src", actions: ["read"] }, { scope: "src", actions: ["write"] }
  ] } }), /CONTEXT_MANDATORY_CONFLICT/);
});

test("ASCII estimates stay compatible and non-ASCII code points have an explicit cost", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcde"), 2);
  assert.equal(estimateTokens("\u53ea\u8bfb"), 4);
  assert.equal(estimateTokens("abcd\u53ea\u8bfb"), 5);
  assert.equal(estimateTokens("\u{1f642}"), 2);
  const req = request();
  assert.throws(() => compileContextPacket({ ...req, tokenBudget: 1, contract: { ...req.contract,
    constraints: [{ id: "readonly", description: "\u53ea\u8bfb", enforceable: true }]
  } }), /CONTEXT_MANDATORY_BUDGET_EXCEEDED/);
});

test("optional omissions and unavailable default routes remain explicit", () => {
  const req = request();
  const packet = compileContextPacket({ ...req, tokenBudget: 0, index: { ...req.index,
    risks: ["optional context"], facts: [{ key: "validation.route:test", value: "unavailable",
      trust: "unavailable", freshness: "unavailable", sourceHash: "fixture" }]
  } });
  assert.ok(packet.omissions.some((item) => item.reason === "unavailable"));
  assert.ok(packet.omissions.some((item) => item.reason === "token-budget"));
});
