import assert from "node:assert/strict";
import { test } from "node:test";

import { createTaskId } from "../../../src/domain/ids.js";
import {
  DEFAULT_HUMAN_CONFIDENCE,
  defaultDecisionPolicy,
  validateApprovalPlan,
  validateApprovalReplyAgainstPlan,
  validateApprovalReplyShape,
  validateApprovalSelection,
  validateConfidenceScore,
  validateFlowchart,
  type ApprovalPlan,
  type Flowchart,
  type FlowNode
} from "../../../src/domain/flowchart.js";
import {
  createModelRouter,
  effectiveConfidenceThreshold,
  routeFlowNode,
  type ModelRouterConfig
} from "../../../src/supervisor/model-router.js";
import { RoutingRefusalError } from "../../../src/domain/errors.js";
import { FLOWCHART_FEATURE_VERSION } from "../../../src/routing/feature-version.js";

const taskId = (suffix: string) => createTaskId(() => suffix);

function node(id: string, role: FlowNode["role"] = "actor"): FlowNode {
  return {
    id,
    taskId: taskId(id),
    role,
    objective: `Complete ${id}`,
    modelPolicy: { allowedModels: ["small", "large"] },
    confidenceThreshold: validateConfidenceScore(0.7),
    approvalRequired: false
  };
}

function flowchart(overrides: Partial<Flowchart> = {}): Flowchart {
  return {
    id: "flow",
    nodes: [node("one"), node("two", "critic")],
    edges: [{ from: "one", to: "two", condition: { type: "success", expected: true } }],
    ...overrides
  };
}

test("flowchart validator accepts all condition operands and a valid join", () => {
  assert.equal(validateFlowchart(flowchart()).id, "flow");
  const nodes = [
    { ...node("start"), parallelGroup: "workers" },
    { ...node("review", "critic"), parallelGroup: "workers" },
    {
      ...node("join", "judge"),
      joinPolicy: { mode: "all" as const, requiredNodeIds: ["start", "review"] }
    }
  ];
  const edges: Flowchart["edges"] = [
    { from: "start", to: "review", condition: { type: "evidence-count", operator: "gte", value: 2 } },
    { from: "start", to: "join", condition: { type: "confidence", operator: "gte", value: validateConfidenceScore(0.8) } },
    { from: "review", to: "join", condition: { type: "user-decision", decisionId: "approve", equals: true } }
  ];
  assert.equal(validateFlowchart({ id: "valid", nodes, edges }).id, "valid");
  assert.doesNotThrow(() => validateFlowchart({
    id: "custom",
    nodes: [node("a"), node("b")],
    edges: [{ from: "a", to: "b", condition: { type: "custom", key: "risk", operator: "eq", value: "low" } }]
  }));
});

test("decision policy defaults human confidence to 0.7", () => {
  const policy = defaultDecisionPolicy();
  assert.equal(policy.minHumanConfidence, 0.7);
  assert.equal(policy.requiresApproval(validateConfidenceScore(0.69), false), true);
  assert.equal(policy.requiresApproval(validateConfidenceScore(0.7), false), false);
});

