import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashCandidateContent, type EvaluationPlan } from "../../../src/adaptation/candidate.js";
import { createAdaptationDriftMonitor } from "../../../src/adaptation/monitor.js";
import type { DriftObservation } from "../../../src/adaptation/monitor.js";
import {
  loadAdaptationRegistry,
  promoteWithRegistry,
  saveAdaptationRegistry
} from "../../../src/adaptation/promotion.js";
import type { ChangeNote, PromoteInput } from "../../../src/adaptation/promotion.js";
import { ResourceRegistry } from "../../../src/adaptation/registry.js";
import type { AuthorIdentity, ResourceIdentity } from "../../../src/adaptation/resource.js";
import { rollbackActive } from "../../../src/adaptation/rollback.js";
import { createProjectId, type IdGenerator } from "../../../src/domain/ids.js";
import type { IsoTimestamp } from "../../../src/domain/timestamp.js";

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
  content: string
): PromoteInput {
  return {
    candidateId,
    expectedCurrentVersionId,
    content,
    approvedBy: AUTHOR,
    review: {
      reviewId: `review-${candidateId}`,
      candidateId,
      contentHash: hashCandidateContent(content),
      verdict: "approved",
      reviewerKind: "independent",
      reviewerId: "critic-1",
      actorId: AUTHOR.identity,
      evidenceRefs: ["review:independent"]
    },
    changeNote: changeNote(expectedCurrentVersionId),
    explicitApproval: true
  };
}

function promotePair(reg: ResourceRegistry): {
  identity: ResourceIdentity;
  baselineId: ReturnType<ResourceRegistry["registerBaseline"]>["versionId"];
  promotedId: NonNullable<ReturnType<typeof promoteWithRegistry>["newVersion"]>["versionId"];
} {
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
    promoteInput(candidate.candidateId, baseline.versionId, "v2")
  );
  assert.equal(result.ok, true);
  assert.ok(result.newVersion !== undefined);
  return {
    identity: id,
    baselineId: baseline.versionId,
    promotedId: result.newVersion.versionId
  };
}

function driftObs(overrides: Partial<DriftObservation> = {}): DriftObservation {
  return {
    modelVersion: "model-a",
    taskFamily: "edit",
    projectId: "prj_one",
    policyVersion: "pol-1",
    judgeCalibration: 0.8,
    ...overrides
  };
}

