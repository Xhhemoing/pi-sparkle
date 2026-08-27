import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { RoutingEvalReport } from "../../../src/adaptation/eval-routing.js";
import { hashCandidateContent } from "../../../src/adaptation/candidate.js";
import {
  loadAdaptationRegistry,
  promoteWithRegistry,
  saveAdaptationRegistry
} from "../../../src/adaptation/promotion.js";
import { ResourceRegistry } from "../../../src/adaptation/registry.js";
import { rollbackActive } from "../../../src/adaptation/rollback.js";
import type { PromoteInput } from "../../../src/adaptation/promotion.js";
import {
  applyLearnedRouting,
  learnedRoutingPath,
  loadLearnedRouting,
  parseLearnedRoutingPolicy,
  routingPolicyContent,
  routingPolicyIdentity,
  type LearnedRoutingPolicy
} from "../../../src/learning/learned-routing.js";
import { assignTasks } from "../../../src/routing/assign.js";
import { catalogFromPrimary } from "../../../src/routing/primary-catalog.js";
import { parseTaskId } from "../../../src/domain/ids.js";
import {
  computeComparisonReport,
  DEFAULT_COMPARISON_REPORT_CONFIG,
  type ComparisonReport
} from "../../../src/experiments/comparison-report.js";
import { createEvaluationCard } from "../../../src/experiments/evaluation-card.js";

const PROJECT = "/tmp/pi-sparkle-active-routing";
const AUTHOR = { kind: "human" as const, identity: "alice" };
const PLAN = { stages: ["static", "replay"], metrics: ["task-success", "cost"], planVersion: 1 };

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

test("stale routing.json is ignored when the registry has no active routing-policy", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-stale-json-"));
  const stalePath = learnedRoutingPath(stateRoot, PROJECT);
  await mkdir(dirname(stalePath), { recursive: true });
  await writeFile(stalePath, `${routingPolicyContent(avoidCheap())}\n`, "utf8");

  const learned = await loadLearnedRouting(stateRoot, PROJECT);
  assert.equal(learned, undefined);

  const catalog = catalogFromPrimary({ primaryModelId: "premium", fastModelId: "cheap" });
  const assignments = assignTasks({
    catalog,
    tasks: [
      { taskId: parseTaskId("tsk_edit"), role: "implementer", objective: "Implement the cache layer" }
    ]
  });
  assert.equal(assignments[0]?.decision.model, "cheap");
});

test("after promote, the next assign reads the active routing-policy pointer", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-promote-live-"));
  const identity = routingPolicyIdentity(PROJECT);
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

  const learned = await loadLearnedRouting(stateRoot, PROJECT);
  assert.ok(learned);
  assert.equal(learned.avoid[0]?.modelId, "cheap");
  assert.equal(registry.getActiveContent(identity)?.content, promotedContent);

  const catalog = catalogFromPrimary({ primaryModelId: "premium", fastModelId: "cheap" });
  const assignments = assignTasks({
    catalog,
    learned,
    tasks: [
      { taskId: parseTaskId("tsk_edit"), role: "implementer", objective: "Implement the cache layer" }
    ]
  });
  assert.equal(assignments[0]?.decision.model, "premium");
});

test("after rollback, the next assign restores the parent routing-policy", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-rollback-live-"));
  const identity = routingPolicyIdentity(PROJECT);
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
  assert.ok(promoted.newVersion);
  const rolled = rollbackActive(registry, {
    identity,
    expectedCurrentVersionId: promoted.newVersion.versionId,
    targetVersionId: baseline.versionId,
    reason: "guardrail",
    automatic: true,
    evidence: ["guardrail"]
  });
  assert.equal(rolled.ok, true);
  await saveAdaptationRegistry(stateRoot, registry);

  const reloaded = await loadAdaptationRegistry(stateRoot);
  assert.equal(reloaded.getActiveVersion(identity)?.versionId, baseline.versionId);
  assert.equal(reloaded.getActiveContent(identity)?.content, baselineContent);

  const learned = await loadLearnedRouting(stateRoot, PROJECT);
  assert.deepEqual(learned, emptyPolicy());
  const catalog = catalogFromPrimary({ primaryModelId: "premium", fastModelId: "cheap" });
  const assignments = assignTasks({
    catalog,
    learned,
    tasks: [
      { taskId: parseTaskId("tsk_edit"), role: "implementer", objective: "Implement the cache layer" }
    ]
  });
  assert.equal(assignments[0]?.decision.model, "cheap");
});

test("parseLearnedRoutingPolicy rejects content whose hash does not match the active version", () => {
  const policy = parseLearnedRoutingPolicy(routingPolicyContent(avoidCheap()));
  assert.equal(policy.primaryModelId, "premium");
  const applied = applyLearnedRouting("edit", ["cheap", "premium"], "cheap", policy);
  assert.equal(applied.preferredModel, "premium");
  assert.ok(!applied.allowedModels.includes("cheap"));
});
