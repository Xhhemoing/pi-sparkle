import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluatePreferenceLoop } from "../../../src/preferences/loop-eval.js";
import type { PreferenceObservation } from "../../../src/preferences/types.js";
import { createEpisodeId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";

const episodeId = createEpisodeId();

function observation(
  overrides: Partial<PreferenceObservation> &
    Pick<PreferenceObservation, "id" | "value" | "createdAt" | "explicit">
): PreferenceObservation {
  return {
    scope: "user",
    scopeKey: "u1",
    key: "format",
    evidenceEpisodeId: episodeId,
    weight: overrides.explicit ? 1 : 0.5,
    recurrenceCount: 1,
    ...overrides,
  };
}

describe("M4-T4: preference-loop fit, correction cost, forgetting, reversal", () => {
  it("fit is the fraction of later explicit observations that match the then-effective view", () => {
    const agree = evaluatePreferenceLoop(
      [
        observation({
          id: "e1",
          value: "compact",
          explicit: true,
          createdAt: parseIsoTimestamp("2026-01-01T00:00:00.000Z"),
        }),
        observation({
          id: "e2",
          value: "compact",
          explicit: true,
          createdAt: parseIsoTimestamp("2026-01-02T00:00:00.000Z"),
        }),
      ],
      new Set()
    );
    assert.equal(agree.fit, 1);
    assert.equal(agree.correctionCost, 0);
    assert.equal(agree.forgettingEvents, 0);
    assert.equal(agree.reversalEvents, 0);

    const disagree = evaluatePreferenceLoop(
      [
        observation({
          id: "e1",
          value: "compact",
          explicit: true,
          createdAt: parseIsoTimestamp("2026-01-01T00:00:00.000Z"),
        }),
        observation({
          id: "e2",
          value: "verbose",
          explicit: true,
          createdAt: parseIsoTimestamp("2026-01-02T00:00:00.000Z"),
        }),
      ],
      new Set()
    );
    assert.equal(disagree.fit, 0);
    assert.equal(disagree.correctionCost, 1);
  });

  it("counts explicit overrides of a prior inferred or explicit value as correction cost", () => {
    const report = evaluatePreferenceLoop(
      [
        observation({
          id: "i1",
          value: "compact",
          explicit: false,
          createdAt: parseIsoTimestamp("2026-01-01T00:00:00.000Z"),
        }),
        observation({
          id: "i2",
          value: "compact",
          explicit: false,
          recurrenceCount: 2,
          createdAt: parseIsoTimestamp("2026-01-02T00:00:00.000Z"),
        }),
        observation({
          id: "e1",
          value: "verbose",
          explicit: true,
          createdAt: parseIsoTimestamp("2026-01-03T00:00:00.000Z"),
        }),
      ],
      new Set()
    );
    assert.equal(report.correctionCost, 1);
    assert.equal(report.forgettingEvents, 1);
    assert.equal(report.fit, 0);
  });

  it("counts forgetting when a tombstone removes the effective value", () => {
    const report = evaluatePreferenceLoop(
      [
        observation({
          id: "e1",
          value: "compact",
          explicit: true,
          createdAt: parseIsoTimestamp("2026-01-01T00:00:00.000Z"),
        }),
      ],
      new Set(["e1"])
    );
    assert.equal(report.forgettingEvents, 1);
    assert.equal(report.correctionCost, 0);
    assert.equal(report.fit, 1);
  });

  it("counts a reversal when the effective value flips A→B then B→A", () => {
    const report = evaluatePreferenceLoop(
      [
        observation({
          id: "e1",
          value: "compact",
          explicit: true,
          createdAt: parseIsoTimestamp("2026-01-01T00:00:00.000Z"),
        }),
        observation({
          id: "e2",
          value: "verbose",
          explicit: true,
          createdAt: parseIsoTimestamp("2026-01-02T00:00:00.000Z"),
        }),
        observation({
          id: "e3",
          value: "compact",
          explicit: true,
          createdAt: parseIsoTimestamp("2026-01-03T00:00:00.000Z"),
        }),
      ],
      new Set()
    );
    assert.equal(report.reversalEvents, 1);
    assert.equal(report.correctionCost, 2);
    assert.equal(report.fit, 0);
  });
});
