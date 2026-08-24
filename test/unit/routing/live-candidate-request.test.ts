import assert from "node:assert/strict";
import { test } from "node:test";
import type { TaskComplexity } from "../../../src/domain/flowchart.js";
import {
  catalogModel,
  toModelDescriptor,
  type CatalogModel,
  type CatalogModelInput
} from "../../../src/routing/catalog-model.js";
import {
  evaluateCandidate,
  evaluateLiveCandidate,
  type CandidateCheck,
  type ConstraintFailure,
  type LiveRouteRequest
} from "../../../src/routing/policy.js";

const COMPLEXITY_RANK: Record<TaskComplexity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

/**
 * The pre-iteration-3 golden evaluator: rebuild the shared RouteRequest
 * field-by-field per candidate, exactly as evaluateLiveCandidate used to
 * inline. The live pass-through must stay byte-identical to this — same
 * eligibility, same failure order, same detail strings.
 */
function legacyEvaluateLiveCandidate(model: CatalogModel, request: LiveRouteRequest): CandidateCheck {
  const failures: ConstraintFailure[] = [];
  if (!model.roles.includes(request.role)) {
    failures.push({
      modelId: model.id,
      constraint: "role",
      detail: `role ${request.role} not declared`
    });
  }
  if (COMPLEXITY_RANK[model.maxComplexity] < COMPLEXITY_RANK[request.complexity]) {
    failures.push({
      modelId: model.id,
      constraint: "complexity",
      detail: `maxComplexity ${model.maxComplexity} < ${request.complexity}`
    });
  }
  const rest = evaluateCandidate(toModelDescriptor(model), {
    taskFamily: request.taskFamily,
    privacyRequired: request.privacyRequired,
    requiredCapabilities: request.requiredCapabilities,
    contextNeeded: request.contextNeeded,
    outputNeeded: request.outputNeeded,
    budgetUsd: request.budgetUsd,
    deadlineMs: request.deadlineMs,
    highRisk: request.highRisk,
    ...(request.fixedCostUsd !== undefined ? { fixedCostUsd: request.fixedCostUsd } : {}),
    ...(request.fixedLatencyMs !== undefined ? { fixedLatencyMs: request.fixedLatencyMs } : {})
  });
  const merged = [...failures, ...rest.failures];
  return { modelId: model.id, eligible: merged.length === 0, failures: merged };
}

function liveModel(input: Partial<CatalogModelInput> & { readonly id: string }): CatalogModel {
  return catalogModel({
    version: `${input.id}-v1`,
    roles: ["actor", "critic"],
    maxComplexity: "HIGH",
    estimatedCostUsd: 0.3,
    estimatedDurationMs: 1_000,
    approvedForHighRisk: true,
    ...input
  });
}

const MODELS: readonly CatalogModel[] = [
  liveModel({ id: "solid" }),
  liveModel({ id: "judge-only", roles: ["judge"] }),
  liveModel({ id: "low-only", maxComplexity: "LOW" }),
  liveModel({ id: "forbidden", providerPolicy: "forbidden" }),
  liveModel({ id: "cloudy", privacyClass: "cloud-general" }),
  liveModel({ id: "local-safe", privacyClass: "local" }),
  liveModel({ id: "tiny-context", contextWindow: 1_000 }),
  liveModel({ id: "tiny-output", maxOutputTokens: 100 }),
  liveModel({ id: "dear", estimatedCostUsd: 50, inputCostPerMTok: 500, outputCostPerMTok: 1_500 }),
  liveModel({ id: "slow", estimatedDurationMs: 900_000, latencyMsPer1K: 60_000 }),
  liveModel({ id: "risk-blind", approvedForHighRisk: false })
];

/** The exact live shape partitionLiveCandidates sends: tokens 0, fixed rates set. */
function liveShape(model: CatalogModel, overrides: Partial<LiveRouteRequest> = {}): LiveRouteRequest {
  return {
    role: "actor",
    complexity: "MEDIUM",
    taskFamily: "edit",
    privacyRequired: "cloud-general",
    requiredCapabilities: ["tool-use"],
    contextNeeded: 0,
    outputNeeded: 0,
    budgetUsd: 10,
    deadlineMs: 60_000,
    highRisk: false,
    fixedCostUsd: model.estimatedCostUsd,
    fixedLatencyMs: model.estimatedDurationMs,
    ...overrides
  };
}

test("evaluateLiveCandidate equals the legacy per-candidate request rebuild on the full constraint matrix", () => {
  const variants: readonly {
    readonly label: string;
    readonly request: (model: CatalogModel) => LiveRouteRequest;
  }[] = [
    { label: "live fixed-rate", request: (model) => liveShape(model) },
    {
      label: "token-estimated",
      request: (model) => liveShape(model, { contextNeeded: 200_000, outputNeeded: 8_000 })
    },
    {
      label: "no fixed rates",
      request: (model) => liveShape(model, { fixedCostUsd: undefined, fixedLatencyMs: undefined })
    },
    { label: "high-risk", request: (model) => liveShape(model, { highRisk: true }) },
    { label: "local privacy", request: (model) => liveShape(model, { privacyRequired: "local" }) },
    {
      label: "cloud-approved privacy",
      request: (model) => liveShape(model, { privacyRequired: "cloud-approved" })
    },
    {
      label: "undeclared capability",
      request: (model) => liveShape(model, { requiredCapabilities: ["tool-use", "vision"] })
    },
    { label: "tight budget", request: (model) => liveShape(model, { budgetUsd: 0.01 }) },
    { label: "tight deadline", request: (model) => liveShape(model, { deadlineMs: 1 }) },
    {
      label: "router HIGH",
      request: (model) => liveShape(model, { role: "router", complexity: "HIGH" })
    },
    {
      label: "everything at once",
      request: (model) =>
        liveShape(model, {
          role: "router",
          complexity: "HIGH",
          privacyRequired: "local",
          requiredCapabilities: ["tool-use", "vision"],
          contextNeeded: 200_000,
          outputNeeded: 8_000,
          budgetUsd: 0.01,
          deadlineMs: 1,
          highRisk: true
        })
    }
  ];
  for (const model of MODELS) {
    for (const variant of variants) {
      const request = variant.request(model);
      assert.deepEqual(
        evaluateLiveCandidate(model, request),
        legacyEvaluateLiveCandidate(model, request),
        `model=${model.id} variant=${variant.label}`
      );
    }
  }
});

test("failure order stays role, complexity, then the shared matrix in declaration order", () => {
  const worst = liveModel({
    id: "worst",
    roles: ["judge"],
    maxComplexity: "LOW",
    providerPolicy: "forbidden",
    privacyClass: "cloud-general",
    contextWindow: 1_000,
    maxOutputTokens: 100,
    inputCostPerMTok: 500,
    outputCostPerMTok: 1_500,
    latencyMsPer1K: 60_000,
    approvedForHighRisk: false
  });
  const check = evaluateLiveCandidate(
    worst,
    liveShape(worst, {
      role: "actor",
      complexity: "HIGH",
      privacyRequired: "local",
      requiredCapabilities: ["tool-use", "vision"],
      contextNeeded: 200_000,
      outputNeeded: 8_000,
      budgetUsd: 0.01,
      deadlineMs: 1,
      highRisk: true
    })
  );
  assert.equal(check.eligible, false);
  assert.deepEqual(
    check.failures.map((failure) => failure.constraint),
    [
      "role",
      "complexity",
      "provider-policy",
      "privacy-class",
      "capability",
      "context-window",
      "max-output",
      "budget",
      "deadline",
      "high-risk-approval"
    ]
  );
});