test("flowchart validator rejects invalid identities, policies, edges, joins, confidence, and cycles", () => {
  const base = flowchart();
  assert.throws(() => validateFlowchart({ ...base, nodes: [{ ...node("one"), id: "" }] }), /id.*non-empty/i);
  assert.throws(() => validateFlowchart({ ...base, nodes: [node("same"), node("same")] }), /duplicate node/i);
  assert.throws(() => validateFlowchart({ ...base, nodes: [{ ...node("one") }, { ...node("two"), taskId: taskId("one") }] }), /duplicate task/i);
  assert.throws(() => validateFlowchart({ ...base, nodes: [{ ...node("one"), modelPolicy: { allowedModels: [] } }] }), /modelPolicy/i);
  assert.throws(() => validateFlowchart({ ...base, nodes: [{ ...node("one"), confidenceThreshold: 1.1 }] }), /confidenceThreshold/i);
  assert.throws(() => validateFlowchart({ ...base, edges: [{ from: "one", to: "missing", condition: { type: "success", expected: true } }] }), /unknown node/i);
  assert.throws(() => validateFlowchart({ ...base, edges: [{ from: "one", to: "one", condition: { type: "success", expected: true } }] }), /self edge/i);
  assert.throws(() => validateFlowchart({ ...base, edges: [{ from: "one", to: "two", condition: { type: "confidence", operator: "gte", value: Number.NaN } }] }), /finite/i);
  assert.throws(() => validateFlowchart({
    ...base,
    nodes: [node("one"), { ...node("two"), joinPolicy: { mode: "all", requiredNodeIds: ["missing"] } }]
  }), /join reference/i);
  assert.throws(() => validateFlowchart({
    ...base,
    edges: [
      { from: "one", to: "two", condition: { type: "success", expected: true } },
      { from: "two", to: "one", condition: { type: "success", expected: true } }
    ]
  }), /cycle/i);
});

test("flowchart validator rejects duplicate edges between the same nodes", () => {
  assert.throws(() => validateFlowchart({
    ...flowchart(),
    edges: [
      { from: "one", to: "two", condition: { type: "success", expected: true } },
      { from: "one", to: "two", condition: { type: "success", expected: false } }
    ]
  }), /duplicate edge/i);
});

const routerConfig: ModelRouterConfig = {
  policyVersion: "router-v1",
  models: [
    { id: "small", version: "small-v1", roles: ["actor", "critic"], maxComplexity: "MEDIUM", estimatedCostUsd: 0.1, estimatedDurationMs: 1_000 },
    { id: "large", version: "large-v1", roles: ["actor", "critic", "router", "judge"], maxComplexity: "HIGH", estimatedCostUsd: 0.5, estimatedDurationMs: 4_000 },
    { id: "judge", version: "judge-v1", roles: ["judge"], maxComplexity: "HIGH", estimatedCostUsd: 0.4, estimatedDurationMs: 3_000 }
  ]
};

test("ModelRouter is R0-equivalent cheapest eligible with a static preferred override", () => {
  const router = createModelRouter(routerConfig);
  const limits = { remainingTimeMs: 10_000 };
  const cheapest = routeFlowNode(router, node("cheap"), "LOW", limits);
  const preferred = routeFlowNode(
    router,
    {
      ...node("pref"),
      modelPolicy: { allowedModels: ["small", "large"], preferredModel: "large" }
    },
    "LOW",
    limits
  );
  assert.equal(cheapest.model, "small");
  assert.equal(preferred.model, "large");
  assert.equal(preferred.statusAfterRoute, "RUNNING");
});

test("ModelRouter deterministically routes by role and complexity", () => {
  const router = createModelRouter(routerConfig);
  const limits = { remainingCostUsd: 1, remainingTimeMs: 10_000 };
  const actor = routeFlowNode(router, node("actor"), "LOW", limits);
  const highActor = routeFlowNode(router, node("high"), "HIGH", limits);
  const judgeNode = { ...node("judge-node", "judge"), modelPolicy: { allowedModels: ["large", "judge"] } };
  const judge = routeFlowNode(router, judgeNode, "HIGH", limits);

  assert.equal(actor.model, "small");
  assert.equal(highActor.model, "large");
  assert.equal(judge.model, "judge");
  assert.equal(routeFlowNode(router, judgeNode, "HIGH", limits).model, judge.model);
  assert.match(judge.justification, /role judge.*HIGH complexity/i);
  assert.equal(judge.policyVersion, "router-v1");
});

