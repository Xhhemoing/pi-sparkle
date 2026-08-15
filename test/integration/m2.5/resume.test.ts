import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
import { CheckpointStore } from "../../../src/run/checkpoint-store.js";
import { createModelRouter, type ModelRouter } from "../../../src/supervisor/model-router.js";
import type { ChildNodeResult } from "../../../src/supervisor/flowchart-supervisor.js";

function sequenceGenerator(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`;
}

const routerConfig = {
  policyVersion: "router-v1",
  models: [
    { id: "cheap", roles: ["actor", "critic"] as const, maxComplexity: "MEDIUM" as const, estimatedCostUsd: 0.1, estimatedDurationMs: 1_000 },
    { id: "premium", roles: ["actor", "critic", "judge", "router"] as const, maxComplexity: "HIGH" as const, estimatedCostUsd: 0.5, estimatedDurationMs: 4_000 }
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

function fakeResult(confidence: number, evidence: string): ChildNodeResult {
  return {
    outcome: "SUCCESS",
    confidence: validateConfidenceScore(confidence),
    evidenceIds: [evidence],
    facts: [{ key: "coverage", value: "green", confidence: validateConfidenceScore(confidence) }]
  };
}

function selectiveFlowchart(): Flowchart {
  return {
    id: "crash-selective",
    nodes: [
      node("start"),
      node("cheapSpec", { models: ["cheap"], parallelGroup: "specialists" }),
      node("premiumSpec", { models: ["premium"], preferred: "premium", parallelGroup: "specialists" }),
      node("merge", {
        role: "critic",
        models: ["cheap", "premium"],
        joinPolicy: { mode: "all", requiredNodeIds: ["cheapSpec", "premiumSpec"] }
      }),
      node("selector", { role: "router", models: ["premium"], approvalRequired: true }),
      node("pathA", { models: ["cheap"] }),
      node("pathB", { models: ["premium"], preferred: "premium" })
    ],
    edges: [
      successEdge("start", "cheapSpec"),
      successEdge("start", "premiumSpec"),
      {
        from: "cheapSpec",
        to: "merge",
        condition: { type: "confidence", operator: "gte", value: validateConfidenceScore(0.8) }
      },
      successEdge("premiumSpec", "merge"),
      successEdge("merge", "selector"),
      successEdge("selector", "pathA"),
      successEdge("selector", "pathB")
    ]
  };
}

const specialistResults: Readonly<Record<string, ChildNodeResult>> = {
  start: fakeResult(0.9, "evd_start"),
  cheapSpec: fakeResult(0.91, "evd_cheap"),
  premiumSpec: fakeResult(0.88, "evd_premium"),
  merge: fakeResult(0.86, "evd_merge")
};

async function withTempState(run: (stateRoot: string, projectRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-m25-resume-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-m25-resume-proj-"));
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

function routedCount(events: readonly { type: string }[]): number {
  return events.filter((event) => event.type === "MODEL_ROUTED").length;
}

test("crash after WAITING_FOR_USER restores pending plan and decisions from disk", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const first = await startFlowchartRun(deps(stateRoot), {
      projectRoot,
      flowchart: selectiveFlowchart(),
      objective: "Crash mid-approval",
      childResults: specialistResults
    });
    assert.equal(first.status, "WAITING_FOR_USER");
    const firstRouted = routedCount(first.events);
    const pendingPlan = first.pendingApproval?.plan;
    assert.ok(pendingPlan);
    const firstDecisions = first.snapshot.decisions.map((decision) => decision.model);

    // Fresh process: new router, stores, and supervisor loaded only from stateRoot+runId.
    const restored = await resumeFlowchartRun(deps(stateRoot), first.runId);
    assert.equal(restored.status, "WAITING_FOR_USER");
    assert.ok(restored.pendingApproval);
    assert.deepEqual(restored.pendingApproval.plan, pendingPlan);
    assert.deepEqual(
      restored.snapshot.decisions.map((decision) => decision.model),
      firstDecisions
    );
    assert.equal(restored.snapshot.nodes["start"]?.state, "COMPLETED");
    assert.equal(restored.snapshot.nodes["cheapSpec"]?.state, "COMPLETED");
    assert.equal(restored.snapshot.nodes["premiumSpec"]?.state, "COMPLETED");
    assert.equal(restored.snapshot.nodes["merge"]?.state, "COMPLETED");
    assert.equal(restored.snapshot.nodes["selector"]?.state, "WAITING_FOR_USER");
    assert.ok(restored.snapshot.activeRoutes["selector"], "waiting selector keeps its active route");
    assert.equal(restored.snapshot.activeRoutes["selector"]?.model, first.snapshot.activeRoutes["selector"]?.model);
    assert.deepEqual(restored.snapshot.activeRoutes, first.snapshot.activeRoutes);
    assert.equal(routedCount(restored.events), firstRouted, "completed work must not be rerouted");

    const continued = await resumeFlowchartRun(deps(stateRoot), first.runId, {
      approvalReply: { approvalPlanId: pendingPlan.id, selectedActionIds: ["pathA"] },
      childResults: { pathA: fakeResult(0.84, "evd_pathA") }
    });
    assert.equal(continued.status, "COMPLETED");
    assert.equal(continued.snapshot.nodes["pathA"]?.state, "COMPLETED");
    assert.equal(continued.snapshot.nodes["pathB"]?.state, "SKIPPED");
    assert.equal(continued.snapshot.nodes["start"]?.state, "COMPLETED");
    const pathARoutes = continued.events.filter(
      (event) => event.type === "MODEL_ROUTED" && (event.payload as { taskId: string }).taskId === "tsk_pathA"
    );
    assert.equal(pathARoutes.length, 1);
    assert.equal(
      continued.events.filter(
        (event) => event.type === "MODEL_ROUTED" && (event.payload as { taskId: string }).taskId === "tsk_start"
      ).length,
      1,
      "completed start node is not rerun"
    );
  });
});

test("resume fails closed when the checkpoint is missing", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const first = await startFlowchartRun(deps(stateRoot), {
      projectRoot,
      flowchart: selectiveFlowchart(),
      childResults: specialistResults
    });
    assert.equal(first.status, "WAITING_FOR_USER");
    await rm(join(stateRoot, "runs", first.runId, "checkpoint.json"));
    await assert.rejects(
      () => resumeFlowchartRun(deps(stateRoot), first.runId),
      /no durable checkpoint|refusing to invent/
    );
  });
});

test("resume fails closed on a malformed flowchart snapshot", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const first = await startFlowchartRun(deps(stateRoot), {
      projectRoot,
      flowchart: selectiveFlowchart(),
      childResults: specialistResults
    });
    assert.equal(first.status, "WAITING_FOR_USER");
    const store = new CheckpointStore(stateRoot, first.runId);
    const raw = (await store.read()) as Record<string, unknown>;
    const flowchart = raw.flowchart as { snapshot: { nodes: Record<string, { confidence?: number }> } };
    flowchart.snapshot.nodes["selector"] = { ...flowchart.snapshot.nodes["selector"], confidence: 4 };
    await writeFile(
      join(stateRoot, "runs", first.runId, "checkpoint.json"),
      `${JSON.stringify(raw, null, 2)}\n`,
      "utf8"
    );
    await assert.rejects(() => resumeFlowchartRun(deps(stateRoot), first.runId), /flowchart\.snapshot|confidence/);
  });
});
