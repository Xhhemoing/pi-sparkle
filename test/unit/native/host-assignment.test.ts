import assert from "node:assert/strict";
import { test } from "node:test";
import { createTaskId } from "../../../src/domain/ids.js";
import { RoutingRefusalError } from "../../../src/domain/errors.js";
import type { AssignableTask } from "../../../src/routing/assign.js";
import { catalogModel, type CatalogModelInput } from "../../../src/routing/catalog-model.js";
import { assignHostPinnedTasks } from "../../../src/native/host-assignment.js";
import type { NativeRoutingCatalog } from "../../../src/native/routing-catalog.js";

const PINNED = "host/selected", OTHER = "host/cheaper";
function catalog(overrides: Partial<CatalogModelInput> = {}): NativeRoutingCatalog {
  const row = catalogModel({ id: PINNED, version: "host", providerId: "host", roles: ["actor", "critic"],
    maxComplexity: "HIGH", estimatedCostUsd: 0.1, estimatedDurationMs: 100,
    capabilities: ["tool-use"], privacyClass: "cloud-general", approvedForHighRisk: true,
    contextWindow: 100, maxOutputTokens: 10, inputCostPerMTok: 1, outputCostPerMTok: 1, ...overrides });
  return { primary: PINNED, fast: OTHER, aliases: { cheap: OTHER, premium: PINNED }, config: {
    policyVersion: "host-test", models: [row, { ...row, id: OTHER, estimatedCostUsd: 0.001,
      contextWindow: 10000, maxOutputTokens: 10000, approvedForHighRisk: true,
      roles: ["actor", "critic"], maxComplexity: "HIGH", capabilities: ["tool-use"], privacyClass: "local" }]
  } };
}
const task = (overrides: Partial<AssignableTask> = {}): AssignableTask => ({
  taskId: createTaskId(() => "route_0"), role: "reviewer", objective: "Review parser", ...overrides
});

test("host pin limits eligible models even when another model is cheaper", () => {
  const plan = assignHostPinnedTasks({ tasks: [task()], catalog: catalog(), pinnedModelId: PINNED });
  assert.deepEqual(plan.assignments[0]!.allowedModels, [PINNED]);
  assert.deepEqual(plan.assignments[0]!.decision.eligibleModels, [PINNED]);
  assert.equal(plan.assignments[0]!.decision.model, PINNED);
  assert.equal(plan.assignments[0]!.preferredModel, PINNED);
  assert.deepEqual(plan.requiredModelIds, [PINNED, OTHER]);
});

const refusals: readonly { label: string; row?: Partial<CatalogModelInput>; task?: Partial<AssignableTask>;
  remainingTimeMs?: number; remainingCostUsd?: number }[] = [
  { label: "provider-policy", row: { providerPolicy: "forbidden" } },
  { label: "privacy-class", task: { objective: "Review parser; data must stay local" } },
  { label: "capability", row: { capabilities: [] } },
  { label: "role", row: { roles: ["actor"] } },
  { label: "complexity", row: { maxComplexity: "LOW" } },
  { label: "high-risk-approval", row: { approvedForHighRisk: false }, task: { objective: "Review production credentials" } },
  { label: "context-window", task: { contextTokens: 101 } },
  { label: "max-output", task: { outputTokens: 11 } },
  { label: "budget", remainingCostUsd: 0.09 },
  { label: "deadline", remainingTimeMs: 99 }
];
for (const example of refusals) test(`ineligible pinned ${example.label} refuses instead of switching to another eligible model`, () => {
  assert.throws(() => assignHostPinnedTasks({ tasks: [task(example.task)], catalog: catalog(example.row), pinnedModelId: PINNED,
    ...(example.remainingTimeMs !== undefined ? { remainingTimeMs: example.remainingTimeMs } : {}),
    ...(example.remainingCostUsd !== undefined ? { remainingCostUsd: example.remainingCostUsd } : {})
  }), (error) => error instanceof RoutingRefusalError && error.refusals.some((refusal) =>
    refusal.modelId === PINNED && refusal.constraint === example.label));
});

test("explicit token costs and contract risk reach the existing router", () => {
  assert.throws(() => assignHostPinnedTasks({ tasks: [task({ contextTokens: 100, outputTokens: 10 })],
    catalog: catalog({ inputCostPerMTok: 1_000_000, outputCostPerMTok: 1_000_000 }), pinnedModelId: PINNED, remainingCostUsd: 109
  }), (error) => error instanceof RoutingRefusalError && error.refusals.some((refusal) => refusal.constraint === "budget"));
  const plan = assignHostPinnedTasks({ tasks: [task({ contractRisk: true })], catalog: catalog(), pinnedModelId: PINNED });
  assert.equal(plan.assignments[0]!.decision.highRisk, true);
  assert.equal(plan.assignments[0]!.decision.statusAfterRoute, "WAITING_FOR_USER");
  assert.equal(plan.assignments[0]!.decision.complexity, "HIGH");
  assert.equal(plan.assignments[0]!.decision.role, "critic");
});

test("unavailable host pin refuses without resolving a policy alias", () => {
  assert.throws(() => assignHostPinnedTasks({ tasks: [task()], catalog: catalog(), pinnedModelId: "cheap" }), /unavailable|allowed/i);
});
