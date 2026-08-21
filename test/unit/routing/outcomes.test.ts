import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isInformativeOutcome,
  observationsForR1,
  parseOutcomeObservation,
  OUTCOME_CRITERIA
} from "../../../src/routing/outcomes.js";

const base = {
  taskFamily: "edit",
  role: "implementer",
  modelId: "cheap",
  modelVersion: "v1",
  featureVersion: "assign-v1",
  occurredAtMs: 1000
};

describe("outcome vector", () => {
  it("rejects an observation without criterion", () => {
    assert.throws(() => parseOutcomeObservation({ ...base, outcome: "PASS" }));
  });

  it("rejects an unknown criterion", () => {
    assert.throws(() =>
      parseOutcomeObservation({ ...base, criterion: "vibes", outcome: "PASS" })
    );
  });

  it("keeps columns separate: R1 only consumes taskSuccess PASS/FAIL", () => {
    const success = parseOutcomeObservation({
      ...base,
      criterion: "taskSuccess",
      outcome: "PASS",
      source: "deterministic-check"
    });
    const policy = parseOutcomeObservation({
      ...base,
      criterion: "policyCompliance",
      outcome: "FAIL"
    });
    const user = parseOutcomeObservation({
      ...base,
      criterion: "userAcceptance",
      outcome: "FAIL"
    });
    assert.equal(isInformativeOutcome(success), true);
    const forR1 = observationsForR1([success, policy, user]);
    assert.deepEqual(forR1.map((row) => row.criterion), ["taskSuccess"]);
    assert.ok(OUTCOME_CRITERIA.includes("cost"));
  });

  it("excludes contract FAIL from R1", () => {
    const contractFail = parseOutcomeObservation({
      ...base,
      criterion: "taskSuccess",
      outcome: "FAIL",
      source: "deterministic-check",
      failureClass: "contract"
    });
    assert.deepEqual(observationsForR1([contractFail]), []);
  });

  it("rejects taskSuccess that is not a deterministic check", () => {
    assert.throws(
      () =>
        parseOutcomeObservation({
          ...base,
          criterion: "taskSuccess",
          outcome: "PASS",
          source: "human"
        }),
      /deterministic-check/
    );
  });
});