describe("M6-T6: automatic guardrail rollback", () => {
  it("restores the previous active pointer after promote without approval or a model author", () => {
    const reg = registry();
    const { identity: id, baselineId, promotedId } = promotePair(reg);
    assert.equal(reg.getActiveVersion(id)?.versionId, promotedId);

    const result = rollbackActive(reg, {
      identity: id,
      expectedCurrentVersionId: promotedId,
      targetVersionId: baselineId,
      reason: "guardrail",
      automatic: true,
      evidence: ["guardrail: cost-ceiling"]
    });

    assert.equal(result.ok, true);
    assert.equal(result.active.versionId, baselineId);
    assert.equal(reg.getActiveVersion(id)?.versionId, baselineId);
    assert.equal(result.ledger.at(-1)?.kind, "rolled-back");
    assert.equal(result.ledger.at(-1)?.automatic, true);
    assert.equal(result.ledger.at(-1)?.reason, "guardrail");
    assert.equal(reg.getVersion(promotedId)?.versionId, promotedId);
    assert.equal(reg.getVersion(baselineId)?.versionId, baselineId);
    assert.equal(reg.versionsFor(id).length, 2);
  });

  it("is idempotent: a second rollback succeeds and keeps both versions", () => {
    const reg = registry();
    const { identity: id, baselineId, promotedId } = promotePair(reg);
    const input = {
      identity: id,
      expectedCurrentVersionId: promotedId,
      targetVersionId: baselineId,
      reason: "guardrail" as const,
      automatic: true,
      evidence: ["guardrail: cost-ceiling"]
    };
    const first = rollbackActive(reg, input);
    const second = rollbackActive(reg, input);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.active.versionId, baselineId);
    assert.equal(reg.getActiveVersion(id)?.versionId, baselineId);
    assert.equal(reg.versionsFor(id).length, 2);
    const rolledBack = second.ledger.filter((entry) => entry.kind === "rolled-back");
    assert.equal(rolledBack.length, 1, "do not append a duplicate rolled-back entry");
  });

  it("crash recovery restores the rolled-back active pointer from snapshot", async () => {
    const reg = registry();
    const { identity: id, baselineId, promotedId } = promotePair(reg);
    rollbackActive(reg, {
      identity: id,
      expectedCurrentVersionId: promotedId,
      targetVersionId: baselineId,
      reason: "guardrail",
      automatic: true,
      evidence: ["guardrail: cost-ceiling"]
    });

    const restored = ResourceRegistry.fromSnapshot(reg.snapshot(), {
      now: () => NOW,
      generateId: sequentialIds()
    });
    assert.equal(restored.getActiveVersion(id)?.versionId, baselineId);
    assert.equal(restored.versionsFor(id).length, 2);
    assert.equal(restored.rollbackLedger().at(-1)?.kind, "rolled-back");

    const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-rollback-"));
    await saveAdaptationRegistry(dir, reg);
    const reloaded = await loadAdaptationRegistry(dir, {
      now: () => NOW,
      generateId: sequentialIds()
    });
    assert.equal(reloaded.getActiveVersion(id)?.versionId, baselineId);
    assert.equal(reloaded.rollbackLedger().at(-1)?.kind, "rolled-back");
    assert.equal(reloaded.getVersion(promotedId)?.versionId, promotedId);
  });

  it("fails closed on stale CAS expected version", () => {
    const reg = registry();
    const { identity: id, baselineId, promotedId } = promotePair(reg);
    assert.throws(
      () =>
        rollbackActive(reg, {
          identity: id,
          expectedCurrentVersionId: baselineId,
          targetVersionId: baselineId,
          reason: "guardrail",
          automatic: true,
          evidence: ["stale"]
        }),
      /CAS failed/
    );
    assert.equal(reg.getActiveVersion(id)?.versionId, promotedId);
    assert.equal(reg.rollbackLedger().length, 0);
  });

  it("non-guardrail drift proposes rollback and leaves the pointer unchanged", () => {
    const reg = registry();
    const { identity: id, baselineId, promotedId } = promotePair(reg);
    const monitor = createAdaptationDriftMonitor({ windowSize: 2 });
    monitor.observe(driftObs());
    monitor.observe(driftObs());
    monitor.observe(driftObs({ taskFamily: "deploy" }));
    const report = monitor.observe(driftObs({ taskFamily: "deploy" }));
    assert.equal(report.drifted, true);
    assert.ok(report.evidence.length > 0);

    const result = rollbackActive(reg, {
      identity: id,
      expectedCurrentVersionId: promotedId,
      targetVersionId: baselineId,
      reason: "degradation",
      automatic: false,
      evidence: report.evidence
    });
    assert.equal(result.ok, false);
    assert.equal(result.active.versionId, promotedId);
    assert.equal(reg.getActiveVersion(id)?.versionId, promotedId);
    assert.equal(result.ledger.at(-1)?.kind, "rollback-proposed");
    assert.equal(result.ledger.at(-1)?.automatic, false);
    assert.equal(result.ledger.at(-1)?.reason, "degradation");
  });

  it("user rollback CAS-moves the pointer with automatic false", () => {
    const reg = registry();
    const { identity: id, baselineId, promotedId } = promotePair(reg);
    const result = rollbackActive(reg, {
      identity: id,
      expectedCurrentVersionId: promotedId,
      targetVersionId: baselineId,
      reason: "user",
      automatic: false,
      evidence: ["operator requested rollback"]
    });
    assert.equal(result.ok, true);
    assert.equal(result.active.versionId, baselineId);
    assert.equal(result.ledger.at(-1)?.automatic, false);
    assert.equal(result.ledger.at(-1)?.reason, "user");
  });

  it("after rollback, getActiveVersion matches the rollback ledger target", () => {
    const reg = registry();
    const { identity: id, baselineId, promotedId } = promotePair(reg);
    const result = rollbackActive(reg, {
      identity: id,
      expectedCurrentVersionId: promotedId,
      targetVersionId: baselineId,
      reason: "guardrail",
      evidence: ["guardrail-regression"],
      automatic: true
    });
    assert.equal(result.ok, true);
    assert.equal(reg.getActiveVersion(id)?.versionId, baselineId);
    assert.equal(result.ledger.at(-1)?.toVersionId, baselineId);
    assert.equal(result.ledger.at(-1)?.toVersionId, reg.getActiveVersion(id)?.versionId);
  });

  it("rejects automatic=true unless the reason is guardrail", () => {
    const reg = registry();
    const { identity: id, baselineId, promotedId } = promotePair(reg);
    assert.throws(
      () =>
        rollbackActive(reg, {
          identity: id,
          expectedCurrentVersionId: promotedId,
          targetVersionId: baselineId,
          reason: "user",
          automatic: true,
          evidence: ["nope"]
        }),
      /automatic rollback is only allowed for guardrail/
    );
  });
});
