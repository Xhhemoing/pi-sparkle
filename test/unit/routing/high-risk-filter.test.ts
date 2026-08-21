import assert from "node:assert/strict";
import { test } from "node:test";
import { RoutingRefusalError } from "../../../src/domain/errors.js";
import { parseTaskId } from "../../../src/domain/ids.js";
import { assignTasks } from "../../../src/routing/assign.js";
import { catalogFromPrimary } from "../../../src/routing/primary-catalog.js";
import { createModelRouter } from "../../../src/supervisor/model-router.js";

test("high-risk live assignment hard-filters to approvedForHighRisk models", () => {
  const catalog = catalogFromPrimary({ primaryModelId: "premium", fastModelId: "cheap" });
  const assignments = assignTasks({
    catalog,
    tasks: [
      {
        taskId: parseTaskId("tsk_prod"),
        role: "implementer",
        objective: "Deploy payment credentials to production"
      }
    ]
  });
  assert.equal(assignments[0]?.decision.model, "premium");
  assert.equal(assignments[0]?.analysis.highRisk, true);
  assert.ok(assignments[0]?.decision.eligibleModels?.includes("premium"));
  assert.ok(!assignments[0]?.decision.eligibleModels?.includes("cheap"));
});

test("high-risk whitelist does not require a high-risk capability string", () => {
  const router = createModelRouter({
    policyVersion: "router-v1",
    models: [
      {
        id: "approved",
        version: "approved-v1",
        roles: ["actor"],
        maxComplexity: "HIGH",
        estimatedCostUsd: 0.5,
        estimatedDurationMs: 1_000,
        approvedForHighRisk: true,
        capabilities: ["tool-use"]
      }
    ]
  });
  const decision = router.route({
    taskId: parseTaskId("tsk_risk_cap"),
    role: "actor",
    complexity: "HIGH",
    modelPolicy: { allowedModels: ["approved"], preferredModel: "approved" },
    highRisk: true,
    limits: { remainingTimeMs: 10_000 }
  });
  assert.equal(decision.model, "approved");
  assert.equal(decision.highRisk, true);
});

test("high-risk with no approved model returns a structured refusal", () => {
  const router = createModelRouter({
    policyVersion: "router-v1",
    models: [
      {
        id: "cheap",
        version: "cheap-v1",
        roles: ["actor"],
        maxComplexity: "HIGH",
        estimatedCostUsd: 0.1,
        estimatedDurationMs: 1000,
        approvedForHighRisk: false
      }
    ]
  });
  assert.throws(
    () =>
      router.route({
        taskId: parseTaskId("tsk_secret"),
        role: "actor",
        complexity: "HIGH",
        modelPolicy: { allowedModels: ["cheap"], preferredModel: "cheap" },
        highRisk: true,
        limits: { remainingTimeMs: 10_000 }
      }),
    (error: unknown) => {
      assert.ok(error instanceof RoutingRefusalError);
      assert.ok(error.refusals.some((row) => row.constraint === "high-risk-approval"));
      return true;
    }
  );
});
