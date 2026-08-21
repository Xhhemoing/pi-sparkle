import assert from "node:assert/strict";
import { test } from "node:test";
import { RoutingRefusalError } from "../../../src/domain/errors.js";
import { parseTaskId } from "../../../src/domain/ids.js";
import { createModelRouter } from "../../../src/supervisor/model-router.js";

const wideCheap = {
  id: "wide-cheap",
  version: "wide-cheap-v1",
  roles: ["actor"] as const,
  maxComplexity: "HIGH" as const,
  estimatedCostUsd: 0.1,
  estimatedDurationMs: 1_000,
  privacyClass: "cloud-general" as const
};

const narrowExpensive = {
  id: "narrow-expensive",
  version: "narrow-expensive-v1",
  roles: ["actor"] as const,
  maxComplexity: "LOW" as const,
  estimatedCostUsd: 0.9,
  estimatedDurationMs: 1_000,
  privacyClass: "cloud-general" as const
};

test("without preferred, cheaper wide model beats expensive narrow model", () => {
  const router = createModelRouter({
    policyVersion: "router-v1",
    models: [narrowExpensive, wideCheap]
  });
  const decision = router.route({
    taskId: parseTaskId("tsk_sort"),
    role: "actor",
    complexity: "LOW",
    modelPolicy: { allowedModels: ["wide-cheap", "narrow-expensive"] },
    limits: { remainingTimeMs: 10_000 }
  });
  assert.equal(decision.model, "wide-cheap");
  assert.equal(decision.behaviorDistribution["wide-cheap"], 1);
  assert.equal(decision.behaviorDistribution["narrow-expensive"], 0);
  assert.match(decision.justification, /wide-cheap/);
});

test("preferred constraint is recorded and wins over cheaper eligible", () => {
  const router = createModelRouter({
    policyVersion: "router-v1",
    models: [narrowExpensive, wideCheap]
  });
  const decision = router.route({
    taskId: parseTaskId("tsk_pref"),
    role: "actor",
    complexity: "LOW",
    modelPolicy: { allowedModels: ["wide-cheap", "narrow-expensive"], preferredModel: "narrow-expensive" },
    limits: { remainingTimeMs: 10_000 }
  });
  assert.equal(decision.model, "narrow-expensive");
  assert.equal(decision.preferredConstraint, "narrow-expensive");
  assert.match(decision.justification, /preferred constraint/);
});

test("privacy-class rejection appears in the refusal matrix", () => {
  const router = createModelRouter({
    policyVersion: "router-v1",
    models: [
      {
        ...wideCheap,
        privacyClass: "cloud-general"
      }
    ]
  });
  assert.throws(
    () =>
      router.route({
        taskId: parseTaskId("tsk_priv"),
        role: "actor",
        complexity: "LOW",
        modelPolicy: { allowedModels: ["wide-cheap"] },
        privacyRequired: "local",
        limits: { remainingTimeMs: 10_000 }
      }),
    (error: unknown) => {
      assert.ok(error instanceof RoutingRefusalError);
      assert.ok(error.refusals.some((row) => row.constraint === "privacy-class"));
      return true;
    }
  );
});

test("missing model version fails closed", () => {
  assert.throws(
    () =>
      createModelRouter({
        policyVersion: "router-v1",
        models: [
          {
            id: "no-ver",
            roles: ["actor"],
            maxComplexity: "LOW",
            estimatedCostUsd: 0.1,
            estimatedDurationMs: 1_000
          }
        ]
      }),
    /must declare version/
  );
});
