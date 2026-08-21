import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createTaskId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import {
  validateConfidenceScore,
  type Flowchart,
  type FlowEdge,
  type FlowNode,
  type JoinPolicy
} from "../../../src/domain/flowchart.js";
import { resumeFlowchartRun, startFlowchartRun } from "../../../src/run/flowchart-run.js";
import { createModelRouter, type ModelRouter } from "../../../src/supervisor/model-router.js";
import type { ChildNodeResult } from "../../../src/supervisor/flowchart-supervisor.js";
import type { AgentExecutor, ExecutionEvent } from "../../../src/execution/contract.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";
import { PASSED_NODE_CONFIDENCE } from "../../../src/run/flowchart-executor.js";

function sequenceGenerator(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`;
}

const routerConfig = {
  policyVersion: "router-v1",
  models: [
    { id: "cheap", version: "cheap-v1", roles: ["actor", "critic"] as const, maxComplexity: "MEDIUM" as const, estimatedCostUsd: 0.1, estimatedDurationMs: 1_000 },
    { id: "premium", version: "premium-v1", roles: ["actor", "critic", "judge", "router"] as const, maxComplexity: "HIGH" as const, estimatedCostUsd: 0.5, estimatedDurationMs: 4_000 }
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

function router(): ModelRouter {
  return createModelRouter(routerConfig);
}

function fakeResult(confidence: number, evidence: string, factValue = "green"): ChildNodeResult {
  return {
    outcome: "SUCCESS",
    confidence: validateConfidenceScore(confidence),
    evidenceIds: [evidence],
    facts: [{ key: "coverage", value: factValue, confidence: validateConfidenceScore(confidence) }]
  };
}

/** Fork to two specialists; join all so the cheapSpec confidence edge is causal. */
function forkJoinFlowchart(): Flowchart {
  return {
    id: "fork-confidence-join",
    nodes: [
      node("start"),
      node("cheapSpec", { models: ["cheap"], parallelGroup: "specialists" }),
      node("premiumSpec", { models: ["premium"], preferred: "premium", parallelGroup: "specialists" }),
      node("merge", {
        role: "critic",
        models: ["cheap", "premium"],
        joinPolicy: { mode: "all", requiredNodeIds: ["cheapSpec", "premiumSpec"] }
      })
    ],
    edges: [
      successEdge("start", "cheapSpec"),
      successEdge("start", "premiumSpec"),
      { from: "cheapSpec", to: "merge", condition: { type: "confidence", operator: "gte", value: validateConfidenceScore(0.8) } },
      successEdge("premiumSpec", "merge")
    ]
  };
}

/** Same fork/join, then a selective approval gate with two successors. */
function selectiveFlowchart(): Flowchart {
  const base = forkJoinFlowchart();
  return {
    id: "fork-confidence-selective",
    nodes: [
      ...base.nodes,
      node("selector", { role: "router", models: ["premium"], approvalRequired: true }),
      node("pathA", { models: ["cheap"] }),
      node("pathB", { models: ["premium"], preferred: "premium" })
    ],
    edges: [...base.edges, successEdge("merge", "selector"), successEdge("selector", "pathA"), successEdge("selector", "pathB")]
  };
}

const specialistResults: Readonly<Record<string, ChildNodeResult>> = {
  start: fakeResult(0.9, "evd_start"),
  cheapSpec: fakeResult(0.91, "evd_cheap"),
  premiumSpec: fakeResult(0.88, "evd_premium"),
  merge: fakeResult(0.86, "evd_merge")
};

async function withTempState(run: (stateRoot: string, projectRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-m25-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-m25-proj-"));
  try {
    await run(stateRoot, projectRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

function deps(stateRoot: string) {
  return {
    stateRoot,
    router: router(),
    now: () => parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
    generateId: sequenceGenerator()
  };
}

function routedModel(events: readonly { type: string; payload: unknown }[], taskSuffix: string): string | undefined {
  const event = events.find((entry) => {
    if (entry.type !== "MODEL_ROUTED") return false;
    const payload = entry.payload as { taskId: string };
    return payload.taskId === `tsk_${taskSuffix}`;
  });
  return event === undefined ? undefined : (event.payload as { model: string }).model;
}

test("a fork with different models, a confidence gate, and a selective join completes with fake results", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const outcome = await startFlowchartRun(deps(stateRoot), {
      projectRoot,
      flowchart: forkJoinFlowchart(),
      objective: "Ship mixed-model work",
      childResults: specialistResults
    });

    assert.equal(outcome.status, "COMPLETED");
    assert.equal(outcome.snapshot.nodes["start"]?.state, "COMPLETED");
    assert.equal(outcome.snapshot.nodes["cheapSpec"]?.state, "COMPLETED");
    assert.equal(outcome.snapshot.nodes["premiumSpec"]?.state, "COMPLETED");
    assert.equal(outcome.snapshot.nodes["merge"]?.state, "COMPLETED");
    assert.equal(routedModel(outcome.events, "cheapSpec"), "cheap");
    assert.equal(routedModel(outcome.events, "premiumSpec"), "premium");
    assert.ok(outcome.snapshot.ledger.facts.some((fact) => fact.key === "coverage" && fact.confidence > 0));
    assert.ok(outcome.checkpoint.flowchart, "completed flowchart runs persist a snapshot");
    assert.equal(outcome.checkpoint.flowchart?.snapshot.status, "COMPLETED");
    assert.equal(
      outcome.events.filter((event) => event.type === "MODEL_ROUTED").length,
      4,
      "each node is routed once"
    );
  });
});

test("a cheapSpec confidence of 0.5 leaves the all-join merge SKIPPED", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const outcome = await startFlowchartRun(deps(stateRoot), {
      projectRoot,
      flowchart: forkJoinFlowchart(),
      objective: "Confidence gate must be causal",
      childResults: {
        start: fakeResult(0.9, "evd_start"),
        cheapSpec: fakeResult(0.5, "evd_cheap"),
        premiumSpec: fakeResult(0.88, "evd_premium"),
        merge: fakeResult(0.86, "evd_merge")
      }
    });

    assert.equal(outcome.status, "COMPLETED");
    assert.equal(outcome.snapshot.nodes["cheapSpec"]?.state, "COMPLETED");
    assert.equal(outcome.snapshot.nodes["premiumSpec"]?.state, "COMPLETED");
    assert.equal(outcome.snapshot.nodes["merge"]?.state, "SKIPPED");
    assert.equal(routedModel(outcome.events, "cheapSpec"), "cheap");
    assert.equal(routedModel(outcome.events, "premiumSpec"), "premium");
    assert.equal(routedModel(outcome.events, "merge"), undefined, "a skipped merge is never leased");
  });
});

test("a selective join waits for the user and continues after a subset selection", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const first = await startFlowchartRun(deps(stateRoot), {
      projectRoot,
      flowchart: selectiveFlowchart(),
      objective: "Choose a branch",
      childResults: specialistResults
    });

    assert.equal(first.status, "WAITING_FOR_USER");
    const pending = first.pendingApproval;
    assert.ok(pending, "selector produces a pending approval");
    assert.equal(pending.kind, "BRANCH");
    assert.equal(pending.nodeId, "selector");
    const waiting = first.events.filter((event) => event.type === "RUN_WAITING_FOR_USER");
    assert.equal(waiting.length, 1);
    assert.deepEqual((waiting[0]!.payload as { approvalPlan: { id: string } }).approvalPlan.id, pending.plan.id);
    assert.deepEqual(
      pending.plan.items.map((item) => item.id),
      ["pathA", "pathB"]
    );

    const continued = await resumeFlowchartRun(deps(stateRoot), first.runId, {
      approvalReply: { approvalPlanId: pending.plan.id, selectedActionIds: ["pathA"] },
      childResults: { pathA: fakeResult(0.84, "evd_pathA") }
    });

    assert.equal(continued.status, "COMPLETED");
    assert.equal(continued.snapshot.nodes["pathA"]?.state, "COMPLETED");
    assert.equal(continued.snapshot.nodes["pathB"]?.state, "SKIPPED");
    assert.deepEqual(continued.snapshot.approvedActionIds, ["pathA"]);
    const answers = continued.events.filter((event) => event.type === "USER_ANSWER");
    assert.equal(answers.length, 1);
    const payload = answers[0]!.payload as unknown as {
      approvalReply?: { approvalPlanId: string; selectedActionIds: readonly string[] };
      approvalPlan?: unknown;
    };
    assert.equal(payload.approvalPlan, undefined, "USER_ANSWER must not carry a client-supplied plan");
    assert.deepEqual(payload.approvalReply, { approvalPlanId: pending.plan.id, selectedActionIds: ["pathA"] });
  });
});

test("stall while a hung RUNNING actor makes no progress is durable", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const outcome = await startFlowchartRun(deps(stateRoot), {
      projectRoot,
      flowchart: { id: "stall", nodes: [node("hung")], edges: [] },
      limits: { maxConsecutiveStalls: 2, maxRounds: 8 },
      childResults: {}
    });

    assert.equal(outcome.status, "BLOCKED");
    assert.equal(outcome.snapshot.ledger.isBlocked, true);
    assert.equal(outcome.snapshot.ledger.consecutiveStalls, 2);
    assert.ok(outcome.events.some((event) => event.type === "STALL_DETECTED"));
    assert.ok(outcome.events.some((event) => event.type === "RUN_BLOCKED"));
    assert.equal(outcome.checkpoint.flowchart?.snapshot.ledger.isBlocked, true);

    const resumed = await resumeFlowchartRun(deps(stateRoot), outcome.runId);
    assert.equal(resumed.status, "BLOCKED");
    assert.equal(resumed.snapshot.ledger.isBlocked, true);
    assert.equal(resumed.snapshot.nodes["hung"]?.state, "RUNNING");
    assert.equal(
      resumed.events.filter((event) => event.type === "MODEL_ROUTED").length,
      outcome.events.filter((event) => event.type === "MODEL_ROUTED").length,
      "blocked resume must not reroute"
    );
  });
});

test("a stuck confidence-join that stays PENDING stalls and is durable", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const flowchart: Flowchart = {
      id: "stuck-confidence-join",
      nodes: [
        node("start"),
        node("cheapSpec", { models: ["cheap"] }),
        node("premiumSpec", { models: ["premium"], preferred: "premium" }),
        node("merge", {
          role: "critic",
          models: ["cheap", "premium"],
          joinPolicy: { mode: "all", requiredNodeIds: ["cheapSpec", "premiumSpec"] }
        })
      ],
      edges: [
        successEdge("start", "cheapSpec"),
        { from: "start", to: "premiumSpec", condition: { type: "user-decision", decisionId: "ship", equals: true } },
        { from: "cheapSpec", to: "merge", condition: { type: "confidence", operator: "gte", value: validateConfidenceScore(0.8) } },
        successEdge("premiumSpec", "merge")
      ]
    };

    const outcome = await startFlowchartRun(deps(stateRoot), {
      projectRoot,
      flowchart,
      limits: { maxConsecutiveStalls: 2, maxRounds: 8 },
      childResults: {
        start: fakeResult(0.9, "evd_start"),
        cheapSpec: fakeResult(0.91, "evd_cheap")
      }
    });

    assert.equal(outcome.status, "BLOCKED");
    assert.equal(outcome.snapshot.nodes["cheapSpec"]?.state, "COMPLETED");
    assert.equal(outcome.snapshot.nodes["premiumSpec"]?.state, "PENDING");
    assert.equal(outcome.snapshot.nodes["merge"]?.state, "PENDING");
    assert.equal(outcome.snapshot.ledger.isBlocked, true);
    assert.ok(outcome.events.some((event) => event.type === "STALL_DETECTED"));

    const resumed = await resumeFlowchartRun(deps(stateRoot), outcome.runId);
    assert.equal(resumed.status, "BLOCKED");
    assert.equal(resumed.snapshot.nodes["merge"]?.state, "PENDING");
    assert.equal(resumed.snapshot.nodes["premiumSpec"]?.state, "PENDING");
    assert.equal(resumed.snapshot.ledger.isBlocked, true);
  });
});

test("a one-node FAILURE child result emits RUN_FAILED", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const outcome = await startFlowchartRun(deps(stateRoot), {
      projectRoot,
      flowchart: { id: "fail-one", nodes: [node("only")], edges: [] },
      childResults: { only: { outcome: "FAILURE", evidenceIds: [] } }
    });

    assert.equal(outcome.status, "FAILED");
    assert.equal(outcome.snapshot.status, "FAILED");
    assert.equal(outcome.snapshot.nodes["only"]?.state, "FAILED");
    assert.ok(outcome.events.some((event) => event.type === "RUN_FAILED"));
    assert.equal(
      outcome.events.some((event) => event.type === "RUN_COMPLETED"),
      false
    );
  });
});

test("two 0.5-cost nodes under remainingCostUsd 0.6 fail closed after the first route", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const outcome = await startFlowchartRun(deps(stateRoot), {
      projectRoot,
      flowchart: {
        id: "budget",
        nodes: [
          node("a", { models: ["premium"], preferred: "premium" }),
          node("b", { models: ["premium"], preferred: "premium" })
        ],
        edges: [successEdge("a", "b")]
      },
      limits: { remainingCostUsd: 0.6 },
      childResults: {
        a: fakeResult(0.9, "evd_a"),
        b: fakeResult(0.9, "evd_b")
      }
    });

    assert.equal(outcome.status, "FAILED");
    assert.equal(outcome.snapshot.nodes["a"]?.state, "COMPLETED");
    assert.equal(outcome.snapshot.nodes["b"]?.state, "FAILED");
    assert.equal(
      outcome.events.filter((event) => event.type === "MODEL_ROUTED").length,
      1
    );
    assert.ok(outcome.events.some((event) => event.type === "RUN_FAILED"));
    const remaining = outcome.checkpoint.flowchart?.limits.remainingCostUsd;
    assert.equal(typeof remaining, "number");
    assert.ok((remaining as number) < 0.5);
    assert.equal(outcome.snapshot.remainingCostUsd, remaining);
  });
});

class FailingExecutor implements AgentExecutor {
  async *execute(): AsyncIterable<ExecutionEvent> {
    yield { type: "EXECUTION_FINISHED", outcome: "FAILURE" };
  }
}

test("an executor completes a one-node flowchart without childResults", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const outcome = await startFlowchartRun(
      { ...deps(stateRoot), executor: new ProtocolChildExecutor() },
      {
        projectRoot,
        flowchart: { id: "executor-only", nodes: [node("only")], edges: [] },
        objective: "Ship via executor"
      }
    );
    assert.equal(outcome.status, "COMPLETED");
    assert.equal(outcome.snapshot.nodes["only"]?.state, "COMPLETED");
    assert.equal(outcome.snapshot.nodes["only"]?.confidence, PASSED_NODE_CONFIDENCE);
    assert.ok(outcome.events.some((event) => event.type === "AGENT_STARTED"));
    assert.ok(outcome.events.some((event) => event.type === "AGENT_FINISHED"));
  });
});

test("explicit childResults win over a failing executor", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const outcome = await startFlowchartRun(
      { ...deps(stateRoot), executor: new FailingExecutor() },
      {
        projectRoot,
        flowchart: { id: "results-win", nodes: [node("only")], edges: [] },
        childResults: { only: fakeResult(0.91, "evd_override") }
      }
    );
    assert.equal(outcome.status, "COMPLETED");
    assert.equal(outcome.snapshot.nodes["only"]?.state, "COMPLETED");
    assert.equal(outcome.snapshot.nodes["only"]?.confidence, 0.91);
  });
});

test("a failing executor without results fails the node", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const outcome = await startFlowchartRun(
      { ...deps(stateRoot), executor: new FailingExecutor() },
      {
        projectRoot,
        flowchart: { id: "executor-fail", nodes: [node("only")], edges: [] }
      }
    );
    assert.equal(outcome.status, "FAILED");
    assert.equal(outcome.snapshot.nodes["only"]?.state, "FAILED");
  });
});
