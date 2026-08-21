import assert from "node:assert/strict";
import { test } from "node:test";

import { createTaskId } from "../../../src/domain/ids.js";
import {
  validateConfidenceScore,
  type Flowchart,
  type FlowEdge,
  type FlowNode,
  type JoinPolicy
} from "../../../src/domain/flowchart.js";
import { createModelRouter, type ModelRouterConfig } from "../../../src/supervisor/model-router.js";
import {
  createFlowchartSupervisor,
  restoreFlowchartSupervisor,
  type FlowchartSupervisor
} from "../../../src/supervisor/flowchart-supervisor.js";

const routerConfig: ModelRouterConfig = {
  policyVersion: "router-v1",
  models: [
    { id: "cheap", version: "cheap-v1", roles: ["actor", "critic"], maxComplexity: "MEDIUM", estimatedCostUsd: 0.1, estimatedDurationMs: 1_000 },
    { id: "premium", version: "premium-v1", roles: ["actor", "critic", "judge", "router"], maxComplexity: "HIGH", estimatedCostUsd: 0.5, estimatedDurationMs: 4_000 }
  ]
};

interface NodeOpts {
  role?: FlowNode["role"];
  models?: readonly string[];
  preferred?: string;
  threshold?: number;
  approvalRequired?: boolean;
  parallelGroup?: string;
  joinPolicy?: JoinPolicy;
}

function node(id: string, opts: NodeOpts = {}): FlowNode {
  return {
    id,
    taskId: createTaskId(() => id),
    role: opts.role ?? "actor",
    objective: `Do ${id}`,
    modelPolicy: {
      allowedModels: opts.models ?? ["cheap", "premium"],
      ...(opts.preferred !== undefined ? { preferredModel: opts.preferred } : {})
    },
    confidenceThreshold: validateConfidenceScore(opts.threshold ?? 0.7),
    approvalRequired: opts.approvalRequired ?? false,
    ...(opts.parallelGroup !== undefined ? { parallelGroup: opts.parallelGroup } : {}),
    ...(opts.joinPolicy !== undefined ? { joinPolicy: opts.joinPolicy } : {})
  };
}

const successEdge = (from: string, to: string): FlowEdge => ({
  from,
  to,
  condition: { type: "success", expected: true }
});

function router() {
  return createModelRouter(routerConfig);
}

function makeSupervisor(
  flowchart: Flowchart,
  limits?: { maxConcurrentNodes?: number; maxConsecutiveStalls?: number }
): FlowchartSupervisor {
  return createFlowchartSupervisor({
    flowchart,
    router: router(),
    limits: {
      maxConcurrentNodes: limits?.maxConcurrentNodes ?? 4,
      maxConsecutiveStalls: limits?.maxConsecutiveStalls ?? 3
    }
  });
}

const success = { outcome: "SUCCESS" as const, confidence: validateConfidenceScore(0.9), evidenceIds: ["evd-1"] };

test("a fork leases two parallel branches through the router with attributable models", () => {
  const fc: Flowchart = {
    id: "fork",
    nodes: [node("root"), node("b", { models: ["cheap"] }), node("c", { models: ["premium"], preferred: "premium" })],
    edges: [successEdge("root", "b"), successEdge("root", "c")]
  };
  const sv = makeSupervisor(fc);

  const first = sv.leaseReadyNodes();
  assert.deepEqual(
    first.map((lease) => lease.nodeId),
    ["root"]
  );
  assert.equal(first[0]!.model, "cheap");

  sv.applyChildResult("root", success);
  assert.equal(sv.nodeState("b"), "READY");
  assert.equal(sv.nodeState("c"), "READY");

  const parallel = sv.leaseReadyNodes();
  const byNode = new Map(parallel.map((lease) => [lease.nodeId, lease.model]));
  assert.deepEqual(new Set(byNode.keys()), new Set(["b", "c"]));
  assert.equal(byNode.get("b"), "cheap");
  assert.equal(byNode.get("c"), "premium");
  assert.equal(sv.nodeState("b"), "RUNNING");
  assert.equal(sv.nodeState("c"), "RUNNING");
});

