import assert from "node:assert/strict";
import { test } from "node:test";
import { createTaskId } from "../../../src/domain/ids.js";
import {
  validateConfidenceScore,
  type Flowchart,
  type FlowEdge,
  type FlowNode
} from "../../../src/domain/flowchart.js";
import { createModelRouter, type ModelRouterConfig } from "../../../src/supervisor/model-router.js";
import { createFlowchartSupervisor } from "../../../src/supervisor/flowchart-supervisor.js";

const routerConfig: ModelRouterConfig = {
  policyVersion: "router-v1",
  models: [
    { id: "cheap", roles: ["actor", "critic"], maxComplexity: "MEDIUM", estimatedCostUsd: 0.1, estimatedDurationMs: 1_000 },
    { id: "premium", roles: ["actor", "critic", "judge", "router"], maxComplexity: "HIGH", estimatedCostUsd: 0.5, estimatedDurationMs: 4_000 }
  ]
};

function node(id: string, opts: { role?: FlowNode["role"] } = {}): FlowNode {
  return {
    id,
    taskId: createTaskId(() => id),
    role: opts.role ?? "actor",
    objective: `Do ${id}`,
    modelPolicy: { allowedModels: ["cheap", "premium"] },
    confidenceThreshold: validateConfidenceScore(0.7),
    approvalRequired: false
  };
}

const successEdge = (from: string, to: string): FlowEdge => ({
  from,
  to,
  condition: { type: "success", expected: true }
});

const success = { outcome: "SUCCESS" as const, confidence: validateConfidenceScore(0.9), evidenceIds: ["evd-1"] };

function makeSupervisor(flowchart: Flowchart) {
  return createFlowchartSupervisor({
    flowchart,
    router: createModelRouter(routerConfig),
    limits: { maxConcurrentNodes: 4, maxConsecutiveStalls: 3 }
  });
}

test("applyInjection fact unlocks a custom edge", () => {
  const sv = makeSupervisor({
    id: "custom-unlock",
    nodes: [node("a"), node("b")],
    edges: [{ from: "a", to: "b", condition: { type: "custom", key: "unlock", operator: "eq", value: true } }]
  });
  sv.leaseReadyNodes();
  sv.applyChildResult("a", success);
  assert.equal(sv.nodeState("b"), "PENDING");

  sv.applyInjection({ kind: "fact", key: "unlock", value: true, confidence: validateConfidenceScore(1) });
  assert.equal(sv.nodeState("b"), "READY");
  assert.equal(sv.snapshot().facts.unlock, true);
});

test("applyInjection skip marks a PENDING node SKIPPED", () => {
  const sv = makeSupervisor({
    id: "skip-pending",
    nodes: [node("a"), node("b")],
    edges: [successEdge("a", "b")]
  });
  assert.equal(sv.nodeState("b"), "PENDING");
  sv.applyInjection({ kind: "skip", nodeId: "b" });
  assert.equal(sv.nodeState("b"), "SKIPPED");
});

test("applyInjection skip of a RUNNING node throws", () => {
  const sv = makeSupervisor({
    id: "skip-running",
    nodes: [node("a")],
    edges: []
  });
  sv.leaseReadyNodes();
  assert.equal(sv.nodeState("a"), "RUNNING");
  assert.throws(() => sv.applyInjection({ kind: "skip", nodeId: "a" }), /RUNNING|cannot skip/i);
});

test("applyInjection override sets confidence on a node that is not FAILED", () => {
  const sv = makeSupervisor({
    id: "override-conf",
    nodes: [node("a")],
    edges: []
  });
  sv.leaseReadyNodes();
  sv.applyChildResult("a", success);
  sv.applyInjection({ kind: "override", nodeId: "a", confidence: validateConfidenceScore(0.42) });
  assert.equal(sv.nodeRuntime("a").confidence, 0.42);
});
