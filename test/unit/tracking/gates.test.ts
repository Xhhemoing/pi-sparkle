import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateGates } from "../../../src/tracking/gates.js";
import { DEFAULT_TRACKING_CONFIG } from "../../../src/tracking/config.js";
import type { OpenMinor } from "../../../src/tracking/types.js";

function minor(id: string, overrides: Partial<OpenMinor> = {}): OpenMinor {
  return {
    id,
    text: id,
    status: "verified-true",
    consecutiveTurns: 1,
    touchesConstraint: false,
    userRejected: false,
    ...overrides
  };
}

describe("tracking anomaly gates", () => {
  it("fires a hard gate on a deterministic test fail even when P is high", () => {
    const decision = evaluateGates({
      P: 0.92,
      score: 0.92,
      human: { kind: "unobserved" },
      config: DEFAULT_TRACKING_CONFIG,
      deterministicFail: true,
      ownershipEscape: false,
      claimedVerificationWithoutChecks: false,
      criterionUnmet: false,
      repeatedNoProgress: false,
      userRejectStop: false,
      safetyRejected: false,
      openMinors: []
    });
    assert.equal(decision.kind, "hard");
    assert.equal(decision.wakeAnalysis, true);
    assert.equal(decision.expandDetail, true);
    assert.ok(decision.codes.includes("deterministic-fail"));
  });

  it("fires a hard gate on an unmet acceptance criterion, behind the codes that outrank it", () => {
    const base = {
      P: 0.92,
      score: 0.92,
      human: { kind: "unobserved" } as const,
      config: DEFAULT_TRACKING_CONFIG,
      deterministicFail: false,
      ownershipEscape: false,
      claimedVerificationWithoutChecks: false,
      criterionUnmet: true,
      repeatedNoProgress: false,
      userRejectStop: false,
      safetyRejected: false,
      openMinors: []
    };

    // On its own it leads: a child whose work passed as a whole but whose
    // verifier reported a criterion FAILED blocks, and the transition's reason
    // code names the criterion rather than a score.
    const alone = evaluateGates(base);
    assert.equal(alone.kind, "hard");
    assert.deepEqual(alone.codes, ["unmet-acceptance-criterion"]);
    assert.equal(alone.askUser, false, "an unmet criterion queues analysis; it does not stop for the user");

    // Ordering is the contract, not an accident: each of these says something
    // about the whole task, so each keeps the leading position.
    assert.deepEqual(evaluateGates({ ...base, deterministicFail: true }).codes, [
      "deterministic-fail",
      "unmet-acceptance-criterion"
    ]);
    assert.deepEqual(evaluateGates({ ...base, ownershipEscape: true }).codes, [
      "ownership-escape",
      "unmet-acceptance-criterion"
    ]);
    assert.deepEqual(evaluateGates({ ...base, claimedVerificationWithoutChecks: true }).codes, [
      "claimed-verification-without-checks",
      "unmet-acceptance-criterion"
    ]);
    assert.deepEqual(evaluateGates({ ...base, repeatedNoProgress: true }).codes, [
      "unmet-acceptance-criterion",
      "repeated-no-progress"
    ]);

    // And it is the fact, not a score, that fires it: the same high P with the
    // fact withdrawn leaves the gate open.
    assert.equal(evaluateGates({ ...base, criterionUnmet: false }).kind, "none");
  });

  it("wakes analysis on the soft threshold when score is 0.41", () => {
    const decision = evaluateGates({
      P: 0.9,
      score: 0.41,
      human: { kind: "short-rule", H: 0.2, bucket: "whole-reject" },
      config: DEFAULT_TRACKING_CONFIG,
      deterministicFail: false,
      ownershipEscape: false,
      claimedVerificationWithoutChecks: false,
      criterionUnmet: false,
      repeatedNoProgress: false,
      userRejectStop: false,
      safetyRejected: false,
      openMinors: []
    });
    assert.equal(decision.kind, "soft");
    assert.equal(decision.wakeAnalysis, true);
    assert.ok(decision.codes.includes("soft-threshold"));
  });

  it("does not wake analysis for one or two light minors", () => {
    const one = evaluateGates({
      P: 0.8,
      score: 0.8,
      human: { kind: "unobserved" },
      config: DEFAULT_TRACKING_CONFIG,
      deterministicFail: false,
      ownershipEscape: false,
      claimedVerificationWithoutChecks: false,
      criterionUnmet: false,
      repeatedNoProgress: false,
      userRejectStop: false,
      safetyRejected: false,
      openMinors: [minor("a")]
    });
    const two = evaluateGates({
      P: 0.8,
      score: 0.8,
      human: { kind: "unobserved" },
      config: DEFAULT_TRACKING_CONFIG,
      deterministicFail: false,
      ownershipEscape: false,
      claimedVerificationWithoutChecks: false,
      criterionUnmet: false,
      repeatedNoProgress: false,
      userRejectStop: false,
      safetyRejected: false,
      openMinors: [minor("a"), minor("b")]
    });
    assert.equal(one.wakeAnalysis, false);
    assert.equal(two.wakeAnalysis, false);
    assert.equal(one.kind, "none");
    assert.equal(two.kind, "none");
  });

  it("escalates when the episode accumulates three unclosed minors", () => {
    const decision = evaluateGates({
      P: 0.8,
      score: 0.8,
      human: { kind: "unobserved" },
      config: DEFAULT_TRACKING_CONFIG,
      deterministicFail: false,
      ownershipEscape: false,
      claimedVerificationWithoutChecks: false,
      criterionUnmet: false,
      repeatedNoProgress: false,
      userRejectStop: false,
      safetyRejected: false,
      openMinors: [minor("a"), minor("b"), minor("c")]
    });
    assert.equal(decision.wakeAnalysis, true);
    assert.ok(decision.codes.includes("minor-escalated"));
  });

  it("escalates when the same minor repeats two consecutive tracking turns", () => {
    const decision = evaluateGates({
      P: 0.8,
      score: 0.8,
      human: { kind: "unobserved" },
      config: DEFAULT_TRACKING_CONFIG,
      deterministicFail: false,
      ownershipEscape: false,
      claimedVerificationWithoutChecks: false,
      criterionUnmet: false,
      repeatedNoProgress: false,
      userRejectStop: false,
      safetyRejected: false,
      openMinors: [minor("typo", { consecutiveTurns: 2 })]
    });
    assert.equal(decision.wakeAnalysis, true);
    assert.ok(decision.codes.includes("minor-escalated"));
  });

  it("does not let unverifiable minors wake analysis by themselves", () => {
    const decision = evaluateGates({
      P: 0.8,
      score: 0.8,
      human: { kind: "unobserved" },
      config: DEFAULT_TRACKING_CONFIG,
      deterministicFail: false,
      ownershipEscape: false,
      claimedVerificationWithoutChecks: false,
      criterionUnmet: false,
      repeatedNoProgress: false,
      userRejectStop: false,
      safetyRejected: false,
      openMinors: [
        minor("maybe", { status: "UNOBSERVED" }),
        minor("also", { status: "UNOBSERVED" }),
        minor("third", { status: "UNOBSERVED" })
      ]
    });
    assert.equal(decision.wakeAnalysis, false);
  });

  it("treats a rejected permission item as a hard anomaly", () => {
    const decision = evaluateGates({
      P: 0.8,
      score: 0.8,
      human: {
        kind: "ratio",
        H: 0.8,
        agreed: 4,
        evaluable: 5,
        safetyRejected: true
      },
      config: DEFAULT_TRACKING_CONFIG,
      deterministicFail: false,
      ownershipEscape: false,
      claimedVerificationWithoutChecks: false,
      criterionUnmet: false,
      repeatedNoProgress: false,
      userRejectStop: false,
      safetyRejected: true,
      openMinors: []
    });
    assert.equal(decision.kind, "hard");
    assert.ok(decision.codes.includes("permission-security-reject"));
  });
});