test("ModelRouter fails closed for unavailable capabilities and cost/time limits", () => {
  const router = createModelRouter(routerConfig);
  assert.throws(() => routeFlowNode(router, {
    ...node("unknown"),
    modelPolicy: { allowedModels: ["not-configured"] }
  }, "LOW", { remainingTimeMs: 10_000 }), /unavailable model/i);
  assert.throws(() => routeFlowNode(router, node("expensive"), "HIGH", {
    remainingCostUsd: 0.2,
    remainingTimeMs: 10_000
  }), /cost and time limits/i);
  assert.throws(() => routeFlowNode(router, node("slow"), "LOW", {
    remainingCostUsd: 1,
    remainingTimeMs: 500
  }), /cost and time limits/i);
});

test("ModelRouter rejects catalogs with unknown or duplicate roles", () => {
  assert.throws(() => createModelRouter({
    ...routerConfig,
    models: [{ ...routerConfig.models[0]!, roles: ["actor", "actor"] }]
  }), /duplicate roles/i);
  assert.throws(() => createModelRouter({
    ...routerConfig,
    models: [{ ...routerConfig.models[0]!, roles: ["planner" as FlowNode["role"]] }]
  }), /unknown role/i);
  assert.throws(() => createModelRouter({
    ...routerConfig,
    models: [{ ...routerConfig.models[0]!, roles: [] }]
  }), /must declare roles/i);
});

test("low confidence lookup does not gate approval; only approvalRequired does", () => {
  const router = createModelRouter(routerConfig);
  const high = routeFlowNode(router, node("high"), "HIGH", {
    remainingTimeMs: 10_000,
    minHumanConfidence: validateConfidenceScore(0.7)
  });
  const approval = routeFlowNode(router, { ...node("approval"), approvalRequired: true }, "LOW", {
    remainingTimeMs: 10_000
  });
  assert.equal(high.statusAfterRoute, "RUNNING");
  assert.equal(high.coldStartRoutingScore, 0.68);
  assert.equal(approval.statusAfterRoute, "WAITING_FOR_USER");
  assert.equal(high.eventType, "MODEL_ROUTED");
});

test("the effective threshold is the strictest of every declared threshold", () => {
  assert.equal(effectiveConfidenceThreshold({}), DEFAULT_HUMAN_CONFIDENCE);
  // A lax node threshold cannot lower the default floor.
  assert.equal(effectiveConfidenceThreshold({ nodeThreshold: 0.2 }), DEFAULT_HUMAN_CONFIDENCE);
  // Any stricter source wins, whichever one it is.
  assert.equal(effectiveConfidenceThreshold({ nodeThreshold: 0.95, runMinHumanConfidence: 0.8 }), 0.95);
  assert.equal(effectiveConfidenceThreshold({ nodeThreshold: 0.75, runMinHumanConfidence: 0.9 }), 0.9);
  assert.equal(
    effectiveConfidenceThreshold({ nodeThreshold: 0.75, runMinHumanConfidence: 0.8, routerDefaultThreshold: 0.99 }),
    0.99
  );
  assert.throws(() => effectiveConfidenceThreshold({ nodeThreshold: 1.5 }), /confidenceThreshold/i);
});

test("a lax node threshold cannot override a stricter run limit when routing", () => {
  const router = createModelRouter({ ...routerConfig, defaultThreshold: 0.5 });
  const laxNode = { ...node("lax"), confidenceThreshold: validateConfidenceScore(0.1) };

  // Lookup score is not an approval gate.
  assert.equal(routeFlowNode(router, laxNode, "LOW", { remainingTimeMs: 10_000 }).statusAfterRoute, "RUNNING");
  assert.equal(
    routeFlowNode(router, laxNode, "LOW", {
      remainingTimeMs: 10_000,
      minHumanConfidence: validateConfidenceScore(0.95)
    }).statusAfterRoute,
    "RUNNING"
  );
  assert.equal(routeFlowNode(router, laxNode, "HIGH", { remainingTimeMs: 10_000 }).statusAfterRoute, "RUNNING");
});

