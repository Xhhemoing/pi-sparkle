import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTaskId } from "../../../src/domain/ids.js";
import { RoutingRefusalError } from "../../../src/domain/errors.js";
import { assignStaticTasks, assignStaticOne } from "../../../src/routing/static-assign.js";
import { createModelRouter } from "../../../src/supervisor/model-router.js";

const catalog = { policyVersion: "static-test", models: [
  { id: "cheap", version: "cheap-v1", roles: ["actor", "critic"] as const, maxComplexity: "MEDIUM" as const,
    estimatedCostUsd: 0.1, estimatedDurationMs: 100, capabilities: ["tool-use"], privacyClass: "cloud-general" as const,
    approvedForHighRisk: false, contextWindow: 100, maxOutputTokens: 10 },
  { id: "premium", version: "premium-v1", roles: ["actor", "critic", "judge", "router"] as const, maxComplexity: "HIGH" as const,
    estimatedCostUsd: 0.5, estimatedDurationMs: 500, capabilities: ["tool-use", "vision"], privacyClass: "cloud-general" as const,
    approvedForHighRisk: true, contextWindow: 100, maxOutputTokens: 10 }
] };

test("static assignment retains ordinary cheap, high-risk primary and vision-capable selection", () => {
  const actual = assignStaticTasks({ catalog, tasks: [
    { taskId: parseTaskId("tsk_scout"), role: "scout", objective: "Survey parser" },
    { taskId: parseTaskId("tsk_prod"), role: "implementer", objective: "Deploy production credentials" },
    { taskId: parseTaskId("tsk_vision"), role: "worker", objective: "Inspect screenshot" }
  ] });
  assert.deepEqual(actual.map((assignment) => assignment.decision.model), ["cheap", "premium", "premium"]);
  assert.deepEqual(actual.map((assignment) => assignment.decision.statusAfterRoute), ["RUNNING", "WAITING_FOR_USER", "RUNNING"]);
  assert.ok(actual.every((assignment) => assignment.decision.featureVersion === "assign-v5"));
});

test("static single-task assignment preserves a singleton model policy", () => {
  const assignment = assignStaticOne(createModelRouter(catalog), ["premium"],
    { taskId: parseTaskId("tsk_pinned"), role: "scout", objective: "Survey parser" });
  assert.equal(assignment.decision.model, "premium");
  assert.deepEqual(assignment.allowedModels, ["premium"]);
  assert.deepEqual(assignment.decision.eligibleModels, ["premium"]);
});

for (const example of [
  { constraint: "privacy-class", objective: "Inspect parser; must stay local" },
  { constraint: "context-window", contextTokens: 101 },
  { constraint: "max-output", outputTokens: 11 },
  { constraint: "budget", remainingCostUsd: 0.09 },
  { constraint: "deadline", remainingTimeMs: 99 }
]) test(`static assignment retains the existing ${example.constraint} refusal`, () => {
  assert.throws(() => assignStaticTasks({ catalog,
    tasks: [{ taskId: parseTaskId("tsk_refused"), role: "scout", objective: example.objective ?? "Inspect parser",
      ...(example.contextTokens !== undefined ? { contextTokens: example.contextTokens } : {}),
      ...(example.outputTokens !== undefined ? { outputTokens: example.outputTokens } : {}) }],
    ...(example.remainingCostUsd !== undefined ? { remainingCostUsd: example.remainingCostUsd } : {}),
    ...(example.remainingTimeMs !== undefined ? { remainingTimeMs: example.remainingTimeMs } : {})
  }), (error) => error instanceof RoutingRefusalError && error.refusals.some((item) => item.constraint === example.constraint));
});
