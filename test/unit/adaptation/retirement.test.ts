import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashCandidateContent, type EvaluationPlan } from "../../../src/adaptation/candidate.js";
import {
  loadAdaptationRegistry,
  parseRegistrySnapshot,
  promoteWithRegistry,
  saveAdaptationRegistry
} from "../../../src/adaptation/promotion.js";
import type { ChangeNote, PromoteInput } from "../../../src/adaptation/promotion.js";
import { ResourceRegistry } from "../../../src/adaptation/registry.js";
import type { AuthorIdentity, ResourceIdentity } from "../../../src/adaptation/resource.js";
import { rollbackActive } from "../../../src/adaptation/rollback.js";
import { assertAssignable, isRetired, retireVersion } from "../../../src/adaptation/retirement.js";
import { createProjectId, type IdGenerator } from "../../../src/domain/ids.js";
import type { IsoTimestamp } from "../../../src/domain/timestamp.js";

const NOW = "2026-08-15T00:00:00.000Z" as IsoTimestamp;
const AUTHOR: AuthorIdentity = { kind: "human", identity: "alice" };
const PLAN: EvaluationPlan = {
  stages: ["static"],
  metrics: ["utility"],
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
    evidence: ["replay-pass"],
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

describe("M6-T6: version retirement", () => {
  it("retired versions fail assertAssignable but remain gettable", () => {
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
    const promoted = promoteWithRegistry(
      reg,
      promoteInput(candidate.candidateId, baseline.versionId, "v2")
    );
    const newVersion = promoted.newVersion;
    assert.ok(newVersion !== undefined);

    const retired = retireVersion(reg, baseline.versionId);
    assert.equal(retired.versionId, baseline.versionId);
    assert.equal(isRetired(reg, baseline.versionId), true);
    assert.deepEqual(reg.getVersion(baseline.versionId), baseline);
    assert.throws(() => assertAssignable(reg, baseline.versionId), /retired/);
    assert.doesNotThrow(() => assertAssignable(reg, newVersion.versionId));
  });

  it("cannot retire the current active version", () => {
    const reg = registry();
    const id = identity();
    const baseline = reg.registerBaseline({ identity: id, content: "v1", author: AUTHOR });
    assert.throws(() => retireVersion(reg, baseline.versionId), /active/);
    assert.equal(isRetired(reg, baseline.versionId), false);
    assert.doesNotThrow(() => assertAssignable(reg, baseline.versionId));
  });

  it("retiring an already-retired version is idempotent", () => {
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
    promoteWithRegistry(reg, promoteInput(candidate.candidateId, baseline.versionId, "v2"));
    const first = retireVersion(reg, baseline.versionId);
    const second = retireVersion(reg, baseline.versionId);
    assert.equal(first.versionId, second.versionId);
    assert.equal(isRetired(reg, baseline.versionId), true);
  });

  it("persists retired ids across snapshot restore and registry reload", async () => {
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
    promoteWithRegistry(reg, promoteInput(candidate.candidateId, baseline.versionId, "v2"));
    retireVersion(reg, baseline.versionId);

    const restored = ResourceRegistry.fromSnapshot(reg.snapshot(), {
      now: () => NOW,
      generateId: sequentialIds()
    });
    assert.equal(isRetired(restored, baseline.versionId), true);
    assert.throws(() => assertAssignable(restored, baseline.versionId), /retired/);
    assert.ok(restored.getVersion(baseline.versionId) !== undefined);

    const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-retire-"));
    await saveAdaptationRegistry(dir, reg);
    const reloaded = await loadAdaptationRegistry(dir, {
      now: () => NOW,
      generateId: sequentialIds()
    });
    assert.equal(isRetired(reloaded, baseline.versionId), true);
    assert.throws(() => assertAssignable(reloaded, baseline.versionId), /retired/);
  });

  it("cannot roll back onto a retired version", () => {
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
    const promoted = promoteWithRegistry(
      reg,
      promoteInput(candidate.candidateId, baseline.versionId, "v2")
    );
    const newVersion = promoted.newVersion;
    assert.ok(newVersion !== undefined);
    retireVersion(reg, baseline.versionId);
    assert.throws(
      () =>
        rollbackActive(reg, {
          identity: id,
          expectedCurrentVersionId: newVersion.versionId,
          targetVersionId: baseline.versionId,
          reason: "guardrail",
          automatic: true,
          evidence: ["would assign retired"]
        }),
      /retired/
    );
    assert.equal(reg.getActiveVersion(id)?.versionId, newVersion.versionId);
  });

  it("old snapshots without retiredVersionIds still load", () => {
    const reg = registry();
    const id = identity();
    const baseline = reg.registerBaseline({ identity: id, content: "v1", author: AUTHOR });
    const snap = reg.snapshot();
    const { rollbackLedger: _ledger, retiredVersionIds: _retired, ...legacy } = snap;
    const restored = ResourceRegistry.fromSnapshot(legacy, {
      now: () => NOW,
      generateId: sequentialIds()
    });
    assert.equal(restored.getActiveVersion(id)?.versionId, baseline.versionId);
    assert.equal(isRetired(restored, baseline.versionId), false);

    const parsed = parseRegistrySnapshot(legacy);
    assert.deepEqual(parsed.rollbackLedger, []);
    assert.deepEqual(parsed.retiredVersionIds, []);
  });
});
