import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashAssessment, parseTrackingAssessment } from "../../../src/tracking/types.js";

const GATE_NONE = {
  kind: "none",
  codes: [],
  wakeAnalysis: false,
  expandDetail: false,
  askUser: false,
  openMinors: []
} as const;

describe("TrackingAssessment", () => {
  it("rejects an assessment without evidence refs on a FAIL dimension", () => {
    assert.throws(() =>
      parseTrackingAssessment({
        schemaVersion: 1,
        episodeId: "ep_a",
        runId: "run_a",
        turnId: "trn_1",
        prescore: 0.2,
        quality: 0,
        coverage: 1,
        human: { kind: "unobserved" },
        score: 0.2,
        dimensions: [{ id: "scope-safety", verdict: "FAIL" }],
        gate: {
          kind: "hard",
          codes: ["ownership-escape"],
          wakeAnalysis: true,
          expandDetail: true,
          askUser: false,
          openMinors: []
        },
        evidenceRefs: []
      })
    );
  });

  it("hashes equal assessments equally and changes when score changes", () => {
    const raw = {
      schemaVersion: 1,
      episodeId: "ep_a",
      runId: "run_a",
      turnId: "trn_1",
      prescore: 0.8,
      quality: 1,
      coverage: 0.8,
      human: { kind: "unobserved" },
      score: 0.8,
      dimensions: [{ id: "check-coverage", verdict: "PASS", evidenceRefs: ["evd_1"] }],
      gate: GATE_NONE,
      evidenceRefs: ["evd_1"]
    };
    const a = parseTrackingAssessment(raw);
    const b = parseTrackingAssessment({ ...raw, score: 0.4, prescore: 0.4 });
    assert.equal(hashAssessment(a), hashAssessment(a));
    assert.notEqual(hashAssessment(a), hashAssessment(b));
  });
});
