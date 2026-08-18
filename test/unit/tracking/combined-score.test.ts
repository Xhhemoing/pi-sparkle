import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { combineScore } from "../../../src/tracking/combined-score.js";
import { UNOBSERVED } from "../../../src/tracking/types.js";

describe("tracking combined score", () => {
  it("equals P when the user is silent", () => {
    assert.equal(
      combineScore({
        P: 0.82,
        human: { kind: "unobserved" },
        obviousProblem: false
      }),
      0.82
    );
  });

  it("equals P when H is present but there is no obvious problem", () => {
    assert.equal(
      combineScore({
        P: 0.9,
        human: { kind: "ten-point", H: 0.8, mark: 8 },
        obviousProblem: false
      }),
      0.9
    );
  });

  it("uses 0.7*min + 0.3*max when there is an obvious human problem", () => {
    assert.equal(
      combineScore({
        P: 0.9,
        human: { kind: "short-rule", H: 0.2, bucket: "whole-reject" },
        obviousProblem: true
      }),
      0.41
    );
  });

  it("applies the formula to a 7-point mark when the mark is below 8", () => {
    assert.equal(
      combineScore({
        P: 0.9,
        human: { kind: "ten-point", H: 0.7, mark: 7 },
        obviousProblem: true
      }),
      0.76
    );
  });

  it("never substitutes 0.5 for a missing H", () => {
    const score = combineScore({
      P: 0.9,
      human: { kind: "unobserved" },
      obviousProblem: true
    });
    assert.equal(score, 0.9);
    assert.notEqual(score, 0.5 * 0.9 + 0.5 * 0.5);
    assert.notEqual(UNOBSERVED, 0.5);
  });
});
