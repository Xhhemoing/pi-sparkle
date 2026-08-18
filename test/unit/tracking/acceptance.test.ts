import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { combineScore } from "../../../src/tracking/combined-score.js";
import { evaluateGates } from "../../../src/tracking/gates.js";
import { extractHumanScore, hasObviousHumanProblem, humanScoreValue } from "../../../src/tracking/human-score.js";
import { DEFAULT_TRACKING_CONFIG } from "../../../src/tracking/config.js";
import { runTrackingTurn } from "../../../src/tracking/turn.js";
import { rollSummary } from "../../../src/tracking/roller.js";
import { UNOBSERVED } from "../../../src/tracking/types.js";
import type { ConstraintRecord, RollingSummary, TrackingWindow } from "../../../src/tracking/types.js";
import type { PrescoreInput } from "../../../src/tracking/prescore.js";

const PRIVACY: ConstraintRecord = {
  id: "privacy-1",
  text: "do not persist raw PII",
  kind: "constraint",
  mandatory: true
};

function window(previous?: RollingSummary): TrackingWindow {
  return {
    ...(previous !== undefined ? { previous } : {}),
    contextFacts: ["redact user emails"],
    toolSituations: [
      {
        name: "read",
        targetPath: "src/a.ts",
        wrote: false,
        escaped: false,
        artifactIds: [],
        evidenceIds: ["evd_1"],
        hashes: ["aa"]
      }
    ],
    constraints: [PRIVACY],
    unresolvedDecisions: [],
    confirmedDecisions: ["structured logs only"],
    openMinors: []
  };
}

function prescore(overrides: Partial<PrescoreInput> = {}): PrescoreInput {
  return {
    claims: [],
    toolSituations: window().toolSituations,
    writePaths: [],
    ownedPaths: ["src/a.ts"],
    requiredChecks: ["test"],
    completedChecks: ["test"],
    constraints: [PRIVACY],
    retainedConstraintIds: ["privacy-1"],
    progressed: true,
    stalledTurns: 0,
    independentEvidence: true,
    ...overrides
  };
}

