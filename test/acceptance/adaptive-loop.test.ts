import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { hashCandidateContent } from "../../src/adaptation/candidate.js";
import type { EvaluationPlan } from "../../src/adaptation/candidate.js";
import { paretoFront } from "../../src/adaptation/pareto.js";
import { promoteWithRegistry } from "../../src/adaptation/promotion.js";
import {
  assertPromotableFromSupport,
  assertSplitSeparation,
  evaluateProposalShadow,
  proposeCandidates
} from "../../src/adaptation/reflection.js";
import { ResourceRegistry } from "../../src/adaptation/registry.js";
import type { AuthorIdentity, ResourceIdentity } from "../../src/adaptation/resource.js";
import { rollbackActive } from "../../src/adaptation/rollback.js";
import { createCanaryRunner } from "../../src/experiments/canary.js";
import { HoldoutVault } from "../../src/experiments/holdout.js";
import type { ExperimentPlan } from "../../src/experiments/plan.js";
import { detectRepeatedPatterns } from "../../src/learning/patterns.js";
import { createSignature } from "../../src/learning/signatures.js";
import {
  clearAll,
  correctPreference,
  deletePreference,
  inspectPreferences,
  isDeleted,
  recordExplicitPreference
} from "../../src/preferences/service.js";
import { exportAuthorizedPreferences } from "../../src/preferences/export.js";
import { getMaterializedView } from "../../src/preferences/materialize.js";
import { createEpisodeId, createProjectId, type IdGenerator } from "../../src/domain/ids.js";
import type { IsoTimestamp } from "../../src/domain/timestamp.js";

/**
 * Checkpoint G acceptance: the controlled-adaptation ladder with deterministic
 * fakes. This scenario exercises propose → static/replay/holdout/canary gates →
 * CAS promotion → a later comparable episode → automatic guardrail rollback.
 *
 * It does **not** claim Outcome-supported improvement. ADR-004 reserves that
 * label for a held-out or comparable later outcome that also meets the
 * approved Checkpoint F cost-quality target. ADR-005 keeps that target open.
 */

const NOW = "2026-08-15T17:00:00.000Z" as IsoTimestamp;
const HUMAN: AuthorIdentity = { kind: "human", identity: "operator" };
const EVAL_PLAN: EvaluationPlan = {
  stages: ["static", "replay", "holdout", "canary"],
  metrics: ["utility", "cost"],
  planVersion: 1
};

type EvidenceMaturity = "present" | "wired" | "exercised" | "outcome-supported";

function sequentialIds(): IdGenerator {
  let n = 0;
  return () => {
    n += 1;
    return `g${String(n).padStart(4, "0")}`;
  };
}

function maturity(opts: {
  readonly laterComparable: boolean;
  readonly holdoutTargetApproved: boolean;
}): EvidenceMaturity {
  if (opts.laterComparable && opts.holdoutTargetApproved) {
    return "outcome-supported";
  }
  if (opts.laterComparable) {
    return "exercised";
  }
  return "wired";
}

