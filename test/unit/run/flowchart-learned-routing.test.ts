import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { test } from "node:test";
import type { RoutingEvalReport } from "../../../src/adaptation/eval-routing.js";
import { hashCandidateContent } from "../../../src/adaptation/candidate.js";
import {
  promoteWithRegistry,
  saveAdaptationRegistry,
  type PromoteInput
} from "../../../src/adaptation/promotion.js";
import { ResourceRegistry } from "../../../src/adaptation/registry.js";
import { createTaskId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import {
  validateConfidenceScore,
  type Flowchart,
  type FlowNode
} from "../../../src/domain/flowchart.js";
import {
  routingPolicyContent,
  routingPolicyIdentity,
  stableProjectKey,
  type LearnedRoutingPolicy
} from "../../../src/learning/learned-routing.js";
import { resumeFlowchartRun, startFlowchartRun } from "../../../src/run/flowchart-run.js";
import { createModelRouter, type ModelRouter } from "../../../src/supervisor/model-router.js";
import type { ChildNodeResult } from "../../../src/supervisor/flowchart-supervisor.js";
import {
  computeComparisonReport,
  DEFAULT_COMPARISON_REPORT_CONFIG,
  type ComparisonReport
} from "../../../src/experiments/comparison-report.js";
import { createEvaluationCard } from "../../../src/experiments/evaluation-card.js";

const AUTHOR = { kind: "human" as const, identity: "alice" };
const PLAN = { stages: ["static", "replay"], metrics: ["task-success", "cost"], planVersion: 1 };

const routerConfig = {
  policyVersion: "router-v1",
  models: [
    {
      id: "cheap",
      version: "cheap-v1",
      roles: ["actor", "critic"] as const,
      maxComplexity: "MEDIUM" as const,
      estimatedCostUsd: 0.1,
      estimatedDurationMs: 1_000
    },
    {
      id: "premium",
      version: "premium-v1",
      roles: ["actor", "critic", "judge", "router"] as const,
      maxComplexity: "HIGH" as const,
      estimatedCostUsd: 0.5,
      estimatedDurationMs: 4_000
    }
  ]
};

function sequenceGenerator(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`;
}

function router(): ModelRouter {
  return createModelRouter(routerConfig);
}

function avoidCheap(): LearnedRoutingPolicy {
  return {
    primaryModelId: "premium",
    avoid: [{ modelId: "cheap", family: "edit", reason: "meanScore 0.10 over 2 samples" }],
    prefer: [{ family: "edit", modelId: "premium" }]
  };
}

function emptyPolicy(): LearnedRoutingPolicy {
  return { primaryModelId: "premium", avoid: [], prefer: [] };
}

function comparisonFixture(
  n: number,
  evidenceClass: ComparisonReport["evidenceClass"],
  claims: readonly string[] = []
): ComparisonReport {
  const records = Array.from({ length: n }, (_, index) => ({
    episodeHash: `eh-${index + 1}`,
    taskFamily: "edit",
    baselineUtility: 1,
    candidateUtility: 1,
    baselineCostUsd: 0.01,
    candidateCostUsd: 0.01
  }));
  const card = createEvaluationCard({
    domains: ["edit"],
    difficultyTiers: ["replay"],
    metrics: ["utility", "cost"],
    baseline: { utility: 1, costUsd: 0.01, uncertainty: 0 },
    candidate: { utility: 1, costUsd: 0.01, uncertainty: 0 },
    guardrailViolations: []
  });
  return computeComparisonReport(records, card, claims, {
    ...DEFAULT_COMPARISON_REPORT_CONFIG,
    evidenceClass
  });
}

function evalReportFor(
  candidateId: string,
  contentHash: string,
  comparison: ComparisonReport,
  evidenceClass: RoutingEvalReport["evidenceClass"] = "replay"
): RoutingEvalReport {
  return {
    candidateId,
    contentHash,
    cacheKey: "ck-test",
    stages: ["static", "replay"],
    comparison,
    evidenceClass,
    qualityEvidence: "none-by-construction",
    qualityEvidenceNote: "fixture: utilityDelta is 0 by construction",
    actionDiff: [],
    environmentVersion: "env-test-1",
    evaluatorVersion: "routing-eval-v1",
    rerunHash: "rr-test"
  };
}

function promoteInput(
  candidateId: PromoteInput["candidateId"],
  expected: PromoteInput["expectedCurrentVersionId"],
  content: string
): PromoteInput {
  const contentHash = hashCandidateContent(content);
  return {
    candidateId,
    expectedCurrentVersionId: expected,
    content,
    approvedBy: AUTHOR,
    review: {
      reviewId: `review-${candidateId}`,
      candidateId,
      contentHash,
      verdict: "approved",
      reviewerKind: "independent",
      reviewerId: "critic-1",
      actorId: AUTHOR.identity,
      evidenceRefs: ["review:independent"]
    },
    changeNote: {
      scope: "routing-policy:smart-assign",
      evidence: ["explicit-approve"],
      guardrails: ["proposal-first"],
      rollbackVersionId: expected
    },
    explicitApproval: true,
    evalReport: evalReportFor(candidateId, contentHash, comparisonFixture(5, "simulation"))
  };
}

async function promoteAvoidCheap(stateRoot: string, projectRoot: string): Promise<void> {
  const identity = routingPolicyIdentity(projectRoot);
  const baselineContent = routingPolicyContent(emptyPolicy());
  const promotedContent = routingPolicyContent(avoidCheap());
  const registry = new ResourceRegistry();
  const baseline = registry.registerBaseline({
    identity,
    content: baselineContent,
    author: { kind: "detector", identity: "test" }
  });
  const candidate = registry.createCandidate({
    identity,
    content: promotedContent,
    parentVersionId: baseline.versionId,
    author: AUTHOR,
    evaluationPlan: PLAN
  });
  const promoted = promoteWithRegistry(
    registry,
    promoteInput(candidate.candidateId, baseline.versionId, promotedContent)
  );
  assert.equal(promoted.ok, true);
  await saveAdaptationRegistry(stateRoot, registry);
}

function node(id: string, opts: { approvalRequired?: boolean } = {}): FlowNode {
  return {
    id,
    taskId: createTaskId(() => id),
    role: "actor",
    objective: "Implement the cache layer",
    modelPolicy: { allowedModels: ["cheap", "premium"] },
    confidenceThreshold: validateConfidenceScore(0.7),
    approvalRequired: opts.approvalRequired ?? false
  };
}

function oneNodeFlowchart(): Flowchart {
  return { id: "learned-one", nodes: [node("work")], edges: [] };
}

function sequentialFlowchart(): Flowchart {
  return {
    id: "learned-seq",
    nodes: [node("first", { approvalRequired: true }), node("second")],
    edges: [{ from: "first", to: "second", condition: { type: "success", expected: true } }]
  };
}

function fakeResult(confidence: number, evidence: string): ChildNodeResult {
  return {
    outcome: "SUCCESS",
    confidence: validateConfidenceScore(confidence),
    evidenceIds: [evidence],
    facts: [{ key: "coverage", value: "green", confidence: validateConfidenceScore(confidence) }]
  };
}

function deps(stateRoot: string) {
  return {
    stateRoot,
    router: router(),
    now: () => parseIsoTimestamp("2026-08-19T09:00:00.000Z"),
    generateId: sequenceGenerator()
  };
}

function routedModel(
  events: readonly { type: string; payload: unknown }[],
  taskSuffix: string
): string | undefined {
  const event = events.find((entry) => {
    if (entry.type !== "MODEL_ROUTED") return false;
    const payload = entry.payload as { taskId: string };
    return payload.taskId === `tsk_${taskSuffix}`;
  });
  return event === undefined ? undefined : (event.payload as { model: string }).model;
}

async function withTempState(run: (stateRoot: string, projectRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-flr-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-flr-proj-"));
  try {
    await run(stateRoot, projectRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

test("after a promoted routing-policy avoid, a flowchart node does not select that model", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    await promoteAvoidCheap(stateRoot, projectRoot);

    const outcome = await startFlowchartRun(deps(stateRoot), {
      projectRoot,
      flowchart: oneNodeFlowchart(),
      objective: "Implement the cache layer",
      childResults: { work: fakeResult(0.9, "evd_work") }
    });

    assert.equal(outcome.status, "COMPLETED");
    assert.equal(routedModel(outcome.events, "work"), "premium");
    assert.notEqual(routedModel(outcome.events, "work"), "cheap");
    const storedAllowed =
      outcome.checkpoint.flowchart?.definition.nodes.find((entry) => entry.id === "work")?.modelPolicy
        .allowedModels;
    assert.deepEqual(storedAllowed, ["cheap", "premium"]);
  });
});

test("resume leases new flowchart nodes with the current active routing-policy", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const first = await startFlowchartRun(deps(stateRoot), {
      projectRoot,
      flowchart: sequentialFlowchart(),
      objective: "Implement the cache layer"
    });

    assert.equal(first.status, "WAITING_FOR_USER");
    assert.equal(routedModel(first.events, "first"), "cheap");
    assert.equal(routedModel(first.events, "second"), undefined);
    const pending = first.pendingApproval;
    assert.ok(pending);

    await promoteAvoidCheap(stateRoot, projectRoot);

    const continued = await resumeFlowchartRun(deps(stateRoot), first.runId, {
      approvalReply: { approvalPlanId: pending.plan.id, selectedActionIds: [pending.plan.items[0]!.id] },
      childResults: { first: fakeResult(0.9, "evd_first"), second: fakeResult(0.9, "evd_second") }
    });

    assert.equal(continued.status, "COMPLETED");
    assert.equal(routedModel(continued.events, "first"), "cheap");
    assert.equal(routedModel(continued.events, "second"), "premium");
    const storedSecond =
      continued.checkpoint.flowchart?.definition.nodes.find((entry) => entry.id === "second")
        ?.modelPolicy.allowedModels;
    assert.deepEqual(storedSecond, ["cheap", "premium"]);
  });
});

test("start and resume load the routing-policy identity of canonical project.rootPath, not a non-canonical CLI path", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const canonical = await realpath(projectRoot);
    const aliased = `${canonical}${sep}.`;
    assert.notEqual(
      stableProjectKey(aliased),
      stableProjectKey(canonical),
      "aliased CLI path must hash to a different routing-policy identity than realpath"
    );
    assert.equal(await realpath(aliased), canonical);

    await promoteAvoidCheap(stateRoot, canonical);

    const first = await startFlowchartRun(deps(stateRoot), {
      projectRoot: aliased,
      flowchart: sequentialFlowchart(),
      objective: "Implement the cache layer"
    });

    assert.equal(first.status, "WAITING_FOR_USER");
    assert.equal(first.project.rootPath, canonical);
    assert.equal(routedModel(first.events, "first"), "premium");
    const pending = first.pendingApproval;
    assert.ok(pending);

    const continued = await resumeFlowchartRun(deps(stateRoot), first.runId, {
      approvalReply: { approvalPlanId: pending.plan.id, selectedActionIds: [pending.plan.items[0]!.id] },
      childResults: { first: fakeResult(0.9, "evd_first"), second: fakeResult(0.9, "evd_second") }
    });

    assert.equal(continued.status, "COMPLETED");
    assert.equal(routedModel(continued.events, "first"), "premium");
    assert.equal(routedModel(continued.events, "second"), "premium");
  });
});