test("maxConcurrentNodes bounds how many branches lease at once", () => {
  const fc: Flowchart = {
    id: "bounded",
    nodes: [node("root"), node("b", { models: ["cheap"] }), node("c", { models: ["premium"] })],
    edges: [successEdge("root", "b"), successEdge("root", "c")]
  };
  const sv = makeSupervisor(fc, { maxConcurrentNodes: 1 });

  assert.deepEqual(sv.leaseReadyNodes().map((l) => l.nodeId), ["root"]);
  sv.applyChildResult("root", success);

  const one = sv.leaseReadyNodes();
  assert.deepEqual(one.map((l) => l.nodeId), ["b"]);
  assert.deepEqual(sv.leaseReadyNodes(), [], "the concurrency cap blocks a second parallel lease");

  sv.applyChildResult("b", success);
  assert.deepEqual(sv.leaseReadyNodes().map((l) => l.nodeId), ["c"]);
});

test("selective approval executes only the chosen branch and skips the rest", () => {
  const fc: Flowchart = {
    id: "selective",
    nodes: [
      node("gate", { role: "router", approvalRequired: true, models: ["premium"] }),
      node("b", { models: ["cheap"] }),
      node("c", { models: ["premium"] })
    ],
    edges: [successEdge("gate", "b"), successEdge("gate", "c")]
  };
  const sv = makeSupervisor(fc);

  const leased = sv.leaseReadyNodes();
  assert.equal(leased[0]!.status, "WAITING_FOR_USER");
  assert.equal(sv.status, "WAITING_FOR_USER");
  const pending = sv.pendingApproval;
  assert.ok(pending, "a gate produces a pending approval");
  assert.equal(pending!.kind, "BRANCH");
  assert.equal(pending!.nodeId, "gate");
  assert.equal(pending!.question.type, "QUESTION");
  assert.equal(typeof pending!.question.confidence, "number");
  assert.ok(pending!.question.rationale && pending!.question.rationale.length > 0);
  assert.equal(pending!.plan.id, "approval:branch:gate");
  assert.notEqual(pending!.plan.id, sv.decisions[0]!.approvalPlan.id);
  assert.deepEqual(
    pending!.plan.items.map((item) => item.id),
    ["b", "c"]
  );

  // Choose a strict subset: not every checkbox is required.
  const approved = sv.applyApprovalReply({ approvalPlanId: pending!.plan.id, selectedActionIds: ["b"] });
  assert.deepEqual(approved, ["b"]);
  assert.equal(sv.nodeState("gate"), "COMPLETED");
  assert.equal(sv.nodeState("c"), "SKIPPED");
  assert.equal(sv.nodeState("b"), "READY");

  assert.deepEqual(sv.leaseReadyNodes().map((l) => l.nodeId), ["b"]);
});

test("a confidence edge only opens a branch when the recorded confidence clears the bar", () => {
  const build = (): Flowchart => ({
    id: "confidence",
    nodes: [node("a"), node("b", { models: ["cheap"] })],
    edges: [{ from: "a", to: "b", condition: { type: "confidence", operator: "gte", value: validateConfidenceScore(0.8) } }]
  });

  const open = makeSupervisor(build());
  open.leaseReadyNodes();
  open.applyChildResult("a", { outcome: "SUCCESS", confidence: validateConfidenceScore(0.85), evidenceIds: [] });
  assert.equal(open.nodeState("b"), "READY");

  const closed = makeSupervisor(build());
  closed.leaseReadyNodes();
  closed.applyChildResult("a", { outcome: "SUCCESS", confidence: validateConfidenceScore(0.5), evidenceIds: [] });
  assert.equal(closed.nodeState("b"), "SKIPPED", "an unmet confidence edge is definitively dead, not eligible");
});

test("an evidence-count edge compares the accrued evidence", () => {
  const build = (): Flowchart => ({
    id: "evidence",
    nodes: [node("a"), node("b", { models: ["cheap"] })],
    edges: [{ from: "a", to: "b", condition: { type: "evidence-count", operator: "gte", value: 2 } }]
  });

  const enough = makeSupervisor(build());
  enough.leaseReadyNodes();
  enough.applyProgress("a", { evidenceIds: ["evd-1"] });
  enough.applyChildResult("a", { outcome: "SUCCESS", evidenceIds: ["evd-2"] });
  assert.equal(enough.nodeState("b"), "READY");

  const tooFew = makeSupervisor(build());
  tooFew.leaseReadyNodes();
  tooFew.applyChildResult("a", { outcome: "SUCCESS", evidenceIds: ["evd-1"] });
  assert.equal(tooFew.nodeState("b"), "SKIPPED");
});

