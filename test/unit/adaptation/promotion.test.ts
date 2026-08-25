import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  canAutoPromote,
  createDefaultApprovalProfile
} from "../../../src/adaptation/approval-profile.js";
import type { ApprovalProfile } from "../../../src/adaptation/approval-profile.js";
import type { EvaluationPlan } from "../../../src/adaptation/candidate.js";
import type { RoutingEvalReport } from "../../../src/adaptation/eval-routing.js";
import {
  adaptationRegistryPath,
  loadAdaptationRegistry,
  parsePromotionReview,
  promoteWithRegistry,
  PromotionService,
  reconstructPromotion,
  saveAdaptationRegistry
} from "../../../src/adaptation/promotion.js";
import type { ChangeNote, PromoteInput } from "../../../src/adaptation/promotion.js";
import { ResourceRegistry } from "../../../src/adaptation/registry.js";
import type { AuthorIdentity, ResourceIdentity } from "../../../src/adaptation/resource.js";
import { NON_AUTO_PROMOTABLE_KINDS } from "../../../src/adaptation/resource.js";
import { hash32 } from "../../../src/domain/hash.js";
import type { IdGenerator } from "../../../src/domain/ids.js";
import { createProjectId } from "../../../src/domain/ids.js";
import type { IsoTimestamp } from "../../../src/domain/timestamp.js";
import {
  computeComparisonReport,
  DEFAULT_COMPARISON_REPORT_CONFIG,
  type ComparisonReport
} from "../../../src/experiments/comparison-report.js";
import { createEvaluationCard } from "../../../src/experiments/evaluation-card.js";
import { routingPolicyContent } from "../../../src/learning/learned-routing.js";

const NOW = "2026-08-15T00:00:00.000Z" as IsoTimestamp;
const AUTHOR: AuthorIdentity = { kind: "human", identity: "alice" };
const PLAN: EvaluationPlan = {
  stages: ["static", "replay", "holdout", "canary"],
  metrics: ["utility", "cost"],
  planVersion: 1
};

function sequentialIds(): IdGenerator {
  let n = 0;
  return () => {
    n += 1;
    return `seq${String(n).padStart(4, "0")}`;
  };
}

function identity(overrides: Partial<ResourceIdentity> = {}): ResourceIdentity {
  return {
    kind: "prompt",
    name: "main-agent-prompt",
    scope: { kind: "project", projectId: createProjectId(() => "proj0001") },
    ...overrides
  };
}

function registry(): ResourceRegistry {
  return new ResourceRegistry({ now: () => NOW, generateId: sequentialIds() });
}

function changeNote(expectedVersionId: ChangeNote["rollbackVersionId"]): ChangeNote {
  return {
    scope: "prompt:main-agent-prompt",
    evidence: ["replay-pass", "holdout-pass"],
    guardrails: ["no-permission-change"],
    rollbackVersionId: expectedVersionId
  };
}

function promoteInput(
  candidateId: PromoteInput["candidateId"],
  expectedCurrentVersionId: PromoteInput["expectedCurrentVersionId"],
  content: string,
  overrides: Partial<PromoteInput> = {}
): PromoteInput {
  return {
    candidateId,
    expectedCurrentVersionId,
    content,
    approvedBy: AUTHOR,
    review: {
      reviewId: `review-${candidateId}`,
      candidateId,
      contentHash: hash32(content),
      verdict: "approved",
      reviewerKind: "independent",
      reviewerId: "critic-1",
      actorId: AUTHOR.identity,
      evidenceRefs: ["review:independent"]
    },
    changeNote: changeNote(expectedCurrentVersionId),
    explicitApproval: true,
    ...overrides
  };
}

function lowRiskProfile(overrides: Partial<ApprovalProfile> = {}): ApprovalProfile {
  return {
    profileId: "apr_low-risk",
    profileVersion: 2,
    defaultMode: "proposal-first",
    autoPromoteClasses: ["prompt"],
    neverAutoPromote: [...NON_AUTO_PROMOTABLE_KINDS],
    budget: { maxAutoPromotions: 1 },
    ...overrides
  };
}

