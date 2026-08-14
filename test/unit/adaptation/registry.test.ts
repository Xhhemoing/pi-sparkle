import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ResourceRegistry } from "../../../src/adaptation/registry.js";
import {
  assertAcyclicLineage,
  isCandidate,
  candidateError,
} from "../../../src/adaptation/candidate.js";
import type {
  ImprovementCandidate,
  EvaluationPlan,
} from "../../../src/adaptation/candidate.js";
import type { AuthorIdentity, ResourceIdentity } from "../../../src/adaptation/resource.js";
import { NON_AUTO_PROMOTABLE_KINDS } from "../../../src/adaptation/resource.js";
import { hash32 } from "../../../src/domain/hash.js";
import { createCandidateId, createProjectId } from "../../../src/domain/ids.js";
import type { IsoTimestamp } from "../../../src/domain/timestamp.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";
const NOW = "2026-08-14T00:00:00.000Z" as IsoTimestamp;

const AUTHOR: AuthorIdentity = { kind: "human", identity: "alice" };
const PLAN: EvaluationPlan = {
  stages: ["static", "replay", "holdout", "canary"],
  metrics: ["utility", "cost"],
  planVersion: 1,
};

function identity(overrides: Partial<ResourceIdentity> = {}): ResourceIdentity {
  return {
    kind: "prompt",
    name: "main-agent-prompt",
    scope: { kind: "project", projectId: createProjectId(UUID) },
    ...overrides,
  };
}

function registry(): ResourceRegistry {
  return new ResourceRegistry({ now: () => NOW, generateId: UUID });
}

describe("M6-T1: resource registry", () => {
  it("registers a baseline version and points the active version at it", () => {
    const reg = registry();
    const version = reg.registerBaseline({
      identity: identity(),
      content: "be concise",
      author: AUTHOR,
    });
    assert.equal(version.parentVersionId, undefined, "baseline has no parent");
    assert.equal(version.contentHash, hash32("be concise"));
    assert.deepEqual(reg.getActiveVersion(identity()), version);
  });

  it("rejects a duplicate baseline for the same resource identity", () => {
    const reg = registry();
    reg.registerBaseline({ identity: identity(), content: "v1", author: AUTHOR });
    assert.throws(
      () => reg.registerBaseline({ identity: identity(), content: "v2", author: AUTHOR }),
      /baseline already exists/
    );
  });

  it("creates a candidate without changing the active version", () => {
    const reg = registry();
    const baseline = reg.registerBaseline({
      identity: identity(),
      content: "v1 prompt",
      author: AUTHOR,
    });
    const candidate = reg.createCandidate({
      identity: identity(),
      content: "v2 prompt",
      parentVersionId: baseline.versionId,
      author: AUTHOR,
      evaluationPlan: PLAN,
    });
    assert.equal(candidate.status, "proposed");
    assert.equal(candidate.contentHash, hash32("v2 prompt"));
    assert.equal(candidate.parentVersionId, baseline.versionId);
    assert.equal(candidate.autoPromotable, true);
    assert.equal(isCandidate(candidate), true);
    assert.deepEqual(reg.getActiveVersion(identity()), baseline, "active version must not move");
  });

  it("fails closed on unknown parents and incompatible scopes", () => {
    const reg = registry();
    const baseline = reg.registerBaseline({
      identity: identity(),
      content: "v1",
      author: AUTHOR,
    });
    assert.throws(
      () =>
        reg.createCandidate({
          identity: identity(),
          content: "v2",
          parentVersionId: "rsv_unknown" as never,
          author: AUTHOR,
          evaluationPlan: PLAN,
        }),
      /unknown parent/
    );

    const otherProject = identity({
      scope: { kind: "project", projectId: createProjectId(() => "99999999-89ab-cdef-0123-456789abcdef") },
    });
    assert.throws(
      () =>
        reg.createCandidate({
          identity: otherProject,
          content: "v2",
          parentVersionId: baseline.versionId,
          author: AUTHOR,
          evaluationPlan: PLAN,
        }),
      /incompatible scope/
    );

    const userGlobal = identity({ scope: { kind: "user-global" } });
    assert.throws(
      () =>
        reg.createCandidate({
          identity: userGlobal,
          content: "v2",
          parentVersionId: baseline.versionId,
          author: AUTHOR,
          evaluationPlan: PLAN,
        }),
      /incompatible scope/
    );
  });

  it("fails closed when the declared content hash mismatches", () => {
    const reg = registry();
    const baseline = reg.registerBaseline({
      identity: identity(),
      content: "v1",
      author: AUTHOR,
    });
    assert.throws(
      () =>
        reg.createCandidate({
          identity: identity(),
          content: "v2",
          declaredHash: hash32("something else"),
          parentVersionId: baseline.versionId,
          author: AUTHOR,
          evaluationPlan: PLAN,
        }),
      /hash mismatch/
    );
  });

  it("classifies permission/security/credential targets as non-auto-promotable", () => {
    const reg = registry();
    for (const kind of NON_AUTO_PROMOTABLE_KINDS) {
      const baseline = reg.registerBaseline({
        identity: identity({ kind }),
        content: "config",
        author: AUTHOR,
      });
      const candidate = reg.createCandidate({
        identity: identity({ kind }),
        content: "config v2",
        parentVersionId: baseline.versionId,
        author: AUTHOR,
        evaluationPlan: PLAN,
      });
      assert.equal(candidate.autoPromotable, false, `${kind} must never auto-promote`);
    }
    const prompt = reg.createCandidate({
      identity: identity(),
      content: "prompt v2",
      parentVersionId: reg.registerBaseline({ identity: identity(), content: "prompt", author: AUTHOR }).versionId,
      author: AUTHOR,
      evaluationPlan: PLAN,
    });
    assert.equal(prompt.autoPromotable, true);
  });

  it("rejects candidates with missing or malformed required fields", () => {
    const valid = {
      candidateId: createCandidateId(UUID),
      identity: identity(),
      contentHash: hash32("v2"),
      parentVersionId: "rsv_01234567-89ab-cdef-0123-456789abcdef" as never,
      author: AUTHOR,
      status: "proposed",
      evaluationPlan: PLAN,
      autoPromotable: true,
      createdAt: NOW,
    };
    const cases: Array<[Partial<ImprovementCandidate>, RegExp]> = [
      [{ author: { kind: "human", identity: "" } }, /author/],
      [{ evaluationPlan: { ...PLAN, metrics: [] } }, /metric/],
      [{ evaluationPlan: { ...PLAN, stages: [] } }, /stage/],
      [{ status: "invalid" as never }, /status/],
      [{ contentHash: "zzz" }, /contentHash/],
    ];
    for (const [patch, pattern] of cases) {
      const candidate = { ...valid, ...patch } as unknown as ImprovementCandidate;
      const error = candidateError(candidate);
      assert.ok(error !== undefined && pattern.test(error), `expected ${pattern}, got ${error}`);
      assert.equal(isCandidate(candidate), false);
    }
  });

  it("detects cyclic lineage and accepts acyclic chains", () => {
    const parents = new Map<string, string | undefined>([
      ["a", "b"],
      ["b", "c"],
      ["c", "a"],
    ]);
    assert.throws(() => assertAcyclicLineage("a", (id) => parents.get(id)), /cyclic/);

    const acyclic = new Map<string, string | undefined>([
      ["x", "y"],
      ["y", undefined],
    ]);
    assert.doesNotThrow(() => assertAcyclicLineage("x", (id) => acyclic.get(id)));
  });
});
