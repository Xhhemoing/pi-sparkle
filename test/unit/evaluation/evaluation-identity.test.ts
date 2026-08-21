import assert from "node:assert/strict";
import { test } from "node:test";
import { createEvaluationRecord } from "../../../src/evaluation/evaluator.js";
import type { EvaluatorIdentity } from "../../../src/evaluation/types.js";
import type { Rubric } from "../../../src/rubric/types.js";
import { createEpisodeId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

const evaluator: EvaluatorIdentity = {
  kind: "deterministic",
  version: "eval-v1",
  rubricVersion: "rubric-v1"
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

test("an evaluation identifies its target artifact, version, and independence class", () => {
  const record = createEvaluationRecord({
    episodeId: createEpisodeId(UUID),
    evaluator,
    rubric,
    evidence: { "ac-1": "ev-1" },
    target: { artifactId: "artifact-src-pay-parser", artifactVersion: "v3" },
    independenceClass: "paired"
  });
  assert.equal(record.target?.artifactId, "artifact-src-pay-parser");
  assert.equal(record.target?.artifactVersion, "v3");
  assert.equal(record.independenceClass, "paired");
});

test("target and independence class stay optional for legacy callers", () => {
  const record = createEvaluationRecord({
    episodeId: createEpisodeId(UUID),
    evaluator,
    rubric,
    evidence: {}
  });
  assert.equal(record.target, undefined);
  assert.equal(record.independenceClass, undefined);
});

test("an empty target artifact id is rejected", () => {
  assert.throws(
    () =>
      createEvaluationRecord({
        episodeId: createEpisodeId(UUID),
        evaluator,
        rubric,
        evidence: {},
        target: { artifactId: "  " }
      }),
    /artifactId/
  );
});

test("an unknown independence class is rejected", () => {
  assert.throws(
    () =>
      createEvaluationRecord({
        episodeId: createEpisodeId(UUID),
        evaluator,
        rubric,
        evidence: {},
        independenceClass: "self-reviewed" as never
      }),
    /independence/
  );
});
