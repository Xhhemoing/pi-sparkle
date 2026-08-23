import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calibrateSoftThreshold } from "../../../src/experiments/threshold-calibration.js";

describe("soft-threshold calibration", () => {
  it("reports F1 at 0.45/0.55/0.65 and does not change live 0.55", () => {
    const labels = [
      { score: 0.4, shouldWake: true },
      { score: 0.5, shouldWake: true },
      { score: 0.7, shouldWake: false },
      { score: 0.9, shouldWake: false }
    ];
    const report = calibrateSoftThreshold(labels);
    assert.deepEqual(report.thresholds, [0.45, 0.55, 0.65]);
    assert.equal(report.rows.length, 3);
    assert.equal(report.liveThresholdUnchanged, 0.55);
    assert.equal(report.changesLiveConfig, false);
    assert.ok(report.rows.every((r) => r.f1 >= 0 && r.f1 <= 1));
  });

  it("recommends the best-F1 threshold informationally", () => {
    const labels = [
      { score: 0.3, shouldWake: true },
      { score: 0.5, shouldWake: true },
      { score: 0.52, shouldWake: false },
      { score: 0.9, shouldWake: false }
    ];
    const report = calibrateSoftThreshold(labels);
    // 0.45 misses the 0.5 positive (recall penalty); 0.55 gets all positives
    // without waking the 0.52 negative: perfect F1.
    assert.equal(report.recommendedThreshold, 0.55);
  });
});