describe("Checkpoint G: adaptive loop (deterministic fakes)", () => {
  beforeEach(() => {
    clearAll();
  });

  it("walks problem → candidate → gates → CAS promote → later episode → guardrail rollback", () => {
    const generateId = sequentialIds();
    const registry = new ResourceRegistry({ now: () => NOW, generateId });
    const identity: ResourceIdentity = {
      kind: "prompt",
      name: "main-agent-prompt",
      scope: { kind: "project", projectId: createProjectId(() => "gproj01") }
    };

    const baseline = registry.registerBaseline({
      identity,
      content: "be concise; do not skip tests",
      author: HUMAN
    });

    const failureA = createSignature(createEpisodeId(() => "fail0001"), "execution", {
      failure: "timeout",
      tool: "test"
    });
    const failureB = createSignature(createEpisodeId(() => "fail0002"), "execution", {
      failure: "timeout",
      tool: "test"
    });
    const patterns = detectRepeatedPatterns([failureA, failureB]);
    assert.equal(patterns.length, 1);
    assert.equal(patterns[0]?.kind, "execution");
    assert.equal(patterns[0]?.count, 2);
    assert.equal(patterns[0]?.negativeControl, false);
    const patternKey = patterns[0]?.key;
    assert.ok(patternKey);

    const proposed = proposeCandidates({
      parentVersionId: baseline.versionId,
      parentContent: "be concise; do not skip tests",
      parentKind: "prompt",
      identity: { kind: "prompt", name: identity.name },
      evidence: [
        {
          patternKey,
          boundary: "execution",
          redacted: true,
          actorModelId: "actor-model",
          supportingEvaluatorIds: ["critic-v1", "human-review"]
        }
      ],
      budget: {
        maxCandidatesPerEpoch: 3,
        maxTopologyCandidates: 0,
        lowRiskTaskFamilies: ["edit", "test", "refactor"]
      },
      taskFamily: "edit",
      epoch: 0,
      seed: 7
    });
    assert.equal(proposed.proposals.length, 1);
    assert.equal(proposed.rejectedSelfSupported, 0);
    const proposal = proposed.proposals[0];
    assert.ok(proposal);
    assert.equal(proposal.parentVersionId, baseline.versionId);
    assert.equal(proposal.selfSupported, false);

    assert.equal(hashCandidateContent(proposal.content), proposal.contentHash);
    assertPromotableFromSupport({
      actorModelId: "actor-model",
      supportingEvaluatorIds: ["critic-v1", "human-review"]
    });
    assertSplitSeparation("train", "holdout");

    const candidate = registry.createCandidate({
      identity,
      content: proposal.content,
      parentVersionId: baseline.versionId,
      author: HUMAN,
      evaluationPlan: EVAL_PLAN
    });
    assert.equal(registry.getActiveVersion(identity)?.versionId, baseline.versionId);

    const front = paretoFront([
      {
        candidateId: candidate.candidateId,
        quality: 0.8,
        preferenceFit: 0.7,
        costUsd: 0.02,
        latencyMs: 800,
        risk: 0.1
      },
      {
        candidateId: "cnd_alt",
        quality: 0.6,
        preferenceFit: 0.9,
        costUsd: 0.01,
        latencyMs: 400,
        risk: 0.2
      }
    ]);
    assert.equal(front.length, 2);

    const shadowPlan: ExperimentPlan = {
      planVersion: 1,
      experimentId: "exp_g-shadow",
      mode: "shadow",
      baselineVersionId: baseline.versionId,
      candidateId: candidate.candidateId,
      population: ["ep_shadow_a", "ep_shadow_b"],
      metrics: ["utility", "cost"],
      thresholds: { maxGuardrailBreaches: 0, maxCostUsd: 1 },
      budget: { maxAssignments: 8, maxWallClockMs: 60_000 },
      randomization: { seed: 11 },
      stopPolicy: { onGuardrail: "halt", onBudgetExhausted: "halt" },
      missingOutcomePolicy: "exclude"
    };
    const shadowState = evaluateProposalShadow(shadowPlan, [
      {
        episodeHash: "ep_shadow_a",
        utility: 0.8,
        costUsd: 0.01,
        guardrailBreached: false
      },
      {
        episodeHash: "ep_shadow_b",
        utility: 0.7,
        costUsd: 0.01,
        guardrailBreached: false
      }
    ]);
    assert.equal(shadowState.halted, false);
    assert.ok(shadowState.assignments.every((row) => row.liveAction === "baseline"));
    assert.ok(shadowState.assignments.every((row) => row.changedLiveAction === false));

    const holdout = new HoldoutVault({ now: () => NOW, generateId: () => "ha_g0001" });
    holdout.register("holdout-g");
    const audit = holdout.access("holdout-g", "checkpoint-g-validation");
    assert.equal(audit.length, 1);
    assert.equal(holdout.state("holdout-g").status, "open");

    const canaryPlan: ExperimentPlan = {
      planVersion: 1,
      experimentId: "exp_g-canary",
      mode: "canary",
      baselineVersionId: baseline.versionId,
      candidateId: candidate.candidateId,
      population: ["ep_canary_a"],
      metrics: ["utility", "cost"],
      thresholds: { maxGuardrailBreaches: 0, maxCostUsd: 1 },
      budget: { maxAssignments: 4, maxWallClockMs: 60_000 },
      randomization: { seed: 13 },
      stopPolicy: { onGuardrail: "halt", onBudgetExhausted: "halt" },
      missingOutcomePolicy: "exclude",
      canary: { maxExposure: 1, reversibleScopes: ["prompt-edit"] }
    };
    const canary = createCanaryRunner(canaryPlan);
    let canaryState = canary.start(0);
    canaryState = canary.assign(canaryState, "ep_canary_a", "prompt-edit", 10);
    canaryState = canary.recordOutcome(
      canaryState,
      {
        episodeHash: "ep_canary_a",
        utility: 0.75,
        costUsd: 0.01,
        guardrailBreached: false
      },
      20
    );
    assert.equal(canaryState.halted, false);
    assert.equal(canaryState.assignments[0]?.action, "candidate");

    const promoted = promoteWithRegistry(registry, {
      candidateId: candidate.candidateId,
      expectedCurrentVersionId: baseline.versionId,
      content: proposal.content,
      approvedBy: HUMAN,
      review: {
        reviewId: "review-checkpoint-g",
        candidateId: candidate.candidateId,
        contentHash: candidate.contentHash,
        verdict: "approved",
        reviewerKind: "independent",
        reviewerId: "critic-gate",
        actorId: candidate.author.identity,
        evidenceRefs: ["review:checkpoint-g"]
      },
      changeNote: {
        scope: "prompt:main-agent-prompt",
        evidence: ["static", "shadow-replay", "holdout-access", "canary"],
        guardrails: ["proposal-first", "no-permission-change"],
        rollbackVersionId: baseline.versionId
      },
      explicitApproval: true
    });
    assert.equal(promoted.ok, true);
    assert.ok(promoted.newVersion);
    assert.equal(registry.getActiveVersion(identity)?.versionId, promoted.newVersion.versionId);
    assert.ok(promoted.ledger.some((entry) => entry.kind === "promoted"));
    assert.equal(registry.getCandidate(candidate.candidateId)?.status, "approved");
    assert.ok(
      registry.versionsFor(identity).some((version) => version.versionId === baseline.versionId)
    );

    const later = createSignature(createEpisodeId(() => "later001"), "execution", {
      failure: "timeout",
      tool: "test"
    });
    const laterPatterns = detectRepeatedPatterns([failureA, failureB, later]);
    assert.ok((laterPatterns[0]?.count ?? 0) >= 2);
    assert.equal(
      maturity({ laterComparable: true, holdoutTargetApproved: false }),
      "exercised"
    );
    assert.notEqual(
      maturity({ laterComparable: true, holdoutTargetApproved: false }),
      "outcome-supported"
    );

    const rolled = rollbackActive(registry, {
      identity,
      expectedCurrentVersionId: promoted.newVersion.versionId,
      targetVersionId: baseline.versionId,
      reason: "guardrail",
      automatic: true,
      evidence: ["forced-guardrail-regression"]
    });
    assert.equal(rolled.ok, true);
    assert.equal(rolled.active.versionId, baseline.versionId);
    assert.equal(registry.getActiveVersion(identity)?.versionId, baseline.versionId);
    assert.ok(
      rolled.ledger.some(
        (entry) => entry.kind === "rolled-back" && entry.automatic === true && entry.reason === "guardrail"
      )
    );
    assert.ok(registry.getVersion(promoted.newVersion.versionId));
  });

  it("preference inspect/correct/export/delete still work after promotion and rollback", () => {
    const generateId = sequentialIds();
    const registry = new ResourceRegistry({ now: () => NOW, generateId });
    const identity: ResourceIdentity = {
      kind: "prompt",
      name: "pref-prompt",
      scope: { kind: "project", projectId: createProjectId(() => "gproj02") }
    };
    const baseline = registry.registerBaseline({
      identity,
      content: "v1",
      author: HUMAN
    });
    const candidate = registry.createCandidate({
      identity,
      content: "v2",
      parentVersionId: baseline.versionId,
      author: HUMAN,
      evaluationPlan: EVAL_PLAN
    });
    const promoted = promoteWithRegistry(registry, {
      candidateId: candidate.candidateId,
      expectedCurrentVersionId: baseline.versionId,
      content: "v2",
      approvedBy: HUMAN,
      review: {
        reviewId: "review-preference",
        candidateId: candidate.candidateId,
        contentHash: candidate.contentHash,
        verdict: "approved",
        reviewerKind: "independent",
        reviewerId: "critic-gate",
        actorId: HUMAN.identity,
        evidenceRefs: ["review:preference"]
      },
      changeNote: {
        scope: "prompt:pref-prompt",
        evidence: ["operator-approve"],
        guardrails: ["proposal-first"],
        rollbackVersionId: baseline.versionId
      },
      explicitApproval: true
    });
    assert.equal(promoted.ok, true);
    assert.ok(promoted.newVersion);

    const episodeId = createEpisodeId(() => "pref0001");
    const recorded = recordExplicitPreference("user", "u-g", "format", "compact", episodeId);
    assert.equal(inspectPreferences("user").count, 1);
    correctPreference("user", "u-g", "format", "verbose", createEpisodeId(() => "pref0002"));
    assert.equal(getMaterializedView("user", "u-g")?.effectiveKeys["format"], "verbose");

    rollbackActive(registry, {
      identity,
      expectedCurrentVersionId: promoted.newVersion.versionId,
      targetVersionId: baseline.versionId,
      reason: "guardrail",
      automatic: true,
      evidence: ["post-pref-guardrail"]
    });

    const exported = exportAuthorizedPreferences({ scopes: ["user"] });
    assert.ok(exported.count >= 1);
    assert.equal(deletePreference(recorded.id), true);
    assert.equal(isDeleted(recorded.id), true);
    assert.ok(!inspectPreferences("user").observations.some((row) => row.id === recorded.id));
  });
});