function forkJoin(join: JoinPolicy): Flowchart {
  return {
    id: `join-${join.mode}`,
    nodes: [
      node("root"),
      node("x", { models: ["cheap"] }),
      node("y", { models: ["cheap"] }),
      node("z", { models: ["cheap"] }),
      node("j", { role: "critic", models: ["cheap"], joinPolicy: join })
    ],
    edges: [
      successEdge("root", "x"),
      successEdge("root", "y"),
      successEdge("root", "z"),
      successEdge("x", "j"),
      successEdge("y", "j"),
      successEdge("z", "j")
    ]
  };
}

function completeFork(sv: FlowchartSupervisor, outcomes: Record<string, "SUCCESS" | "FAILURE">): void {
  sv.leaseReadyNodes();
  sv.applyChildResult("root", success);
  sv.leaseReadyNodes();
  for (const id of ["x", "y", "z"]) {
    sv.applyChildResult(id, { outcome: outcomes[id]!, confidence: validateConfidenceScore(0.9), evidenceIds: [] });
  }
}

test("join all requires every branch and dies if one fails", () => {
  const ok = makeSupervisor(forkJoin({ mode: "all", requiredNodeIds: ["x", "y", "z"] }), { maxConcurrentNodes: 3 });
  completeFork(ok, { x: "SUCCESS", y: "SUCCESS", z: "SUCCESS" });
  assert.equal(ok.nodeState("j"), "READY");

  const dead = makeSupervisor(forkJoin({ mode: "all", requiredNodeIds: ["x", "y", "z"] }), { maxConcurrentNodes: 3 });
  completeFork(dead, { x: "SUCCESS", y: "FAILURE", z: "SUCCESS" });
  assert.equal(dead.nodeState("j"), "SKIPPED", "a failed branch must not satisfy an all-join");
});

test("join any opens as soon as one branch succeeds", () => {
  const sv = makeSupervisor(forkJoin({ mode: "any", requiredNodeIds: ["x", "y", "z"] }), { maxConcurrentNodes: 3 });
  completeFork(sv, { x: "SUCCESS", y: "FAILURE", z: "FAILURE" });
  assert.equal(sv.nodeState("j"), "READY");
});

test("join quorum needs the configured count of successful branches", () => {
  const met = makeSupervisor(forkJoin({ mode: "quorum", requiredNodeIds: ["x", "y", "z"], quorum: 2 }), {
    maxConcurrentNodes: 3
  });
  completeFork(met, { x: "SUCCESS", y: "SUCCESS", z: "FAILURE" });
  assert.equal(met.nodeState("j"), "READY");

  const missed = makeSupervisor(forkJoin({ mode: "quorum", requiredNodeIds: ["x", "y", "z"], quorum: 2 }), {
    maxConcurrentNodes: 3
  });
  completeFork(missed, { x: "SUCCESS", y: "FAILURE", z: "FAILURE" });
  assert.equal(missed.nodeState("j"), "SKIPPED");
});

test("child confidence and evidence propagate to node and ledger facts/progress", () => {
  const fc: Flowchart = { id: "propagate", nodes: [node("a")], edges: [] };
  const sv = makeSupervisor(fc);
  sv.leaseReadyNodes();
  sv.applyChildResult("a", {
    outcome: "SUCCESS",
    confidence: validateConfidenceScore(0.82),
    evidenceIds: ["evd-1", "evd-2"],
    facts: [{ key: "coverage", value: "green", confidence: validateConfidenceScore(0.82) }]
  });

  const runtime = sv.nodeRuntime("a");
  assert.equal(runtime.confidence, 0.82);
  assert.equal(runtime.evidenceCount, 2);
  assert.equal(sv.snapshot().facts["coverage"], "green");

  const advanced = sv.advanceRound();
  assert.equal(advanced.progress, true);
  const ledger = sv.snapshot().ledger;
  assert.ok(ledger.facts.some((fact) => fact.key === "coverage"));
  assert.ok(ledger.progress.some((entry) => entry.what === "TASK_COMPLETED"));
  assert.ok(ledger.progress.some((entry) => entry.what === "EVIDENCE"));
});