describe("three-line tracking acceptance (§9)", () => {
  it("score matches §4: silence equals P; 4/5 agree uses the ratio path; 7分 uses the formula", () => {
    const silent = extractHumanScore({});
    assert.equal(humanScoreValue(silent), UNOBSERVED);
    assert.equal(
      combineScore({ P: 0.84, human: silent, obviousProblem: hasObviousHumanProblem(silent) }),
      0.84
    );

    const ratio = extractHumanScore({
      list: {
        items: [
          { id: "1", text: "a" },
          { id: "2", text: "b" },
          { id: "3", text: "c" },
          { id: "4", text: "d" },
          { id: "5", text: "e" }
        ],
        agreedIds: ["1", "2", "3", "4"]
      }
    });
    assert.equal(ratio.kind, "ratio");
    if (ratio.kind !== "ratio") return;
    assert.equal(ratio.H, 0.8);
    assert.equal(ratio.safetyRejected, false);
    assert.equal(
      combineScore({ P: 0.9, human: ratio, obviousProblem: hasObviousHumanProblem(ratio) }),
      0.83
    );

    const mark = extractHumanScore({ userText: "7分" });
    assert.equal(mark.kind, "ten-point");
    if (mark.kind !== "ten-point") return;
    assert.equal(mark.H, 0.7);
    assert.equal(hasObviousHumanProblem(mark), true);
    assert.equal(combineScore({ P: 0.9, human: mark, obviousProblem: true }), 0.76);
  });

  it("H=0.2 and P=0.9 yield score 0.41 and enter analysis; missing H is not 0.5", () => {
    const score = combineScore({
      P: 0.9,
      human: { kind: "short-rule", H: 0.2, bucket: "whole-reject" },
      obviousProblem: true
    });
    assert.equal(score, 0.41);
    const gate = evaluateGates({
      P: 0.9,
      score,
      human: { kind: "short-rule", H: 0.2, bucket: "whole-reject" },
      config: DEFAULT_TRACKING_CONFIG,
      deterministicFail: false,
      ownershipEscape: false,
      claimedVerificationWithoutChecks: false,
      repeatedNoProgress: false,
      userRejectStop: false,
      safetyRejected: false,
      openMinors: []
    });
    assert.equal(gate.wakeAnalysis, true);
    assert.notEqual(UNOBSERVED, 0.5);
    assert.equal(
      combineScore({ P: 0.9, human: { kind: "unobserved" }, obviousProblem: true }),
      0.9
    );
  });

  it("a test fail is a hard gate even when P would otherwise be high", () => {
    const result = runTrackingTurn({
      window: window(),
      prescoreInput: prescore({
        claims: ["tests passed"],
        toolSituations: [
          {
            name: "test",
            exitCode: 1,
            wrote: false,
            escaped: false,
            artifactIds: [],
            evidenceIds: ["evd_fail"],
            hashes: ["ff"]
          }
        ]
      }),
      humanInput: {},
      gateFacts: { deterministicFail: true }
    });
    assert.equal(result.gate.kind, "hard");
    assert.ok(result.gate.codes.includes("deterministic-fail"));
    assert.equal(result.gate.wakeAnalysis, true);
  });

  it("keeps an early privacy constraint across three rolled summaries", () => {
    let previous: RollingSummary | undefined;
    for (let i = 0; i < 3; i += 1) {
      previous = rollSummary({
        window: window(previous),
        prescore: 0.8,
        human: { kind: "unobserved" },
        score: 0.8,
        anomalyCodes: [],
        evidenceRefs: [`evd_${i}`],
        openMinors: []
      }).summary;
    }
    assert.ok(previous?.constraints.some((item) => item.id === "privacy-1"));
    assert.equal(previous?.failClosed, false);
  });

  it("does not call analysis for three light minors until the 2-turn or 3-count rule", () => {
    const two = evaluateGates({
      P: 0.8,
      score: 0.8,
      human: { kind: "unobserved" },
      config: DEFAULT_TRACKING_CONFIG,
      deterministicFail: false,
      ownershipEscape: false,
      claimedVerificationWithoutChecks: false,
      repeatedNoProgress: false,
      userRejectStop: false,
      safetyRejected: false,
      openMinors: [
        {
          id: "a",
          text: "a",
          status: "verified-true",
          consecutiveTurns: 1,
          touchesConstraint: false,
          userRejected: false
        },
        {
          id: "b",
          text: "b",
          status: "verified-true",
          consecutiveTurns: 1,
          touchesConstraint: false,
          userRejected: false
        }
      ]
    });
    assert.equal(two.wakeAnalysis, false);

    const repeated = evaluateGates({
      P: 0.8,
      score: 0.8,
      human: { kind: "unobserved" },
      config: DEFAULT_TRACKING_CONFIG,
      deterministicFail: false,
      ownershipEscape: false,
      claimedVerificationWithoutChecks: false,
      repeatedNoProgress: false,
      userRejectStop: false,
      safetyRejected: false,
      openMinors: [
        {
          id: "a",
          text: "a",
          status: "verified-true",
          consecutiveTurns: 2,
          touchesConstraint: false,
          userRejected: false
        }
      ]
    });
    assert.equal(repeated.wakeAnalysis, true);

    const three = evaluateGates({
      P: 0.8,
      score: 0.8,
      human: { kind: "unobserved" },
      config: DEFAULT_TRACKING_CONFIG,
      deterministicFail: false,
      ownershipEscape: false,
      claimedVerificationWithoutChecks: false,
      repeatedNoProgress: false,
      userRejectStop: false,
      safetyRejected: false,
      openMinors: ["a", "b", "c"].map((id) => ({
        id,
        text: id,
        status: "verified-true" as const,
        consecutiveTurns: 1,
        touchesConstraint: false,
        userRejected: false
      }))
    });
    assert.equal(three.wakeAnalysis, true);
  });

  it("hard-gates claimed-verification-without-checks when tests passed but required checks have no check events", () => {
    const result = runTrackingTurn({
      window: window(),
      prescoreInput: prescore({
        claims: ["tests passed"],
        requiredChecks: ["test"],
        completedChecks: []
      }),
      humanInput: {}
    });
    assert.equal(result.gate.kind, "hard");
    assert.ok(result.gate.codes.includes("claimed-verification-without-checks"));
  });
});
