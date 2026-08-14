import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type Flowchart,
  type FlowchartNode,
  type FlowchartEdge,
  type ModelRouter,
  type RoutingDecision,
  validateFlowchart,
  createModelRouter,
  routeTask,
} from "../../../src/supervisor/flowchart.js";

import type { TaskId } from "../../../src/domain/ids.js";

test("validateFlowchart rejects cycles", () => {
  const nodes: FlowchartNode[] = [
    { id: "n1", taskId: "t1" as TaskId, role: "actor" },
    { id: "n2", taskId: "t2" as TaskId, role: "critic" },
  ];
  const edges: FlowchartEdge[] = [
    { from: "n1", to: "n2", condition: "always" },
    { from: "n2", to: "n1", condition: "always" },
  ];
  const fc: Flowchart = { id: "fc1", nodes, edges, joinRules: {} };
  assert.throws(() => validateFlowchart(fc), /cycle/i);
});

test("validateFlowchart accepts linear topology", () => {
  const nodes: FlowchartNode[] = [
    { id: "n1", taskId: "t1" as TaskId, role: "actor" },
    { id: "n2", taskId: "t2" as TaskId, role: "critic" },
  ];
  const edges: FlowchartEdge[] = [{ from: "n1", to: "n2", condition: "always" }];
  const fc: Flowchart = { id: "fc2", nodes, edges, joinRules: {} };
  assert.doesNotThrow(() => validateFlowchart(fc));
});

test("ModelRouter emits MODEL_ROUTED with confidence and approval plan", () => {
  const router: ModelRouter = createModelRouter({
    defaultThreshold: 0.75,
    policyVersion: "p1",
  });

  const decision: RoutingDecision = routeTask(router, {
    taskId: "t10" as TaskId,
    family: "edit",
    estimatedTokens: 1200,
  });

  assert.equal(decision.eventType, "MODEL_ROUTED");
  assert.ok(decision.model);
  assert.ok(typeof decision.confidence === "number");
  assert.ok(decision.approvalPlan);
  assert.ok(Array.isArray(decision.approvalPlan.selectableItems));
});

test("low confidence forces WAITING_FOR_USER when below threshold", () => {
  const router: ModelRouter = createModelRouter({
    defaultThreshold: 0.9,
    policyVersion: "p1",
  });

  const decision: RoutingDecision = routeTask(router, {
    taskId: "t11" as TaskId,
    family: "architecture",
    estimatedTokens: 8000,
  });

  assert.equal(decision.statusAfterRoute, "WAITING_FOR_USER");
  assert.ok(decision.confidence < 0.9);
});