test("repeated rounds with no new progress advance the stall counter and block", () => {
  const fc: Flowchart = { id: "stall", nodes: [node("a")], edges: [] };
  const sv = makeSupervisor(fc, { maxConsecutiveStalls: 2 });
  sv.leaseReadyNodes(); // 'a' is RUNNING but never reports progress.

  const first = sv.advanceRound();
  assert.equal(first.consecutiveStalls, 1);
  assert.equal(first.blocked, false);

  const second = sv.advanceRound();
  assert.equal(second.consecutiveStalls, 2);
  assert.equal(second.blocked, true);
  assert.equal(sv.status, "BLOCKED");
  assert.deepEqual(sv.leaseReadyNodes(), [], "a blocked run leases nothing");
});

test("progress resets the stall counter", () => {
  const fc: Flowchart = { id: "reset", nodes: [node("a"), node("b", { models: ["cheap"] })], edges: [successEdge("a", "b")] };
  const sv = makeSupervisor(fc, { maxConsecutiveStalls: 3 });
  sv.leaseReadyNodes();
  assert.equal(sv.advanceRound().consecutiveStalls, 1);
  sv.applyChildResult("a", success);
  const advanced = sv.advanceRound();
  assert.equal(advanced.progress, true);
  assert.equal(advanced.consecutiveStalls, 0);
});

test("invalid and replayed transitions are rejected", () => {
  assert.throws(
    () =>
      createFlowchartSupervisor({
        flowchart: {
          id: "cyclic",
          nodes: [node("a"), node("b")],
          edges: [successEdge("a", "b"), successEdge("b", "a")]
        },
        router: router()
      }),
    /cycle/i
  );

  const fc: Flowchart = { id: "transitions", nodes: [node("a"), node("b", { models: ["cheap"] })], edges: [successEdge("a", "b")] };
  const sv = makeSupervisor(fc);

  assert.throws(() => sv.applyChildResult("a", success), /not RUNNING/i, "cannot complete a node that was never leased");
  assert.throws(
    () => sv.applyApprovalReply({ approvalPlanId: "x", selectedActionIds: [] }),
    /No pending approval/i
  );

  sv.leaseReadyNodes();
  sv.applyChildResult("a", success);
  assert.throws(() => sv.applyChildResult("a", success), /not RUNNING/i, "a replayed result is rejected");
  assert.deepEqual(sv.leaseReadyNodes().map((l) => l.nodeId), ["b"], "a completed node is never re-leased");
});

test("a snapshot restores pending approval and router state exactly", () => {
  const fc: Flowchart = {
    id: "restore-approval",
    nodes: [
      node("gate", { role: "router", approvalRequired: true, models: ["premium"] }),
      node("b", { models: ["cheap"] }),
      node("c", { models: ["premium"] })
    ],
    edges: [successEdge("gate", "b"), successEdge("gate", "c")]
  };
  const sv = makeSupervisor(fc);
  sv.leaseReadyNodes();

  const snapshot = sv.snapshot();
  assert.equal(snapshot.status, "WAITING_FOR_USER");
  const restored = restoreFlowchartSupervisor({ flowchart: fc, router: router() }, snapshot);

  assert.equal(restored.status, "WAITING_FOR_USER");
  assert.deepEqual(restored.pendingApproval, sv.pendingApproval);
  assert.deepEqual(restored.decisions, sv.decisions);
  assert.equal(restored.nodeState("gate"), "WAITING_FOR_USER");

  const plan = restored.pendingApproval!.plan;
  restored.applyApprovalReply({ approvalPlanId: plan.id, selectedActionIds: ["c"] });
  assert.equal(restored.nodeState("b"), "SKIPPED");
  assert.equal(restored.nodeState("c"), "READY");
  assert.deepEqual(restored.leaseReadyNodes().map((l) => l.nodeId), ["c"]);

  const afterApproval = restored.snapshot();
  assert.deepEqual(afterApproval.approvedActionIds, ["c"]);
  assert.equal(afterApproval.nodes["c"]!.state, "RUNNING");
  const restoredAfter = restoreFlowchartSupervisor({ flowchart: fc, router: router() }, afterApproval);
  assert.deepEqual(restoredAfter.snapshot().approvedActionIds, ["c"]);
  assert.equal(restoredAfter.nodeState("b"), "SKIPPED");
  assert.equal(restoredAfter.nodeState("c"), "RUNNING");
});

