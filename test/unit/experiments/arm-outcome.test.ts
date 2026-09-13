import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzePairedArms,
  classifyArmOutcome,
  classifyHoldoutBlockEvidenceClass
} from "../../../src/experiments/arm-outcome.js";

describe("PS-P4 oracle / arm outcome", () => {
  it("distinguishes collect-fail (harness UNKNOWN) from task-fail", () => {
    const collect = classifyArmOutcome(
      { arm: "R0", invocations: [], status: "UNKNOWN" },
      "pi"
    );
    assert.equal(collect.collectionSuccess, false);
    assert.equal(collect.evidenceClass, "harness-failure");
    assert.equal(collect.failureKind, "config-fail");
    assert.equal(collect.experimentEligible, false);

    const taskFail = classifyArmOutcome(
      {
        arm: "R0",
        invocations: [{ id: "inv_1" }],
        status: "FAILED",
        runId: "run_a",
        oracleTaskSuccess: "FAIL"
      },
      "pi"
    );
    assert.equal(taskFail.collectionSuccess, true);
    assert.equal(taskFail.taskSuccess, "FAIL");
    assert.equal(taskFail.failureKind, "task-fail");
    assert.equal(taskFail.evidenceClass, "production-candidate");
    assert.equal(taskFail.experimentEligible, true);
  });

  it("harness UNKNOWN block is not production-candidate", () => {
    assert.equal(
      classifyHoldoutBlockEvidenceClass({
        executor: "pi",
        results: [
          { invocations: [], status: "UNKNOWN" },
          { invocations: [], status: "UNKNOWN" }
        ]
      }),
      "harness-failure"
    );
  });

  it("paired analysis is auditable and marks collect-fail incomparable", () => {
    const paired = analyzePairedArms({
      executor: "pi",
      r0: { arm: "R0", invocations: [], status: "UNKNOWN" },
      r1: { arm: "R1", invocations: [], status: "UNKNOWN" }
    });
    assert.equal(paired.evidenceClass, "harness-failure");
    assert.equal(paired.auditable.bothExperimentEligible, false);
    assert.equal(paired.auditable.taskDelta.kind, "incomparable");
  });

  it("oracle label preferred over status for taskSuccess", () => {
    const classified = classifyArmOutcome(
      {
        arm: "R1",
        invocations: [{ id: "1" }],
        status: "COMPLETED",
        runId: "run_b",
        oracleTaskSuccess: "FAIL"
      },
      "pi"
    );
    assert.equal(classified.taskSuccess, "FAIL");
  });
});
