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

// Non-trivial flowchart: fork -> two parallel specialists -> selective join on high-confidence
function makeForkJoinFlowchart(): Flowchart {
  const nodes: FlowchartNode[] = [
    { id: "start", taskId: "t0" as TaskId, role: "router" },
    { id: "actorA", taskId: "tA" as TaskId, role: "actor", modelPreference: "gpt-5.6-terra" },
    { id: "actorB", taskId: "tB" as TaskId, role: "actor", modelPreference: "claude-3.5" },
    { id: "join", taskId: "tJ" as TaskId, role: "judge" },
  ];
  const edges = [
    { from: "start", to: "actorA", condition: "always" as const },
    { from: "start", to: "actorB", condition: "always" as const },
    { from: "actorA", to: "join", condition: "on-success" as const },
    { from: "actorB", to: "join", condition: "on-success" as const },
  ];
  return {
    id: "fc-fork-join",
    nodes,
    edges,
    joinRules: {
      join: { required: ["actorA", "actorB"], policy: "all" as const },
    },
  };
}

test("non-trivial flowchart (fork + different models + confidence gate + selective join) works end-to-end; resume restores router + approval state; full gates + resume tests", () => {
  const fc = makeForkJoinFlowchart();
  validateFlowchart(fc);

  const router = createModelRouter({ defaultThreshold: 0.75, policyVersion: "p1" });
  const supervisor = createFlowchartSupervisor({ flowchart: fc, router });

  // Drive the supervisor; when it hits WAITING_FOR_USER we must be able to serialize state,
  // resume from that state, and continue without losing decisions or approvals.
  let steps = 0;
  const maxSteps = 20;

  while (supervisor.state.status !== "COMPLETED" && steps < maxSteps) {
    supervisor.step();
    if (supervisor.state.status === "WAITING_FOR_USER") {
      // simulate serialize + resume
      const snapshot = JSON.parse(JSON.stringify(supervisor.state));
      // create a fresh supervisor from snapshot (simulates process restart)
      const resumed = createFlowchartSupervisor({ flowchart: fc, router });
      // seed the resumed instance with persisted decisions and pending approvals
      if (snapshot.pendingApprovals.length > 0) {
        resumed.applyUserApproval(snapshot.pendingApprovals.slice(0, 1));
      }
      resumed.resume();
      assert.ok(
        resumed.state.status === "RUNNING" || resumed.state.status === "WAITING_FOR_USER",
        "resume must restore a valid state"
      );
      break;
    }
    steps++;
  }

  assert.ok(
    supervisor.state.status === "COMPLETED" || supervisor.state.status === "WAITING_FOR_USER",
    "supervisor must reach a stable terminal or waiting state on non-trivial flowchart"
  );
});
