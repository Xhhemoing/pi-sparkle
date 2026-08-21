import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createAdaptationDriftMonitor } from "../../../src/adaptation/monitor.js";
import type { DriftObservation } from "../../../src/adaptation/monitor.js";

function obs(overrides: Partial<DriftObservation> = {}): DriftObservation {
  return {
    modelVersion: "model-a",
    taskFamily: "edit",
    projectId: "prj_one",
    policyVersion: "pol-1",
    judgeCalibration: 0.8,
    ...overrides
  };
}

describe("M6-T6: adaptation drift monitor", () => {
  it("freezes a baseline then reports taskMix drift on an unseen family", () => {
    const monitor = createAdaptationDriftMonitor({ windowSize: 2 });
    const first = monitor.observe(obs());
    const second = monitor.observe(obs({ taskFamily: "test" }));
    assert.equal(first.drifted, false);
    assert.equal(second.drifted, false);
    assert.equal(second.uncertainty, 0);

    const third = monitor.observe(obs({ taskFamily: "deploy" }));
    assert.equal(third.drifted, false, "one unseen in a window of two is not a majority");

    const report = monitor.observe(obs({ taskFamily: "deploy" }));
    assert.equal(report.drifted, true);
    assert.equal(report.axes.taskMix, true);
    assert.equal(report.axes.modelVersion, false);
    assert.equal(report.axes.project, false);
    assert.equal(report.axes.policy, false);
    assert.equal(report.axes.judgeCalibration, false);
    assert.ok(report.evidence.some((item) => /taskMix: unseen family deploy/.test(item)));
    assert.ok(report.uncertainty > 0);
    assert.ok(report.uncertainty <= 1);
  });

  it("widens uncertainty when any later-window axis drifts", () => {
    const monitor = createAdaptationDriftMonitor({ windowSize: 2, calibrationDelta: 0.25 });
    monitor.observe(obs({ judgeCalibration: 0.9 }));
    monitor.observe(obs({ judgeCalibration: 0.9 }));
    const stable = monitor.observe(obs({ judgeCalibration: 0.9 }));
    assert.equal(stable.drifted, false);
    assert.equal(stable.uncertainty, 0);

    monitor.observe(obs({ judgeCalibration: 0.4 }));
    const drifted = monitor.observe(obs({ judgeCalibration: 0.4 }));
    assert.equal(drifted.axes.judgeCalibration, true);
    assert.equal(drifted.drifted, true);
    assert.ok(drifted.uncertainty > stable.uncertainty);
    assert.ok(drifted.evidence.length > 0);
  });

  it("detects unseen model, project, and policy values in the recent window", () => {
    const monitor = createAdaptationDriftMonitor({ windowSize: 2 });
    monitor.observe(obs());
    monitor.observe(obs());
    monitor.observe(
      obs({
        modelVersion: "model-b",
        projectId: "prj_two",
        policyVersion: "pol-9"
      })
    );
    const report = monitor.observe(
      obs({
        modelVersion: "model-b",
        projectId: "prj_two",
        policyVersion: "pol-9"
      })
    );
    assert.equal(report.drifted, true);
    assert.equal(report.axes.modelVersion, true);
    assert.equal(report.axes.project, true);
    assert.equal(report.axes.policy, true);
    assert.ok(report.evidence.some((item) => /modelVersion: unseen version model-b/.test(item)));
    assert.ok(report.evidence.some((item) => /project: unseen project prj_two/.test(item)));
    assert.ok(report.evidence.some((item) => /policy: unseen version pol-9/.test(item)));
  });

  it("round-trips observations through snapshot and restore", () => {
    const monitor = createAdaptationDriftMonitor({ windowSize: 2 });
    monitor.observe(obs());
    monitor.observe(obs());
    monitor.observe(obs({ taskFamily: "deploy" }));
    monitor.observe(obs({ taskFamily: "deploy" }));
    const snap = monitor.snapshot();
    assert.equal(snap.length, 4);

    const restored = createAdaptationDriftMonitor({ windowSize: 2 });
    restored.restore(snap);
    assert.deepEqual(restored.snapshot(), snap);
    const next = restored.observe(obs({ taskFamily: "deploy" }));
    assert.equal(next.drifted, true);
    assert.equal(next.axes.taskMix, true);
  });

  it("fails closed on invalid observations and options", () => {
    assert.throws(() => createAdaptationDriftMonitor({ windowSize: 0 }), /windowSize/);
    assert.throws(() => createAdaptationDriftMonitor({ calibrationDelta: 0 }), /calibrationDelta/);
    const monitor = createAdaptationDriftMonitor({ windowSize: 2 });
    assert.throws(() => monitor.observe(obs({ taskFamily: "" })), /taskFamily/);
    assert.throws(() => monitor.observe(obs({ judgeCalibration: 1.5 })), /judgeCalibration/);
  });
});