describe("M6-T5: compare-and-swap promotion", () => {
  it("initial policy requires explicit approval for every promotion", () => {
    const reg = registry();
    const id = identity();
    const baseline = reg.registerBaseline({ identity: id, content: "v1", author: AUTHOR });
    const candidate = reg.createCandidate({
      identity: id,
      content: "v2",
      parentVersionId: baseline.versionId,
      author: AUTHOR,
      evaluationPlan: PLAN
    });
    assert.deepEqual(reg.getActiveVersion(id), baseline, "creating a candidate must not move active");
    assert.equal(canAutoPromote(createDefaultApprovalProfile(), "prompt", 0), false);
    assert.throws(
      () =>
        promoteWithRegistry(
          reg,
          promoteInput( candidate.candidateId, baseline.versionId, "v2", {
            explicitApproval: false
          })
        ),
      /explicit approval/
    );
    assert.deepEqual(reg.getActiveVersion(id), baseline);
  });

  it("pointer update verifies expected current version and candidate eligibility", () => {
    const reg = registry();
    const id = identity();
    const baseline = reg.registerBaseline({ identity: id, content: "v1", author: AUTHOR });
    const candidate = reg.createCandidate({
      identity: id,
      content: "v2 prompt",
      parentVersionId: baseline.versionId,
      author: AUTHOR,
      evaluationPlan: PLAN
    });
    const result = promoteWithRegistry(
      reg,
      promoteInput( candidate.candidateId, baseline.versionId, "v2 prompt")
    );
    assert.equal(result.ok, true);
    assert.ok(result.newVersion !== undefined);
    assert.equal(reg.getActiveVersion(id)?.versionId, result.newVersion?.versionId);
    assert.equal(reg.getCandidate(candidate.candidateId)?.status, "approved");
    assert.equal(result.newVersion?.parentVersionId, baseline.versionId);
    assert.equal(result.newVersion?.contentHash, hash32("v2 prompt"));
    assert.ok(
      reg.versionsFor(id).some((version) => version.versionId === baseline.versionId),
      "previous version remains as rollback target"
    );
  });

  it("fails closed on hash mismatch, unknown candidate, and unknown expected version", () => {
    const reg = registry();
    const id = identity();
    const baseline = reg.registerBaseline({ identity: id, content: "v1", author: AUTHOR });
    const candidate = reg.createCandidate({
      identity: id,
      content: "v2",
      parentVersionId: baseline.versionId,
      author: AUTHOR,
      evaluationPlan: PLAN
    });
    assert.throws(
      () =>
        promoteWithRegistry(
          reg,
          promoteInput( candidate.candidateId, baseline.versionId, "not-v2")
        ),
      /hash mismatch/
    );
    assert.throws(
      () =>
        promoteWithRegistry(
          reg,
          promoteInput( "cnd_unknown" as never, baseline.versionId, "v2")
        ),
      /unknown candidate/
    );
    assert.throws(
      () =>
        promoteWithRegistry(
          reg,
          promoteInput( candidate.candidateId, "rsv_unknown" as never, "v2")
        ),
      /unknown expected/
    );
    assert.deepEqual(reg.getActiveVersion(id), baseline);
  });

  it("rejected and retired candidates cannot promote", () => {
    const reg = registry();
    const id = identity();
    const baseline = reg.registerBaseline({ identity: id, content: "v1", author: AUTHOR });
    const rejected = reg.createCandidate({
      identity: id,
      content: "bad",
      parentVersionId: baseline.versionId,
      author: AUTHOR,
      evaluationPlan: PLAN
    });
    const retired = reg.createCandidate({
      identity: id,
      content: "old",
      parentVersionId: baseline.versionId,
      author: AUTHOR,
      evaluationPlan: PLAN
    });
    const evaluating = reg.createCandidate({
      identity: id,
      content: "eval",
      parentVersionId: baseline.versionId,
      author: AUTHOR,
      evaluationPlan: PLAN
    });
    reg.updateCandidateStatus(rejected.candidateId, "rejected");
    reg.updateCandidateStatus(retired.candidateId, "retired");
    reg.updateCandidateStatus(evaluating.candidateId, "evaluating");
    assert.throws(
      () =>
        promoteWithRegistry(
          reg,
          promoteInput( rejected.candidateId, baseline.versionId, "bad")
        ),
      /cannot promote/
    );
    assert.throws(
      () =>
        promoteWithRegistry(
          reg,
          promoteInput( retired.candidateId, baseline.versionId, "old")
        ),
      /cannot promote/
    );
    const result = promoteWithRegistry(
      reg,
      promoteInput( evaluating.candidateId, baseline.versionId, "eval")
    );
    assert.equal(result.ok, true);
  });

  it("crash before activation leaves an inactive candidate", () => {
    const reg = registry();
    const id = identity();
    const baseline = reg.registerBaseline({ identity: id, content: "v1", author: AUTHOR });
    const candidate = reg.createCandidate({
      identity: id,
      content: "v2",
      parentVersionId: baseline.versionId,
      author: AUTHOR,
      evaluationPlan: PLAN
    });
    const service = new PromotionService(reg);
    const began = service.beginPromotion(
      promoteInput( candidate.candidateId, baseline.versionId, "v2")
    );
    assert.equal(reg.getActiveVersion(id)?.versionId, baseline.versionId);
    assert.equal(reg.getCandidate(candidate.candidateId)?.status, "proposed");
    assert.equal(began.ledger.at(-1)?.kind, "intent");

    const restored = ResourceRegistry.fromSnapshot(reg.snapshot(), {
      now: () => NOW,
      generateId: sequentialIds()
    });
    assert.equal(restored.getActiveVersion(id)?.versionId, baseline.versionId);
    assert.equal(restored.getCandidate(candidate.candidateId)?.status, "proposed");
    assert.notEqual(restored.getActiveVersion(id)?.versionId, began.pendingVersion.versionId);
  });

  it("crash after activation is replayable from snapshot", async () => {
    const reg = registry();
    const id = identity();
    const baseline = reg.registerBaseline({ identity: id, content: "v1", author: AUTHOR });
    const candidate = reg.createCandidate({
      identity: id,
      content: "v2",
      parentVersionId: baseline.versionId,
      author: AUTHOR,
      evaluationPlan: PLAN
    });
    const result = promoteWithRegistry(
      reg,
      promoteInput( candidate.candidateId, baseline.versionId, "v2")
    );
    assert.equal(result.ok, true);
    const memory = ResourceRegistry.fromSnapshot(reg.snapshot(), {
      now: () => NOW,
      generateId: sequentialIds()
    });
    assert.equal(memory.getActiveVersion(id)?.versionId, result.newVersion?.versionId);
    assert.equal(memory.getCandidate(candidate.candidateId)?.status, "approved");

    const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-adapt-"));
    await saveAdaptationRegistry(dir, reg);
    const reloaded = await loadAdaptationRegistry(dir, {
      now: () => NOW,
      generateId: sequentialIds()
    });
    assert.equal(reloaded.getActiveVersion(id)?.versionId, result.newVersion?.versionId);
    assert.equal(reloaded.ledger().at(-1)?.kind, "promoted");
  });

  it("registry saves preserve bytes and concurrent publishes leave no owned temp", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-adapt-atomic-"));
    try {
      const first = registry();
      first.registerBaseline({ identity: identity(), content: "v1", author: AUTHOR });
      const second = registry();
      const firstBytes = `${JSON.stringify(first.snapshot(), null, 2)}\n`;
      const secondBytes = `${JSON.stringify(second.snapshot(), null, 2)}\n`;

      await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          saveAdaptationRegistry(dir, index % 2 === 0 ? first : second)
        )
      );

      const path = adaptationRegistryPath(dir);
      assert.ok([firstBytes, secondBytes].includes(await readFile(path, "utf8")));
      assert.deepEqual(
        (await readdir(dirname(path))).filter((entry) => entry.endsWith(".tmp")),
        []
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("registry publishing delegates cleanup and collision handling to the shared writer", async () => {
    const source = await readFile("src/adaptation/promotion.ts", "utf8");
    assert.match(source, /import \{ writeFileAtomic \} from "\.\.\/persist\/atomic-file\.js";/);
    assert.match(source, /await writeFileAtomic\(path, serialized\);/);
    assert.doesNotMatch(source, /\b(?:open|rename)\(/);
    assert.doesNotMatch(source, /tempPath|randomUUID|`[^`]*\.tmp`/);
  });

  it("concurrent promotions cannot lose an update", () => {
    const reg = registry();
    const id = identity();
    const baseline = reg.registerBaseline({ identity: id, content: "v1", author: AUTHOR });
    const first = reg.createCandidate({
      identity: id,
      content: "v2a",
      parentVersionId: baseline.versionId,
      author: AUTHOR,
      evaluationPlan: PLAN
    });
    const second = reg.createCandidate({
      identity: id,
      content: "v2b",
      parentVersionId: baseline.versionId,
      author: AUTHOR,
      evaluationPlan: PLAN
    });
    const won = promoteWithRegistry(
      reg,
      promoteInput( first.candidateId, baseline.versionId, "v2a")
    );
    assert.equal(won.ok, true);
    assert.throws(
      () =>
        promoteWithRegistry(
          reg,
          promoteInput( second.candidateId, baseline.versionId, "v2b")
        ),
      /CAS failed/
    );
    assert.equal(reg.getActiveVersion(id)?.versionId, won.newVersion?.versionId);
  });

  it("change note includes scope, evidence, guardrails, and rollback version", () => {
    const reg = registry();
    const id = identity();
    const baseline = reg.registerBaseline({ identity: id, content: "v1", author: AUTHOR });
    const candidate = reg.createCandidate({
      identity: id,
      content: "v2",
      parentVersionId: baseline.versionId,
      author: AUTHOR,
      evaluationPlan: PLAN
    });
    assert.throws(
      () =>
        promoteWithRegistry(
          reg,
          promoteInput( candidate.candidateId, baseline.versionId, "v2", {
            changeNote: {
              scope: "",
              evidence: [],
              guardrails: [],
              rollbackVersionId: baseline.versionId
            }
          })
        ),
      /change note/
    );
    const result = promoteWithRegistry(
      reg,
      promoteInput( candidate.candidateId, baseline.versionId, "v2")
    );
    const promoted = result.ledger.find((entry) => entry.kind === "promoted");
    assert.ok(promoted !== undefined);
    assert.equal(promoted.changeNote.scope, "prompt:main-agent-prompt");
    assert.deepEqual(promoted.changeNote.evidence, ["replay-pass", "holdout-pass"]);
    assert.deepEqual(promoted.changeNote.guardrails, ["no-permission-change"]);
    assert.equal(promoted.changeNote.rollbackVersionId, baseline.versionId);
  });

  it("self-review and model authors cannot promote when explicit approval is required", () => {
    const reg = registry();
    const id = identity();
    const baseline = reg.registerBaseline({ identity: id, content: "v1", author: AUTHOR });
    const candidate = reg.createCandidate({
      identity: id,
      content: "v2",
      parentVersionId: baseline.versionId,
      author: { kind: "model", identity: "self-reviewer" },
      evaluationPlan: PLAN
    });
    assert.throws(
      () =>
        promoteWithRegistry(
          reg,
          promoteInput( candidate.candidateId, baseline.versionId, "v2", {
            approvedBy: { kind: "model", identity: "self-reviewer" },
            review: {
              reviewId: "review-model",
              candidateId: candidate.candidateId,
              contentHash: candidate.contentHash,
              verdict: "approved",
              reviewerKind: "independent",
              reviewerId: "critic-1",
              actorId: "self-reviewer",
              evidenceRefs: ["review:independent"]
            }
          })
        ),
      /model cannot promote/
    );
    assert.throws(
      () =>
        promoteWithRegistry(
          reg,
          promoteInput( candidate.candidateId, baseline.versionId, "v2", {
            approvedBy: { kind: "detector", identity: "self-review" },
            review: {
              reviewId: "review-detector",
              candidateId: candidate.candidateId,
              contentHash: candidate.contentHash,
              verdict: "approved",
              reviewerKind: "independent",
              reviewerId: "critic-1",
              actorId: "self-reviewer",
              evidenceRefs: ["review:independent"]
            }
          })
        ),
      /self-review cannot promote/
    );
    assert.deepEqual(reg.getActiveVersion(id), baseline);
  });

  it("promotion consumes review provenance and rejects self-review even with human approval", () => {
    const reg = registry();
    const id = identity();
    const baseline = reg.registerBaseline({ identity: id, content: "v1", author: AUTHOR });
    const candidate = reg.createCandidate({
      identity: id,
      content: "v2",
      parentVersionId: baseline.versionId,
      author: { kind: "model", identity: "actor-1" },
      evaluationPlan: PLAN
    });

    assert.throws(
      () =>
        promoteWithRegistry(
          reg,
          promoteInput(candidate.candidateId, baseline.versionId, "v2", {
            approvedBy: { kind: "human", identity: "alice" },
            review: {
              reviewId: "review-self",
              candidateId: candidate.candidateId,
              contentHash: candidate.contentHash,
              verdict: "approved",
              reviewerKind: "self",
              reviewerId: "actor-1",
              actorId: "actor-1",
              evidenceRefs: ["review:self"]
            }
          } as Partial<PromoteInput>)
        ),
      /self-review cannot promote/
    );
    assert.deepEqual(reg.getActiveVersion(id), baseline);
  });

  it("only user-approved low-risk classes may auto-promote inside budget", () => {
    const reg = registry();
    const promptId = identity();
    const skillId = identity({ kind: "skill", name: "router" });
    const promptBaseline = reg.registerBaseline({
      identity: promptId,
      content: "p1",
      author: AUTHOR
    });
    const skillBaseline = reg.registerBaseline({
      identity: skillId,
      content: "s1",
      author: AUTHOR
    });
    const promptCandidate = reg.createCandidate({
      identity: promptId,
      content: "p2",
      parentVersionId: promptBaseline.versionId,
      author: { kind: "detector", identity: "optimizer" },
      evaluationPlan: PLAN
    });
    const extraPrompt = reg.createCandidate({
      identity: promptId,
      content: "p3",
      parentVersionId: promptBaseline.versionId,
      author: AUTHOR,
      evaluationPlan: PLAN
    });
    const skillCandidate = reg.createCandidate({
      identity: skillId,
      content: "s2",
      parentVersionId: skillBaseline.versionId,
      author: AUTHOR,
      evaluationPlan: PLAN
    });
    const profile = lowRiskProfile();
    const auto = promoteWithRegistry(
      reg,
      promoteInput( promptCandidate.candidateId, promptBaseline.versionId, "p2", {
        explicitApproval: false,
        approvedBy: { kind: "detector", identity: "optimizer" },
        review: {
          reviewId: "review-optimizer",
          candidateId: promptCandidate.candidateId,
          contentHash: promptCandidate.contentHash,
          verdict: "approved",
          reviewerKind: "independent",
          reviewerId: "critic-1",
          actorId: "optimizer",
          evidenceRefs: ["review:independent"]
        },
        approvalProfile: profile
      })
    );
    assert.equal(auto.ok, true);
    const promotedVersion = auto.newVersion;
    assert.ok(promotedVersion !== undefined);
    assert.equal(reg.autoPromotionsUsed(), 1);

    assert.throws(
      () =>
        promoteWithRegistry(
          reg,
          promoteInput(extraPrompt.candidateId, promotedVersion.versionId, "p3", {
            explicitApproval: false,
            approvedBy: { kind: "detector", identity: "optimizer" },
            approvalProfile: profile
          })
        ),
      /explicit approval/,
      "budget exhausted"
    );

    assert.throws(
      () =>
        promoteWithRegistry(
          reg,
          promoteInput( skillCandidate.candidateId, skillBaseline.versionId, "s2", {
            explicitApproval: false,
            approvedBy: { kind: "detector", identity: "optimizer" },
            approvalProfile: profile
          })
        ),
      /explicit approval/
    );
  });

  it("permission/security/credential candidates never auto-promote", () => {
    const reg = registry();
    const profile = lowRiskProfile({ autoPromoteClasses: ["prompt"] });
    for (const kind of NON_AUTO_PROMOTABLE_KINDS) {
      const id = identity({ kind, name: `${kind}-policy` });
      const baseline = reg.registerBaseline({ identity: id, content: "c1", author: AUTHOR });
      const candidate = reg.createCandidate({
        identity: id,
        content: "c2",
        parentVersionId: baseline.versionId,
        author: AUTHOR,
        evaluationPlan: PLAN
      });
      assert.equal(candidate.autoPromotable, false);
      assert.throws(
        () =>
          promoteWithRegistry(
            reg,
            promoteInput( candidate.candidateId, baseline.versionId, "c2", {
              explicitApproval: false,
              approvalProfile: profile
            })
          ),
        /explicit approval/
      );
    }
  });

  it("loadAdaptationRegistry fails closed when the snapshot is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-adapt-missing-"));
    await assert.rejects(() => loadAdaptationRegistry(dir), /no registry snapshot/);
  });

  it("two-phase commit refuses an intent after the candidate is rejected", () => {
    const reg = registry();
    const id = identity();
    const baseline = reg.registerBaseline({ identity: id, content: "v1", author: AUTHOR });
    const candidate = reg.createCandidate({
      identity: id,
      content: "v2",
      parentVersionId: baseline.versionId,
      author: AUTHOR,
      evaluationPlan: PLAN
    });
    const began = new PromotionService(reg).beginPromotion(
      promoteInput(candidate.candidateId, baseline.versionId, "v2")
    );
    reg.updateCandidateStatus(candidate.candidateId, "rejected");
    assert.throws(() => new PromotionService(reg).commitPromotion(began.intentId), /status rejected/);
    assert.equal(reg.getActiveVersion(id)?.versionId, baseline.versionId);
  });

  it("two-phase begin then commit activates the pending version", () => {
    const reg = registry();
    const id = identity();
    const baseline = reg.registerBaseline({ identity: id, content: "v1", author: AUTHOR });
    const candidate = reg.createCandidate({
      identity: id,
      content: "v2",
      parentVersionId: baseline.versionId,
      author: AUTHOR,
      evaluationPlan: PLAN
    });
    const service = new PromotionService(reg);
    const began = service.beginPromotion(
      promoteInput( candidate.candidateId, baseline.versionId, "v2")
    );
    const committed = service.commitPromotion(began.intentId);
    assert.equal(committed.ok, true);
    assert.equal(reg.getActiveVersion(id)?.versionId, began.pendingVersion.versionId);
    assert.equal(reg.getCandidate(candidate.candidateId)?.status, "approved");
  });

  it("rebuilds parent, candidate, expected version, and rollback target from the ledger", () => {
    const reg = registry();
    const id = identity();
    const baseline = reg.registerBaseline({ identity: id, content: "v1", author: AUTHOR });
    const candidate = reg.createCandidate({
      identity: id,
      content: "v2",
      parentVersionId: baseline.versionId,
      author: AUTHOR,
      evaluationPlan: PLAN
    });
    const result = promoteWithRegistry(reg, promoteInput(candidate.candidateId, baseline.versionId, "v2"));
    assert.equal(result.ok, true);
    const rebuilt = reconstructPromotion(reg.ledger());
    assert.equal(rebuilt.candidateId, candidate.candidateId);
    assert.equal(rebuilt.parentVersionId, baseline.versionId);
    assert.equal(rebuilt.expectedCurrentVersionId, baseline.versionId);
    assert.equal(rebuilt.toVersionId, reg.getActiveVersion(id)?.versionId);
    assert.equal(rebuilt.rollbackVersionId, baseline.versionId);
  });
});

const ROUTING_V1 = routingPolicyContent({ primaryModelId: "premium", avoid: [], prefer: [] });
const ROUTING_V2 = routingPolicyContent({
  primaryModelId: "premium",
  avoid: [{ modelId: "cheap", family: "edit", reason: "held-out" }],
  prefer: [{ family: "edit", modelId: "premium" }]
});

function routingIdentity(): ResourceIdentity {
  return identity({ kind: "routing-policy", name: "smart-assign" });
}

function seedRoutingCandidate(): {
  readonly reg: ResourceRegistry;
  readonly id: ResourceIdentity;
  readonly baseline: ReturnType<ResourceRegistry["registerBaseline"]>;
  readonly candidate: ReturnType<ResourceRegistry["createCandidate"]>;
} {
  const reg = registry();
  const id = routingIdentity();
  const baseline = reg.registerBaseline({ identity: id, content: ROUTING_V1, author: AUTHOR });
  const candidate = reg.createCandidate({
    identity: id,
    content: ROUTING_V2,
    parentVersionId: baseline.versionId,
    author: AUTHOR,
    evaluationPlan: PLAN
  });
  return { reg, id, baseline, candidate };
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

describe("routing-policy eval promotion gate", () => {
  it("refuses promoteWithRegistry without evalReport and leaves the pointer unchanged", () => {
    const { reg, id, baseline, candidate } = seedRoutingCandidate();
    assert.throws(
      () =>
        promoteWithRegistry(
          reg,
          promoteInput(candidate.candidateId, baseline.versionId, ROUTING_V2)
        ),
      /evalReport|eval report|eval-file/i
    );
    assert.equal(reg.getActiveVersion(id)?.versionId, baseline.versionId);
    assert.equal(reg.getCandidate(candidate.candidateId)?.status, "proposed");
  });

  it("refuses beginPromotion without evalReport", () => {
    const { reg, id, baseline, candidate } = seedRoutingCandidate();
    assert.throws(
      () =>
        new PromotionService(reg).beginPromotion(
          promoteInput(candidate.candidateId, baseline.versionId, ROUTING_V2)
        ),
      /evalReport|eval report|eval-file/i
    );
    assert.equal(reg.getActiveVersion(id)?.versionId, baseline.versionId);
  });

  it("refuses when evalReport.contentHash does not match the candidate", () => {
    const { reg, id, baseline, candidate } = seedRoutingCandidate();
    assert.throws(
      () =>
        promoteWithRegistry(
          reg,
          promoteInput(candidate.candidateId, baseline.versionId, ROUTING_V2, {
            evalReport: evalReportFor(
              candidate.candidateId,
              "deadbeef",
              comparisonFixture(5, "simulation")
            )
          })
        ),
      /contentHash/i
    );
    assert.equal(reg.getActiveVersion(id)?.versionId, baseline.versionId);
  });

  it("refuses when wrapper evidenceClass is not replay", () => {
    const { reg, id, baseline, candidate } = seedRoutingCandidate();
    const report = evalReportFor(
      candidate.candidateId,
      candidate.contentHash,
      comparisonFixture(5, "simulation")
    );
    assert.throws(
      () =>
        promoteWithRegistry(
          reg,
          promoteInput(candidate.candidateId, baseline.versionId, ROUTING_V2, {
            evalReport: { ...report, evidenceClass: "simulation" as RoutingEvalReport["evidenceClass"] }
          })
        ),
      /replay/i
    );
    assert.equal(reg.getActiveVersion(id)?.versionId, baseline.versionId);
  });

  it("refuses a production-labeled nested comparison", () => {
    const { reg, id, baseline, candidate } = seedRoutingCandidate();
    assert.throws(
      () =>
        promoteWithRegistry(
          reg,
          promoteInput(candidate.candidateId, baseline.versionId, ROUTING_V2, {
            evalReport: evalReportFor(
              candidate.candidateId,
              candidate.contentHash,
              comparisonFixture(5, "production")
            )
          })
        ),
      /production/i
    );
    assert.equal(reg.getActiveVersion(id)?.versionId, baseline.versionId);
  });

  it("refuses a non-provisional report whose comparison claims fail validation", () => {
    const { reg, id, baseline, candidate } = seedRoutingCandidate();
    assert.throws(
      () =>
        promoteWithRegistry(
          reg,
          promoteInput(candidate.candidateId, baseline.versionId, ROUTING_V2, {
            evalReport: evalReportFor(
              candidate.candidateId,
              candidate.contentHash,
              comparisonFixture(5, "simulation", ["candidate improves quality"])
            )
          })
        ),
      /claim|invalid/i
    );
    assert.equal(reg.getActiveVersion(id)?.versionId, baseline.versionId);
  });

  it("refuses a provisional report unless acceptProvisional is false and claims are empty", () => {
    const { reg, id, baseline, candidate } = seedRoutingCandidate();
    const provisional = comparisonFixture(2, "simulation");
    assert.equal(provisional.utilityDelta.provisional, true);
    const report = evalReportFor(candidate.candidateId, candidate.contentHash, provisional);

    assert.throws(
      () =>
        promoteWithRegistry(
          reg,
          promoteInput(candidate.candidateId, baseline.versionId, ROUTING_V2, { evalReport: report })
        ),
      /provisional/i
    );

    assert.throws(
      () =>
        promoteWithRegistry(
          reg,
          promoteInput(candidate.candidateId, baseline.versionId, ROUTING_V2, {
            evalReport: report,
            review: {
              reviewId: `review-${candidate.candidateId}`,
              candidateId: candidate.candidateId,
              contentHash: candidate.contentHash,
              verdict: "approved",
              reviewerKind: "independent",
              reviewerId: "critic-1",
              actorId: AUTHOR.identity,
              evidenceRefs: ["review:independent"],
              acceptProvisional: true
            }
          })
        ),
      /provisional/i
    );

    assert.throws(
      () =>
        promoteWithRegistry(
          reg,
          promoteInput(candidate.candidateId, baseline.versionId, ROUTING_V2, {
            evalReport: evalReportFor(
              candidate.candidateId,
              candidate.contentHash,
              comparisonFixture(2, "simulation", ["archived"])
            ),
            review: {
              reviewId: `review-${candidate.candidateId}`,
              candidateId: candidate.candidateId,
              contentHash: candidate.contentHash,
              verdict: "approved",
              reviewerKind: "independent",
              reviewerId: "critic-1",
              actorId: AUTHOR.identity,
              evidenceRefs: ["review:independent"],
              acceptProvisional: false
            }
          })
        ),
      /provisional/i
    );

    assert.equal(reg.getActiveVersion(id)?.versionId, baseline.versionId);
  });

  it("promotes a provisional report when acceptProvisional is false and claims are empty", () => {
    const { reg, id, baseline, candidate } = seedRoutingCandidate();
    const result = promoteWithRegistry(
      reg,
      promoteInput(candidate.candidateId, baseline.versionId, ROUTING_V2, {
        evalReport: evalReportFor(
          candidate.candidateId,
          candidate.contentHash,
          comparisonFixture(2, "simulation")
        ),
        review: {
          reviewId: `review-${candidate.candidateId}`,
          candidateId: candidate.candidateId,
          contentHash: candidate.contentHash,
          verdict: "approved",
          reviewerKind: "independent",
          reviewerId: "critic-1",
          actorId: AUTHOR.identity,
          evidenceRefs: ["review:independent"],
          acceptProvisional: false
        }
      })
    );
    assert.equal(result.ok, true);
    assert.notEqual(reg.getActiveVersion(id)?.versionId, baseline.versionId);
  });

  it("promotes a non-provisional replay eval report whose comparison validates", () => {
    const { reg, id, baseline, candidate } = seedRoutingCandidate();
    const result = promoteWithRegistry(
      reg,
      promoteInput(candidate.candidateId, baseline.versionId, ROUTING_V2, {
        evalReport: evalReportFor(
          candidate.candidateId,
          candidate.contentHash,
          comparisonFixture(5, "simulation")
        )
      })
    );
    assert.equal(result.ok, true);
    assert.equal(reg.getActiveVersion(id)?.versionId, result.newVersion?.versionId);
    assert.equal(reg.getCandidate(candidate.candidateId)?.status, "approved");
  });

  it("parsePromotionReview preserves acceptProvisional", () => {
    const review = parsePromotionReview({
      reviewId: "review-cnd_seq0002",
      candidateId: "cnd_seq0002",
      contentHash: "abc",
      verdict: "approved",
      reviewerKind: "independent",
      reviewerId: "critic-1",
      actorId: "alice",
      evidenceRefs: ["review:independent"],
      acceptProvisional: false
    });
    assert.equal(review.acceptProvisional, false);
  });
});
