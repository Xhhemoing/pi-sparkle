import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRubric } from "../../../src/rubric/types.js";
import type { RubricCriterion } from "../../../src/rubric/types.js";
import {
  canEvaluatorScoreCriterion,
  createEvaluationRecord,
  validateEvaluatorScope,
} from "../../../src/evaluation/evaluator.js";
import {
  EVIDENCE_PRECEDENCE,
  comparePrecedence,
  getPrecedenceWeight,
  selectHighestPrecedence,
} from "../../../src/evaluation/precedence.js";
import type { EvaluatorIdentity } from "../../../src/evaluation/types.js";
import { createEpisodeId } from "../../../src/domain/ids.js";

const criteria: RubricCriterion[] = [
  { id: "build", description: "build passes", weight: 1, observableCheck: "build exits 0" },
  { id: "coverage", description: "change is covered", weight: 1, observableCheck: "coverage report" },
];
const rubric = createRubric("m4-eval", "task", criteria);
const episodeId = createEpisodeId();

function evaluator(kind: EvaluatorIdentity["kind"], rubricVersion = "1"): EvaluatorIdentity {
  return { kind, version: "1.0.0", rubricVersion };
}

describe("M4-T1: evaluator interface and evidence precedence", () => {
  it("unknown/stale rubric versions fail closed", () => {
    const stale = validateEvaluatorScope(evaluator("deterministic", "2"), rubric);
    assert.equal(stale.valid, false);
    assert.match(stale.reason ?? "", /rubric version mismatch/);

    const current = validateEvaluatorScope(evaluator("deterministic", "1"), rubric);
    assert.equal(current.valid, true);
  });

  it("a deterministic evaluator can only score criteria with an observable check", () => {
    assert.equal(canEvaluatorScoreCriterion("deterministic", criteria[0]!), true);
    assert.equal(
      canEvaluatorScoreCriterion("deterministic", {
        id: "opaque",
        description: "no check",
        weight: 1,
        observableCheck: "",
      }),
      false
    );
    assert.equal(canEvaluatorScoreCriterion("human", criteria[0]!), true);
    assert.equal(canEvaluatorScoreCriterion("inferential", criteria[0]!), true);
  });

  it("missing evidence is UNOBSERVED for inferential evaluators, FAIL for deterministic", () => {
    const inferred = createEvaluationRecord({
      episodeId,
      evaluator: evaluator("inferential"),
      rubric,
      evidence: {},
    });
    assert.ok(inferred.scores.every((s) => s.outcome === "UNOBSERVED"));
    assert.equal(inferred.overall, "UNOBSERVED");
    assert.equal(inferred.scores[0]?.confidence, 0.6);

    const deterministic = createEvaluationRecord({
      episodeId,
      evaluator: evaluator("deterministic"),
      rubric,
      evidence: {},
    });
    assert.ok(deterministic.scores.every((s) => s.outcome === "FAIL"));
    assert.equal(deterministic.overall, "FAIL");
    assert.equal(deterministic.scores[0]?.confidence, undefined);
  });

  it("ABSTAIN remains distinct: an evaluation with no scorable result does not masquerade as failure", () => {
    // With partial evidence and a human evaluator, unscored criteria are
    // UNOBSERVED — the record must never silently turn them into FAIL.
    const human = createEvaluationRecord({
      episodeId,
      evaluator: evaluator("human"),
      rubric,
      evidence: { build: "build log" },
    });
    const buildScore = human.scores.find((s) => s.criterionId === "build");
    const coverageScore = human.scores.find((s) => s.criterionId === "coverage");
    assert.equal(buildScore?.outcome, "PASS");
    assert.equal(buildScore?.evidenceRef, "build log");
    assert.equal(coverageScore?.outcome, "UNOBSERVED");
    assert.equal(human.overall, "PASS");
  });

  it("a single deterministic FAIL dominates the overall outcome", () => {
    const record = createEvaluationRecord({
      episodeId,
      evaluator: evaluator("deterministic"),
      rubric,
      evidence: { build: "build log" },
    });
    assert.equal(record.scores[0]?.outcome, "PASS");
    assert.equal(record.scores[1]?.outcome, "FAIL");
    assert.equal(record.overall, "FAIL");
  });

  it("deterministic evidence cannot be overridden by inferential evaluators", () => {
    assert.equal(
      selectHighestPrecedence(["inferential", "human", "deterministic"]),
      "deterministic"
    );
    assert.equal(getPrecedenceWeight("deterministic"), 3);
    assert.equal(getPrecedenceWeight("human"), 2);
    assert.equal(getPrecedenceWeight("inferential"), 1);
    assert.ok(comparePrecedence("deterministic", "inferential") > 0);
    assert.ok(comparePrecedence("human", "inferential") > 0);
    assert.equal(EVIDENCE_PRECEDENCE[0]?.kind, "deterministic");
    assert.equal(EVIDENCE_PRECEDENCE[0]?.weight, 3);
  });

  it("records carry rubric identity, evaluator identity, and findings", () => {
    const record = createEvaluationRecord({
      episodeId,
      evaluator: evaluator("deterministic"),
      rubric,
      evidence: { build: "x" },
      findings: [{ id: "f1", criterionId: "coverage", severity: "minor", message: "uncovered path" }],
    });
    assert.equal(record.rubricId, "m4-eval");
    assert.equal(record.rubricVersion, 1);
    assert.equal(record.evaluator.kind, "deterministic");
    assert.equal(record.findings.length, 1);
    assert.equal(record.episodeId, episodeId);
  });
});
