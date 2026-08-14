import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type Flowchart,
  type FlowchartNode,
  createModelRouter,
  validateFlowchart,
} from "../../../src/supervisor/flowchart.js";
import {
  createFlowchartSupervisor,
} from "../../../src/supervisor/flowchart-supervisor.js";

import type { TaskId } from "../../../src/domain/ids.js";

function makeLinearFlowchart(): Flowchart {
  const nodes: FlowchartNode[] = [
    { id: "n1", taskId: "t1" as TaskId, role: "actor" },
    { id: "n2", taskId: "t2" as TaskId, role: "critic" },
  ];
  const edges = [{ from: "n1", to: "n2", condition: "always" as const }];
  return { id: "fc-linear", nodes, edges, joinRules: {} };
}

test("FlowchartSupervisor routes parallel branches via ModelRouter and records MODEL_ROUTED", () => {
  const fc = makeLinearFlowchart();
  validateFlowchart(fc);
  const router = createModelRouter({ defaultThreshold: 0.75, policyVersion: "p1" });
  const supervisor = createFlowchartSupervisor({ flowchart: fc, router });

  const d1 = supervisor.step();
  assert.ok(d1, "first decision produced");
  assert.equal(d1.eventType, "MODEL_ROUTED");
  assert.ok(d1.model);

  const d2 = supervisor.step();
  assert.ok(d2, "second decision produced");
  assert.equal(d2.eventType, "MODEL_ROUTED");
});

test("low-confidence route transitions run to WAITING_FOR_USER and records approval plan", () => {
  const fc = makeLinearFlowchart();
  const router = createModelRouter({ defaultThreshold: 0.9, policyVersion: "p1" });
  const supervisor = createFlowchartSupervisor({ flowchart: fc, router });

  const d = supervisor.step();
  assert.ok(d);
  if (d.confidence < 0.9) {
    assert.equal(d.statusAfterRoute, "WAITING_FOR_USER");
    assert.ok(d.approvalPlan.selectableItems.length > 0);
    assert.equal(supervisor.state.status, "WAITING_FOR_USER");
  }
});

test("resume after WAITING_FOR_USER restores pending approvals and router state", () => {
  const fc = makeLinearFlowchart();
  const router = createModelRouter({ defaultThreshold: 0.9, policyVersion: "p1" });
  const supervisor = createFlowchartSupervisor({ flowchart: fc, router });

  const d = supervisor.step();
  if (d && d.statusAfterRoute === "WAITING_FOR_USER") {
    supervisor.applyUserApproval(d.approvalPlan.selectableItems.map((i) => i.id));
    supervisor.resume();
    assert.equal(supervisor.state.status, "RUNNING");
    assert.equal(supervisor.state.pendingApprovals.length, 0);
  }
});
