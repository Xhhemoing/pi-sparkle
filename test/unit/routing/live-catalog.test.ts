import assert from "node:assert/strict";
import { test } from "node:test";
import { RoutingRefusalError } from "../../../src/domain/errors.js";
import { parseTaskId } from "../../../src/domain/ids.js";
import { assignTasks } from "../../../src/routing/assign.js";
import type { CatalogModelInput } from "../../../src/routing/catalog-model.js";
import { createModelRouter, type RouteTaskInput } from "../../../src/supervisor/model-router.js";

const limits = { remainingTimeMs: 1_000_000 };

function actorModel(id: string, extra: Partial<CatalogModelInput> = {}): CatalogModelInput {
  return {
    id,
    version: `${id}-v1`,
    roles: ["actor"],
    maxComplexity: "HIGH",
    estimatedCostUsd: extra.estimatedCostUsd ?? 0.1,
    estimatedDurationMs: extra.estimatedDurationMs ?? 1_000,
    ...extra
  };
}

function routeInput(allowedModels: readonly string[], extra: Partial<RouteTaskInput> = {}): RouteTaskInput {
  return {
    taskId: parseTaskId("tsk_live"),
    role: "actor",
    complexity: "LOW",
    modelPolicy: { allowedModels: [...allowedModels] },
    limits,
    ...extra
  };
}

test("forbidden providerPolicy is not live-selected; refusal constraint is provider-policy", () => {
  const router = createModelRouter({
    policyVersion: "router-v1",
    models: [actorModel("rogue", { providerPolicy: "forbidden", estimatedCostUsd: 0.01 })]
  });
  assert.throws(
    () => router.route(routeInput(["rogue"])),
    (error: unknown) => {
      assert.ok(error instanceof RoutingRefusalError);
      assert.ok(error.refusals.some((row) => row.constraint === "provider-policy"));
      return true;
    }
  );
});

test("assignTasks refuses a catalog whose only model is a forbidden provider", () => {
  assert.throws(
    () =>
      assignTasks({
        catalog: {
          policyVersion: "router-v1",
          models: [actorModel("rogue", { providerPolicy: "forbidden", roles: ["actor", "critic"] })]
        },
        tasks: [{ taskId: parseTaskId("tsk_assign"), role: "worker", objective: "Implement a cache helper" }]
      }),
    (error: unknown) => {
      assert.ok(error instanceof RoutingRefusalError);
      assert.ok(error.refusals.some((row) => row.constraint === "provider-policy"));
      return true;
    }
  );
});

test("a forbidden cheaper arm is recorded on MODEL_ROUTED.rejections while an approved model is selected", () => {
  const router = createModelRouter({
    policyVersion: "router-v1",
    models: [
      actorModel("rogue", { providerPolicy: "forbidden", estimatedCostUsd: 0.01 }),
      actorModel("ok", { providerPolicy: "approved", estimatedCostUsd: 0.5 })
    ]
  });
  const decision = router.route(routeInput(["rogue", "ok"]));
  assert.equal(decision.model, "ok");
  assert.ok(decision.rejections.some((row) => row.constraint === "provider-policy" && row.modelId === "rogue"));
  assert.ok(!decision.eligibleModels.includes("rogue"));
});

test("undeclared contextWindow does not invent a window or fail a large contextNeeded filter", () => {
  const router = createModelRouter({
    policyVersion: "router-v1",
    models: [actorModel("open")]
  });
  assert.equal(router.config.models[0]?.contextWindow, undefined);
  const decision = router.route(routeInput(["open"], { contextNeeded: 500_000 }));
  assert.equal(decision.model, "open");
  assert.ok(!decision.rejections.some((row) => row.constraint === "context-window"));
});

test("undeclared maxOutputTokens does not invent a limit or fail a large outputNeeded filter", () => {
  const router = createModelRouter({
    policyVersion: "router-v1",
    models: [actorModel("open")]
  });
  assert.equal(router.config.models[0]?.maxOutputTokens, undefined);
  const decision = router.route(routeInput(["open"], { outputNeeded: 100_000 }));
  assert.equal(decision.model, "open");
  assert.ok(!decision.rejections.some((row) => row.constraint === "max-output"));
});

test("declared contextWindow and maxOutputTokens still filter live candidates", () => {
  const router = createModelRouter({
    policyVersion: "router-v1",
    models: [actorModel("tiny", { contextWindow: 4_000, maxOutputTokens: 2_000 })]
  });
  assert.throws(
    () => router.route(routeInput(["tiny"], { contextNeeded: 100_000 })),
    (error: unknown) => {
      assert.ok(error instanceof RoutingRefusalError);
      assert.ok(error.refusals.some((row) => row.constraint === "context-window"));
      return true;
    }
  );
  assert.throws(
    () => router.route(routeInput(["tiny"], { outputNeeded: 20_000 })),
    (error: unknown) => {
      assert.ok(error instanceof RoutingRefusalError);
      assert.ok(error.refusals.some((row) => row.constraint === "max-output"));
      return true;
    }
  );
});

test("cloud-general cannot serve a local privacy requirement", () => {
  const router = createModelRouter({
    policyVersion: "router-v1",
    models: [actorModel("public", { privacyClass: "cloud-general" })]
  });
  assert.throws(
    () => router.route(routeInput(["public"], { privacyRequired: "local" })),
    (error: unknown) => {
      assert.ok(error instanceof RoutingRefusalError);
      assert.ok(error.refusals.some((row) => row.constraint === "privacy-class"));
      return true;
    }
  );
});

test("undeclared model privacy is not filled as cloud-general and still routes when the task omits privacyRequired", () => {
  const router = createModelRouter({
    policyVersion: "router-v1",
    models: [actorModel("plain")]
  });
  assert.equal(router.config.models[0]?.privacyClass, undefined);
  const decision = router.route(routeInput(["plain"]));
  assert.equal(decision.model, "plain");
});

test("undeclared model privacy cannot serve local", () => {
  const router = createModelRouter({
    policyVersion: "router-v1",
    models: [actorModel("plain")]
  });
  assert.throws(
    () => router.route(routeInput(["plain"], { privacyRequired: "local" })),
    (error: unknown) => {
      assert.ok(error instanceof RoutingRefusalError);
      assert.ok(error.refusals.some((row) => row.constraint === "privacy-class"));
      return true;
    }
  );
});

test("undeclared model privacy skips the privacy-class filter for cloud-approved", () => {
  const router = createModelRouter({
    policyVersion: "router-v1",
    models: [actorModel("plain")]
  });
  const decision = router.route(routeInput(["plain"], { privacyRequired: "cloud-approved" }));
  assert.equal(decision.model, "plain");
  assert.ok(!decision.rejections.some((row) => row.constraint === "privacy-class"));
});

test("task requiredCapabilities must be declared on the model", () => {
  const router = createModelRouter({
    policyVersion: "router-v1",
    models: [actorModel("tools", { capabilities: ["tool-use"] })]
  });
  assert.throws(
    () => router.route(routeInput(["tools"], { requiredCapabilities: ["tool-use", "vision"] })),
    (error: unknown) => {
      assert.ok(error instanceof RoutingRefusalError);
      assert.ok(error.refusals.some((row) => row.constraint === "capability"));
      return true;
    }
  );
});