test("routed approval plans carry a stable non-empty id", () => {
  const router = createModelRouter(routerConfig);
  const first = routeFlowNode(router, node("planned"), "LOW", { remainingTimeMs: 10_000 });
  const second = routeFlowNode(router, node("planned"), "LOW", { remainingTimeMs: 10_000 });
  assert.equal(first.approvalPlan.id, second.approvalPlan.id);
  assert.ok(first.approvalPlan.id.trim() !== "");
  assert.deepEqual(validateApprovalPlan(first.approvalPlan), first.approvalPlan);
  assert.throws(() => validateApprovalPlan({ ...first.approvalPlan, id: "" }), /id must be a non-empty/i);
});

test("live flowchart routing applies analyzeTask high-risk and capability filters", () => {
  const router = createModelRouter({
    policyVersion: "router-v1",
    models: [
      {
        id: "small",
        version: "small-v1",
        roles: ["actor"],
        maxComplexity: "HIGH",
        estimatedCostUsd: 0.1,
        estimatedDurationMs: 1_000,
        approvedForHighRisk: false,
        capabilities: ["tool-use"]
      },
      {
        id: "large",
        version: "large-v1",
        roles: ["actor"],
        maxComplexity: "HIGH",
        estimatedCostUsd: 0.5,
        estimatedDurationMs: 4_000,
        approvedForHighRisk: true,
        capabilities: ["tool-use", "vision"]
      }
    ]
  });
  const limits = { remainingTimeMs: 10_000 };
  const deploy = routeFlowNode(
    router,
    { ...node("prod"), objective: "Deploy payment credentials to production" },
    "MEDIUM",
    limits
  );
  assert.equal(deploy.model, "large");
  assert.equal(deploy.highRisk, true);
  assert.equal(deploy.family, "deploy");
  assert.equal(deploy.featureVersion, FLOWCHART_FEATURE_VERSION);
  assert.equal(deploy.statusAfterRoute, "WAITING_FOR_USER");

  const vision = routeFlowNode(
    router,
    { ...node("ui"), objective: "Look at this screenshot and fix the padding" },
    "LOW",
    limits
  );
  assert.equal(vision.model, "large");
  assert.equal(vision.statusAfterRoute, "RUNNING");

  const tester = routeFlowNode(
    router,
    {
      ...node("qa"),
      agentRole: "tester",
      objective: "Refactor the billing helper and add a unit test"
    },
    "LOW",
    limits
  );
  assert.equal(tester.agentRole, "tester");
  assert.equal(tester.family, "test");
  assert.equal(tester.statusAfterRoute, "RUNNING");

  assert.throws(
    () =>
      routeFlowNode(
        router,
        { ...node("local"), objective: "Refactor billing; this must stay local" },
        "LOW",
        limits
      ),
    (error: unknown) => error instanceof RoutingRefusalError
  );
});

test("a refusal message names the constraint that actually bound it", () => {
  const router = createModelRouter({
    policyVersion: "router-v1",
    models: [
      {
        id: "cloud",
        version: "cloud-v1",
        roles: ["actor"],
        maxComplexity: "HIGH",
        estimatedCostUsd: 0.1,
        estimatedDurationMs: 1_000,
        privacyClass: "cloud-general",
        capabilities: ["tool-use"]
      }
    ]
  });
  const limits = { remainingTimeMs: 10_000 };
  const localOnly = { ...node("local"), modelPolicy: { allowedModels: ["cloud"] } };

  assert.throws(
    () =>
      routeFlowNode(
        router,
        { ...localOnly, objective: "Refactor billing; this must stay local" },
        "LOW",
        limits
      ),
    (error: unknown) =>
      error instanceof RoutingRefusalError &&
      /privacy class/i.test(error.message) &&
      /cloud-general cannot serve local/i.test(error.message)
  );

  assert.throws(
    () =>
      routeFlowNode(
        router,
        { ...localOnly, objective: "Look at this screenshot and fix the padding" },
        "LOW",
        limits
      ),
    (error: unknown) =>
      error instanceof RoutingRefusalError &&
      /required capability/i.test(error.message) &&
      /vision/i.test(error.message)
  );
});

