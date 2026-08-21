import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assessChildObservation,
  shouldApplyThreeLine,
  type ChildObservation
} from "../../../src/tracking/from-child.js";

function observedSuccess(overrides: Partial<ChildObservation> = {}): ChildObservation {
  return {
    taskId: "tsk_child",
    role: "implementer",
    outcome: "SUCCESS",
    summary: "fake child completed the task",
    evidenceIds: ["evd_fake-tsk_child"],
    artifactIds: ["art_fake-tsk_child"],
    verification: { kind: "PASSED", evidenceIds: ["evd_fake-tsk_child"] },
    requiredChecks: [],
    constraints: [],
    ...overrides
  };
}

describe("three-line from routed child facts", () => {
  it("skips when there is no PASSED or FAILED verification", () => {
    const observation: ChildObservation = {
      taskId: "tsk_empty",
      role: "implementer",
      outcome: "FAILURE",
      summary: "executor finished without a terminal TASK_RESULT",
      evidenceIds: [],
      artifactIds: [],
      requiredChecks: [],
      constraints: []
    };
    const assessed = assessChildObservation({
      observation,
      episodeId: "ep_a",
      runId: "run_a"
    });
    assert.equal(assessed.apply, false);
    assert.equal(shouldApplyThreeLine({ coverage: 1, hasHardPassOrFail: true }), false);
  });

  it("applies when a child TASK_RESULT has PASSED verification and does not invent a block", () => {
    const assessed = assessChildObservation({
      observation: observedSuccess(),
      episodeId: "ep_a",
      runId: "run_a"
    });
    assert.equal(assessed.apply, true);
    if (!assessed.apply) return;
    assert.ok(assessed.prescore.coverage > 0);
    assert.ok(assessed.prescore.dimensions.some((item) => item.hardRelated && item.outcome === "PASS"));
    assert.equal(assessed.assessment.gate.kind, "none");
    assert.ok(assessed.assessment.score >= 0.55);
  });

  it("applies and wakes analysis when verification FAILED with evidence", () => {
    const assessed = assessChildObservation({
      observation: observedSuccess({
        role: "tester",
        outcome: "FAILURE",
        summary: "tests failed",
        verification: { kind: "FAILED", evidenceIds: ["evd_fail"] },
        evidenceIds: ["evd_fail"],
        requiredChecks: ["test"]
      }),
      episodeId: "ep_a",
      runId: "run_a"
    });
    assert.equal(assessed.apply, true);
    if (!assessed.apply) return;
    assert.equal(assessed.assessment.gate.wakeAnalysis, true);
  });
});
