import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { paretoFront } from "../../../src/adaptation/pareto.js";
import type { CandidateMetrics } from "../../../src/adaptation/pareto.js";

function point(overrides: Partial<CandidateMetrics> & Pick<CandidateMetrics, "candidateId">): CandidateMetrics {
  return {
    quality: 0.5,
    preferenceFit: 0.5,
    costUsd: 1,
    latencyMs: 100,
    risk: 0.2,
    ...overrides,
  };
}

describe("M6-T4: paretoFront", () => {
  it("returns an empty front for empty input", () => {
    assert.deepEqual(paretoFront([]), []);
  });

  it("retains the non-dominated set when two of three points are on the front", () => {
    const highQuality = point({
      candidateId: "cnd_quality",
      quality: 0.9,
      preferenceFit: 0.8,
      costUsd: 1,
      latencyMs: 100,
      risk: 0.1,
    });
    const highPreference = point({
      candidateId: "cnd_pref",
      quality: 0.7,
      preferenceFit: 0.95,
      costUsd: 1.2,
      latencyMs: 80,
      risk: 0.2,
    });
    const dominated = point({
      candidateId: "cnd_dominated",
      quality: 0.6,
      preferenceFit: 0.7,
      costUsd: 2,
      latencyMs: 150,
      risk: 0.3,
    });

    const front = paretoFront([dominated, highPreference, highQuality]);
    assert.deepEqual(
      front.map((item) => item.candidateId),
      ["cnd_pref", "cnd_quality"]
    );
    assert.equal(front.includes(dominated), false);
  });

  it("sorts the front by candidateId regardless of input order", () => {
    const a = point({ candidateId: "cnd_a", quality: 1, preferenceFit: 0, costUsd: 5 });
    const b = point({ candidateId: "cnd_b", quality: 0, preferenceFit: 1, costUsd: 5 });
    assert.deepEqual(
      paretoFront([b, a]).map((item) => item.candidateId),
      ["cnd_a", "cnd_b"]
    );
    assert.deepEqual(
      paretoFront([a, b]).map((item) => item.candidateId),
      ["cnd_a", "cnd_b"]
    );
  });

  it("keeps equal metrics as coexisting local optima", () => {
    const left = point({ candidateId: "cnd_left" });
    const right = point({ candidateId: "cnd_right" });
    const front = paretoFront([left, right]);
    assert.equal(front.length, 2);
  });

  it("rejects metrics outside the declared ranges", () => {
    assert.throws(() => paretoFront([point({ candidateId: "cnd_x", quality: 1.1 })]), DomainValidationError);
    assert.throws(() => paretoFront([point({ candidateId: "cnd_x", risk: -0.01 })]), DomainValidationError);
    assert.throws(() => paretoFront([point({ candidateId: "cnd_x", costUsd: Number.NaN })]), DomainValidationError);
  });
});
