import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeDevelopmentTrials } from "../../../src/development/evaluation.js";

test("task metrics separate first-pass, repair success and observed cost", () => {
  const report = summarizeDevelopmentTrials([
    { mode: "scripted", taskId: "one", accepted: true, attempts: 1, durationMs: 100, costSource: "observed", costUsd: 0.2 },
    { mode: "scripted", taskId: "two", accepted: true, attempts: 2, durationMs: 300, costSource: "unknown" },
    { mode: "scripted", taskId: "three", accepted: false, attempts: 3, durationMs: 500, costSource: "estimated", costUsd: 1 }
  ]);
  assert.equal(report.firstPassRate, 1 / 3);
  assert.equal(report.acceptanceRate, 2 / 3);
  assert.equal(report.repairSuccessRate, 1 / 2);
  assert.equal(report.observedCostUsd, 0.2);
  assert.equal(report.estimatedCostUsd, 1);
  assert.equal(report.costCoverage, 1 / 3);
  assert.equal(report.costPerAcceptedTaskUsd, undefined);
  assert.equal(report.supportsLiveEffectivenessClaim, false);
});

test("mixed modes and missing cost cannot pose as a live model benchmark", () => {
  assert.throws(() => summarizeDevelopmentTrials([
    { mode: "live", taskId: "one", accepted: true, attempts: 1, durationMs: 100, costSource: "unknown" },
    { mode: "scripted", taskId: "two", accepted: true, attempts: 2, durationMs: 100, costSource: "unknown" }
  ]), /mixed/);
  assert.throws(() => summarizeDevelopmentTrials([
    { mode: "live", taskId: "one", accepted: true, attempts: 1, durationMs: 100, costSource: "observed" }
  ]), /cost/);
});