test("a snapshot restores active routes for a running node", () => {
  const fc: Flowchart = { id: "restore-running", nodes: [node("a", { models: ["premium"] }), node("b", { models: ["cheap"] })], edges: [successEdge("a", "b")] };
  const sv = makeSupervisor(fc);
  const leased = sv.leaseReadyNodes();
  assert.equal(leased[0]!.model, "premium");

  const snapshot = sv.snapshot();
  assert.equal(snapshot.activeRoutes["a"]!.model, "premium");

  const restored = restoreFlowchartSupervisor({ flowchart: fc, router: router() }, snapshot);
  assert.equal(restored.nodeState("a"), "RUNNING");
  assert.equal(restored.snapshot().activeRoutes["a"]!.model, "premium");
  assert.deepEqual(restored.decisions, sv.decisions);

  restored.applyChildResult("a", success);
  assert.equal(restored.nodeState("a"), "COMPLETED");
  assert.deepEqual(restored.leaseReadyNodes().map((l) => l.nodeId), ["b"]);
});

test("an approvalRequired work node returns to RUNNING after route approval, then needs a child result", () => {
  const fc: Flowchart = {
    id: "route-approval",
    nodes: [node("actor", { approvalRequired: true, models: ["cheap"] }), node("next", { models: ["cheap"] })],
    edges: [successEdge("actor", "next")]
  };
  const sv = makeSupervisor(fc);
  const leased = sv.leaseReadyNodes();
  assert.equal(leased[0]!.status, "WAITING_FOR_USER");
  const pending = sv.pendingApproval;
  assert.ok(pending);
  assert.equal(pending!.kind, "ROUTE");
  assert.equal(pending!.plan.id, sv.decisions[0]!.approvalPlan.id);
  assert.deepEqual(
    pending!.plan.items.map((item) => item.id),
    ["route:cheap", "route:cancel"]
  );
  assert.equal(sv.snapshot().activeRoutes["actor"]!.model, "cheap");

  const approved = sv.applyApprovalReply({
    approvalPlanId: pending!.plan.id,
    selectedActionIds: ["route:cheap"]
  });
  assert.deepEqual(approved, ["route:cheap"]);
  assert.equal(sv.nodeState("actor"), "RUNNING");
  assert.equal(sv.snapshot().activeRoutes["actor"]!.model, "cheap");
  assert.equal(sv.nodeState("next"), "PENDING");
  assert.throws(() => sv.applyApprovalReply({ approvalPlanId: pending!.plan.id, selectedActionIds: ["route:cheap"] }), /No pending approval/i);

  sv.applyChildResult("actor", success);
  assert.equal(sv.nodeState("actor"), "COMPLETED");
  assert.equal(sv.nodeRuntime("actor").confidence, 0.9);
  assert.equal(sv.nodeRuntime("actor").evidenceCount, 1);
  assert.deepEqual(sv.leaseReadyNodes().map((l) => l.nodeId), ["next"]);
});

test("cancelling a route approval skips the work node without inventing a child result", () => {
  const fc: Flowchart = {
    id: "route-cancel",
    nodes: [node("actor", { approvalRequired: true, models: ["cheap"] }), node("next", { models: ["cheap"] })],
    edges: [successEdge("actor", "next")]
  };
  const sv = makeSupervisor(fc);
  sv.leaseReadyNodes();
  const pending = sv.pendingApproval!;
  assert.equal(pending.kind, "ROUTE");
  sv.applyApprovalReply({ approvalPlanId: pending.plan.id, selectedActionIds: ["route:cancel"] });
  assert.equal(sv.nodeState("actor"), "SKIPPED");
  assert.equal(sv.nodeState("next"), "SKIPPED");
  assert.equal(sv.snapshot().activeRoutes["actor"], undefined);
});

test("a user-decision edge unlocks, stays blocked, or dies from the recorded answer", () => {
  const build = (): Flowchart => ({
    id: "user-decision",
    nodes: [node("a"), node("b", { models: ["cheap"] })],
    edges: [{ from: "a", to: "b", condition: { type: "user-decision", decisionId: "ship", equals: true } }]
  });

  const open = makeSupervisor(build());
  open.leaseReadyNodes();
  open.applyChildResult("a", success);
  assert.equal(open.nodeState("b"), "PENDING", "absent user decision is undetermined, not a skip");
  open.applyUserDecision("ship", true);
  assert.equal(open.nodeState("b"), "READY");

  const blocked = makeSupervisor(build());
  blocked.leaseReadyNodes();
  blocked.applyChildResult("a", success);
  assert.equal(blocked.nodeState("b"), "PENDING");

  const closed = makeSupervisor(build());
  closed.leaseReadyNodes();
  closed.applyChildResult("a", success);
  closed.applyUserDecision("ship", false);
  assert.equal(closed.nodeState("b"), "SKIPPED");
});

