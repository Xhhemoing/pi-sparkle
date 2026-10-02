import assert from "node:assert/strict";
import { test } from "node:test";
import { createEpisodeId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { createEvaluationRecord } from "../../../src/evaluation/evaluator.js";
import {
  assessEvidenceValidity,
  partitionEvidenceValidity,
  type EvidenceReference
} from "../../../src/evaluation/invalidation.js";
import type { EvaluationRecord, EvaluatorIdentity } from "../../../src/evaluation/types.js";
import type { Rubric } from "../../../src/rubric/types.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

const evaluator: EvaluatorIdentity = {
  kind: "deterministic",
  version: "eval-v1",
  rubricVersion: "1"
};

const rubric: Rubric = {
  id: "rubric-core",
  version: 1,
  scope: "task",
  createdAt: parseIsoTimestamp("2026-08-21T08:00:00.000Z"),
  criteria: [
    { id: "ac-1", description: "works", weight: 1, observableCheck: "tests pass" }
  ]
};

const reference: EvidenceReference = {
  artifactId: "artifact-src-pay-parser",
  artifactVersion: "v3",
  rubricId: "rubric-core",
  rubricVersion: 1,
  evaluatorVersion: "eval-v1",
  dependencyVersions: { "tool-node": "22.19.0", "tool-pnpm": "10.17.1" }
};

function record(overrides: Partial<Parameters<typeof createEvaluationRecord>[0]> = {}): EvaluationRecord {
  return createEvaluationRecord({
    episodeId: createEpisodeId(UUID),
    evaluator,
    rubric,
    evidence: { "ac-1": "ev-1" },
    target: { artifactId: reference.artifactId, artifactVersion: reference.artifactVersion },
    dependencyVersions: { ...reference.dependencyVersions },
    ...overrides
  });
}

test("evidence bound to the current references is valid", () => {
  const verdict = assessEvidenceValidity(record(), reference);
  assert.equal(verdict.state, "valid");
  assert.equal(verdict.reason, undefined);
});

test("each changed reference invalidates with a reason naming it", () => {
  // Note: mutating the reference's artifactId is not an invalidation case —
  // by definition the old artifact's records become `foreign` (see the
  // retention test below); equality on artifactId IS the scope boundary.
  const cases: readonly { readonly name: string; readonly reasonPattern: RegExp; readonly mutate: (r: EvidenceReference) => EvidenceReference }[] = [
    {
      name: "artifact version",
      reasonPattern: /artifact version/i,
      mutate: (r) => ({ ...r, artifactVersion: "v4" })
    },
    {
      name: "rubric id",
      reasonPattern: /rubric id/i,
      mutate: (r) => ({ ...r, rubricId: "rubric-core-alt" })
    },
    {
      name: "rubric version",
      reasonPattern: /rubric version/i,
      mutate: (r) => ({ ...r, rubricVersion: 2 })
    },
    {
      name: "evaluator version",
      reasonPattern: /evaluator version/i,
      mutate: (r) => ({ ...r, evaluatorVersion: "eval-v2" })
    },
    {
      name: "dependency version",
      reasonPattern: /dependency tool-node version changed/i,
      mutate: (r) => ({ ...r, dependencyVersions: { ...r.dependencyVersions, "tool-node": "24.18.0" } })
    }
  ];
  for (const { name, reasonPattern, mutate } of cases) {
    const verdict = assessEvidenceValidity(record(), mutate(reference));
    assert.equal(verdict.state, "invalidated", `${name} change must invalidate`);
    assert.match(verdict.reason ?? "", reasonPattern, `${name} reason must name the change`);
  }
});

test("an unbound record fails closed instead of counting as valid", () => {
  const unbound = createEvaluationRecord({
    episodeId: createEpisodeId(UUID),
    evaluator,
    rubric,
    evidence: { "ac-1": "ev-1" }
  });
  const verdict = assessEvidenceValidity(unbound, reference);
  assert.equal(verdict.state, "invalidated");
  assert.match(verdict.reason ?? "", /unbound/i);
});

test("a dependency snapshot that does not exactly cover the current names fails closed", () => {
  const missing = record({ dependencyVersions: { "tool-node": "22.19.0" } });
  const missingVerdict = assessEvidenceValidity(missing, reference);
  assert.equal(missingVerdict.state, "invalidated");
  assert.match(missingVerdict.reason ?? "", /dependency snapshot/i);

  const extra = record({
    dependencyVersions: { ...reference.dependencyVersions, "tool-extra": "1.0.0" }
  });
  const extraVerdict = assessEvidenceValidity(extra, reference);
  assert.equal(extraVerdict.state, "invalidated");
  assert.match(extraVerdict.reason ?? "", /dependency snapshot/i);
});

test("evidence of an unaffected artifact is foreign, not invalidated", () => {
  const other = record({
    target: { artifactId: "artifact-src-other", artifactVersion: "v1" }
  });
  const verdict = assessEvidenceValidity(other, reference);
  assert.equal(verdict.state, "foreign");
  assert.equal(verdict.reason, undefined);

  const partitioned = partitionEvidenceValidity([record(), other], reference);
  assert.equal(partitioned.valid.length, 1);
  assert.equal(partitioned.invalidated.length, 0);
  assert.equal(partitioned.foreign.length, 1);
});

test("batch partitioning separates states and never mutates its inputs", () => {
  const stale = record({ target: { artifactId: reference.artifactId, artifactVersion: "v2" } });
  const current = record();
  const other = record({
    target: { artifactId: "artifact-src-other", artifactVersion: "v1" }
  });
  const input = Object.freeze([stale, current, other]);
  const partitioned = partitionEvidenceValidity(input, reference);
  assert.deepEqual(partitioned.valid, [current]);
  assert.deepEqual(partitioned.invalidated, [stale]);
  assert.deepEqual(partitioned.foreign, [other]);
  assert.equal(input.length, 3);
});

test("records carry the dependency snapshot they were created against", () => {
  const snapshot = { "tool-node": "22.19.0", "tool-pnpm": "10.17.1" };
  const carried = createEvaluationRecord({
    episodeId: createEpisodeId(UUID),
    evaluator,
    rubric,
    evidence: { "ac-1": "ev-1" },
    target: { artifactId: reference.artifactId, artifactVersion: "v3" },
    dependencyVersions: snapshot
  });
  assert.deepEqual(carried.dependencyVersions, snapshot);
});


test("created records snapshot mutable evidence bindings", () => {
  const target = {
    artifactId: reference.artifactId,
    artifactVersion: reference.artifactVersion
  };
  const dependencies = { ...reference.dependencyVersions };
  const evaluatorInput = { ...evaluator };
  const created = createEvaluationRecord({
    episodeId: createEpisodeId(UUID),
    evaluator: evaluatorInput,
    rubric,
    evidence: { "ac-1": "ev-1" },
    target,
    dependencyVersions: dependencies
  });

  (target as { artifactVersion: string }).artifactVersion = "v4";
  dependencies["tool-node"] = "24.18.0";
  (evaluatorInput as { version: string }).version = "eval-v2";

  const verdict = assessEvidenceValidity(created, reference);
  assert.equal(verdict.state, "valid");
});