test("high-risk and cost/time refusal wordings stay stable for their callers", () => {
  const router = createModelRouter({
    policyVersion: "router-v1",
    models: [
      {
        id: "cheap",
        version: "cheap-v1",
        roles: ["actor"],
        maxComplexity: "HIGH",
        estimatedCostUsd: 0.5,
        estimatedDurationMs: 4_000,
        privacyClass: "cloud-general",
        capabilities: ["tool-use"],
        approvedForHighRisk: false
      }
    ]
  });
  const onlyCheap = { ...node("only"), modelPolicy: { allowedModels: ["cheap"] } };

  assert.throws(
    () =>
      routeFlowNode(
        router,
        { ...onlyCheap, objective: "Deploy payment credentials to production" },
        "LOW",
        { remainingTimeMs: 10_000 }
      ),
    /No allowed model is approved for high-risk tasks/
  );

  // The flowchart supervisor matches this phrase to fail one node instead of
  // the whole run, so it must not drift.
  assert.throws(
    () => routeFlowNode(router, onlyCheap, "LOW", { remainingCostUsd: 0.1, remainingTimeMs: 10_000 }),
    /No allowed model fits the remaining cost and time limits/
  );
});

const plan: ApprovalPlan = {
  id: "plan-1",
  items: [
    { id: "a", label: "A", selectable: true },
    { id: "b", label: "B", selectable: true },
    { id: "fixed", label: "Fixed", selectable: false }
  ]
};

test("selective approvals accept a unique subset only", () => {
  assert.deepEqual(validateApprovalSelection(plan, ["b"]), ["b"]);
  assert.deepEqual(validateApprovalSelection(plan, ["a", "b"]), ["a", "b"]);
  assert.deepEqual(validateApprovalSelection(plan, []), []);
  assert.throws(() => validateApprovalSelection(plan, ["b", "b"]), /unique/i);
  assert.throws(() => validateApprovalSelection(plan, ["fixed"]), /non-selectable/i);
  assert.throws(() => validateApprovalSelection(plan, ["missing"]), /unknown/i);
});

test("reply shape validation is independent of any plan", () => {
  const reply = { approvalPlanId: "plan-1", selectedActionIds: ["a"] };
  assert.deepEqual(validateApprovalReplyShape(reply), reply);
  assert.throws(() => validateApprovalReplyShape({ ...reply, approvalPlanId: "" }), /approvalPlanId/i);
  assert.throws(() => validateApprovalReplyShape({ ...reply, approvalPlanId: 7 }), /approvalPlanId/i);
  assert.throws(() => validateApprovalReplyShape({ ...reply, selectedActionIds: "a" }), /must be an array/i);
  assert.throws(() => validateApprovalReplyShape({ ...reply, selectedActionIds: [""] }), /non-empty/i);
  assert.throws(() => validateApprovalReplyShape({ ...reply, selectedActionIds: ["a", "a"] }), /unique/i);
  assert.throws(() => validateApprovalReplyShape(null), /object/i);
});

test("correlating a reply requires the authoritative plan id and a legal subset", () => {
  const reply = { approvalPlanId: "plan-1", selectedActionIds: ["b"] };
  assert.deepEqual(validateApprovalReplyAgainstPlan(plan, reply), reply);
  assert.throws(
    () => validateApprovalReplyAgainstPlan(plan, { ...reply, approvalPlanId: "plan-2" }),
    /does not match the pending plan/i
  );
  assert.throws(
    () => validateApprovalReplyAgainstPlan(plan, { ...reply, selectedActionIds: ["fixed"] }),
    /non-selectable/i
  );
  assert.throws(
    () => validateApprovalReplyAgainstPlan(plan, { ...reply, selectedActionIds: ["nope"] }),
    /unknown/i
  );
});