test("a custom-fact edge unlocks, stays blocked, or dies from recorded facts", () => {
  const build = (): Flowchart => ({
    id: "custom-fact",
    nodes: [node("a"), node("b", { models: ["cheap"] })],
    edges: [{ from: "a", to: "b", condition: { type: "custom", key: "risk", operator: "eq", value: "low" } }]
  });

  const open = makeSupervisor(build());
  open.leaseReadyNodes();
  open.applyChildResult("a", {
    outcome: "SUCCESS",
    confidence: validateConfidenceScore(0.9),
    evidenceIds: ["evd-1"],
    facts: [{ key: "risk", value: "low", confidence: validateConfidenceScore(0.9) }]
  });
  assert.equal(open.nodeState("b"), "READY");

  const blocked = makeSupervisor(build());
  blocked.leaseReadyNodes();
  blocked.applyChildResult("a", success);
  assert.equal(blocked.nodeState("b"), "PENDING");

  const closed = makeSupervisor(build());
  closed.leaseReadyNodes();
  closed.applyChildResult("a", {
    outcome: "SUCCESS",
    confidence: validateConfidenceScore(0.9),
    evidenceIds: ["evd-1"],
    facts: [{ key: "risk", value: "high", confidence: validateConfidenceScore(0.9) }]
  });
  assert.equal(closed.nodeState("b"), "SKIPPED");
});

test("deprecated joinRules are honoured and cannot collide with joinPolicy", () => {
  const fc: Flowchart = {
    id: "legacy-join",
    nodes: [
      node("a", { models: ["cheap"] }),
      node("b", { models: ["cheap"] }),
      node("j", { role: "critic", models: ["cheap"] })
    ],
    edges: [successEdge("a", "j"), successEdge("b", "j")],
    joinRules: { j: { required: ["a", "b"], policy: "all" } }
  };
  const sv = makeSupervisor(fc, { maxConcurrentNodes: 2 });
  sv.leaseReadyNodes();
  sv.applyChildResult("a", success);
  sv.applyChildResult("b", success);
  assert.equal(sv.nodeState("j"), "READY");

  assert.throws(
    () =>
      createFlowchartSupervisor({
        flowchart: {
          ...fc,
          nodes: [
            node("a", { models: ["cheap"] }),
            node("b", { models: ["cheap"] }),
            node("j", {
              role: "critic",
              models: ["cheap"],
              joinPolicy: { mode: "any", requiredNodeIds: ["a", "b"] }
            })
          ]
        },
        router: router()
      }),
    /joinPolicy and a deprecated joinRules entry/i
  );
});

test("a snapshot restores approved actions, user decisions, facts, and ledger round", () => {
  const fc: Flowchart = {
    id: "restore-ledger",
    nodes: [node("a"), node("b", { models: ["cheap"] })],
    edges: [{ from: "a", to: "b", condition: { type: "user-decision", decisionId: "go", equals: true } }]
  };
  const sv = makeSupervisor(fc);
  sv.leaseReadyNodes();
  sv.applyChildResult("a", {
    outcome: "SUCCESS",
    confidence: validateConfidenceScore(0.91),
    evidenceIds: ["evd-9"],
    facts: [{ key: "coverage", value: "green", confidence: validateConfidenceScore(0.91) }]
  });
  sv.applyUserDecision("go", true);
  const advanced = sv.advanceRound();
  assert.equal(advanced.progress, true);

  const snapshot = sv.snapshot();
  assert.deepEqual(snapshot.userDecisions, { go: true });
  assert.equal(snapshot.facts["coverage"], "green");
  assert.equal(snapshot.ledger.round, 1);
  assert.equal(snapshot.ledger.consecutiveStalls, 0);

  const restored = restoreFlowchartSupervisor({ flowchart: fc, router: router() }, snapshot);
  assert.deepEqual(restored.snapshot().userDecisions, { go: true });
  assert.equal(restored.snapshot().facts["coverage"], "green");
  assert.equal(restored.snapshot().ledger.round, 1);
  assert.equal(restored.nodeState("b"), "READY");
  assert.deepEqual(restored.leaseReadyNodes().map((l) => l.nodeId), ["b"]);
});

test("a one-node FAILURE child result fails the run, not completes it", () => {
  const fc: Flowchart = { id: "fail-closed", nodes: [node("only")], edges: [] };
  const sv = makeSupervisor(fc);
  sv.leaseReadyNodes();
  sv.applyChildResult("only", { outcome: "FAILURE", evidenceIds: [] });
  assert.equal(sv.nodeState("only"), "FAILED");
  assert.equal(sv.status, "FAILED");
});

test("a success:expected-false recovery that completes the graph is COMPLETED", () => {
  const fc: Flowchart = {
    id: "recovery",
    nodes: [node("a"), node("recover", { models: ["cheap"] })],
    edges: [{ from: "a", to: "recover", condition: { type: "success", expected: false } }]
  };
  const sv = makeSupervisor(fc);
  sv.leaseReadyNodes();
  sv.applyChildResult("a", { outcome: "FAILURE", evidenceIds: [] });
  assert.equal(sv.nodeState("a"), "FAILED");
  assert.equal(sv.nodeState("recover"), "READY");
  sv.leaseReadyNodes();
  sv.applyChildResult("recover", success);
  assert.equal(sv.nodeState("recover"), "COMPLETED");
  assert.equal(sv.status, "COMPLETED");
});

test("a high-confidence router gate auto-selects defaults and never becomes a RUNNING worker", () => {
  const fc: Flowchart = {
    id: "auto-branch",
    nodes: [
      node("gate", { role: "router", approvalRequired: false, models: ["premium"], preferred: "premium" }),
      node("chosen", { models: ["cheap"] }),
      node("skipped", { models: ["cheap"] })
    ],
    edges: [
      successEdge("gate", "chosen"),
      {
        from: "gate",
        to: "skipped",
        condition: { type: "success", expected: true },
        defaultSelected: false
      }
    ]
  };
  const sv = makeSupervisor(fc);
  const leases = sv.leaseReadyNodes();
  assert.equal(sv.pendingApproval, undefined);
  assert.equal(sv.nodeState("gate"), "COMPLETED");
  assert.notEqual(sv.nodeState("gate"), "RUNNING");
  assert.equal(sv.nodeState("skipped"), "SKIPPED");
  assert.equal(sv.nodeState("chosen"), "RUNNING");
  assert.ok(leases.some((lease) => lease.nodeId === "gate" && lease.status === "COMPLETED"));
  assert.throws(() => sv.applyChildResult("gate", success), /not RUNNING/i);
  sv.applyChildResult("chosen", success);
  assert.equal(sv.nodeState("chosen"), "COMPLETED");
  assert.equal(sv.status, "COMPLETED");
});

test("routing remaining cost is consumed after each successful route and fail-closes later nodes", () => {
  const fc: Flowchart = {
    id: "budget",
    nodes: [
      node("a", { models: ["premium"], preferred: "premium" }),
      node("b", { models: ["premium"], preferred: "premium" })
    ],
    edges: [successEdge("a", "b")]
  };
  const sv = createFlowchartSupervisor({
    flowchart: fc,
    router: router(),
    limits: { maxConcurrentNodes: 4, maxConsecutiveStalls: 3, remainingCostUsd: 0.6 }
  });
  const first = sv.leaseReadyNodes();
  assert.deepEqual(
    first.map((lease) => lease.nodeId),
    ["a"]
  );
  const remainingAfterFirst = sv.snapshot().remainingCostUsd;
  assert.equal(typeof remainingAfterFirst, "number");
  assert.ok((remainingAfterFirst as number) < 0.5, "first 0.5-cost route must consume remaining budget");
  sv.applyChildResult("a", success);
  assert.equal(sv.nodeState("b"), "READY");
  const second = sv.leaseReadyNodes();
  assert.deepEqual(second, []);
  assert.equal(sv.nodeState("b"), "FAILED");
  assert.equal(sv.status, "FAILED");

  const restored = restoreFlowchartSupervisor(
    {
      flowchart: fc,
      router: router(),
      limits: { maxConcurrentNodes: 4, maxConsecutiveStalls: 3, remainingCostUsd: 0.6 }
    },
    sv.snapshot()
  );
  assert.equal(restored.snapshot().remainingCostUsd, remainingAfterFirst);
  assert.equal(restored.nodeState("b"), "FAILED");
  assert.equal(restored.status, "FAILED");
});
