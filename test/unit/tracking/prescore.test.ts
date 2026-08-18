import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computePrescore } from "../../../src/tracking/prescore.js";
import { DEFAULT_TRACKING_CONFIG } from "../../../src/tracking/config.js";
import { TRACKING_EVIDENCE_PRECEDENCE } from "../../../src/tracking/types.js";
import type { ConstraintRecord } from "../../../src/tracking/types.js";

const PRIVACY: ConstraintRecord = {
  id: "privacy-1",
  text: "do not persist raw PII",
  kind: "constraint",
  mandatory: true
};

describe("tracking prescore P", () => {
  it("caps P at 0.30 when a hard-related dimension fails", () => {
    const result = computePrescore({
      claims: ["tests passed"],
      toolSituations: [{ name: "test", exitCode: 1, wrote: false, escaped: false, artifactIds: [], evidenceIds: [], hashes: [] }],
      writePaths: [],
      ownedPaths: ["src/a.ts"],
      requiredChecks: ["test"],
      completedChecks: ["test"],
      constraints: [PRIVACY],
      retainedConstraintIds: ["privacy-1"],
      progressed: true,
      stalledTurns: 0,
      independentEvidence: true
    });
    assert.equal(result.cappedByHardFail, true);
    assert.ok(result.displayPrescore <= DEFAULT_TRACKING_CONFIG.hardFailCap);
    const evidence = result.dimensions.find((d) => d.id === "evidence-consistency");
    assert.equal(evidence?.outcome, "FAIL");
  });

  it("does not fill UNOBSERVED dimensions with 0.5 or treat them as a high score", () => {
    const result = computePrescore({
      claims: [],
      toolSituations: [],
      writePaths: [],
      ownedPaths: [],
      requiredChecks: ["test"],
      completedChecks: [],
      constraints: [PRIVACY],
      retainedConstraintIds: ["privacy-1"],
      progressed: "UNOBSERVED",
      stalledTurns: 0,
      independentEvidence: false,
      narrative: "UNOBSERVED"
    });
    assert.ok(result.P <= DEFAULT_TRACKING_CONFIG.unobservedHighCap);
    assert.notEqual(result.P, 0.5);
    const coverage = result.dimensions.find((d) => d.id === "check-coverage");
    assert.equal(coverage?.outcome, "UNOBSERVED");
  });

  it("never averages narrative quality with a failing test", () => {
    const result = computePrescore({
      claims: [],
      toolSituations: [{ name: "test", exitCode: 1, wrote: false, escaped: false, artifactIds: [], evidenceIds: [], hashes: [] }],
      writePaths: [],
      ownedPaths: ["src/a.ts"],
      requiredChecks: ["test"],
      completedChecks: ["test"],
      constraints: [PRIVACY],
      retainedConstraintIds: ["privacy-1"],
      progressed: true,
      stalledTurns: 0,
      independentEvidence: true,
      narrative: "PASS"
    });
    const narrative = result.dimensions.find((d) => d.id === "narrative-coherence");
    assert.equal(narrative?.outcome, "PASS");
    assert.ok(result.displayPrescore <= DEFAULT_TRACKING_CONFIG.hardFailCap);
  });

  it("gives actor self-score weight 0 in the precedence table", () => {
    const self = TRACKING_EVIDENCE_PRECEDENCE.find((row) => row.source === "actor-self-score");
    const deterministic = TRACKING_EVIDENCE_PRECEDENCE.find((row) => row.source === "deterministic");
    assert.equal(self?.weight, 0);
    assert.ok((deterministic?.weight ?? 0) > 0);
    const result = computePrescore({
      claims: [],
      toolSituations: [{ name: "test", exitCode: 0, wrote: false, escaped: false, artifactIds: [], evidenceIds: ["evd_ok"], hashes: ["abc"] }],
      writePaths: [],
      ownedPaths: ["src/a.ts"],
      requiredChecks: ["test"],
      completedChecks: ["test"],
      constraints: [PRIVACY],
      retainedConstraintIds: ["privacy-1"],
      progressed: true,
      stalledTurns: 0,
      independentEvidence: true,
      actorSelfScore: 0.99
    });
    assert.notEqual(result.P, 0.99);
  });

  it("dips P slightly for verified light minors", () => {
    const clean = computePrescore({
      claims: [],
      toolSituations: [{ name: "test", exitCode: 0, wrote: false, escaped: false, artifactIds: [], evidenceIds: ["evd_ok"], hashes: ["abc"] }],
      writePaths: [],
      ownedPaths: ["src/a.ts"],
      requiredChecks: ["test"],
      completedChecks: ["test"],
      constraints: [PRIVACY],
      retainedConstraintIds: ["privacy-1"],
      progressed: true,
      stalledTurns: 0,
      independentEvidence: true
    });
    const dipped = computePrescore({
      claims: [],
      toolSituations: [{ name: "test", exitCode: 0, wrote: false, escaped: false, artifactIds: [], evidenceIds: ["evd_ok"], hashes: ["abc"] }],
      writePaths: [],
      ownedPaths: ["src/a.ts"],
      requiredChecks: ["test"],
      completedChecks: ["test"],
      constraints: [PRIVACY],
      retainedConstraintIds: ["privacy-1"],
      progressed: true,
      stalledTurns: 0,
      independentEvidence: true,
      lightMinorCount: 1
    });
    assert.ok(dipped.P < clean.P);
    assert.ok(clean.P - dipped.P >= DEFAULT_TRACKING_CONFIG.minorPDip - 1e-9);
  });

  it("fails scope safety when a write escapes episode ownership", () => {
    const result = computePrescore({
      claims: [],
      toolSituations: [{ name: "write", targetPath: "../secrets.env", wrote: true, escaped: true, artifactIds: [], evidenceIds: [], hashes: [] }],
      writePaths: ["../secrets.env"],
      ownedPaths: ["src/a.ts"],
      requiredChecks: [],
      completedChecks: [],
      constraints: [PRIVACY],
      retainedConstraintIds: ["privacy-1"],
      progressed: true,
      stalledTurns: 0,
      independentEvidence: true
    });
    assert.equal(result.dimensions.find((d) => d.id === "scope-safety")?.outcome, "FAIL");
    assert.ok(result.displayPrescore <= DEFAULT_TRACKING_CONFIG.hardFailCap);
  });

  it("multiplies quality by coverage and does not treat UNOBSERVED as zero", () => {
    const r = computePrescore({
      claims: [],
      toolSituations: [{ name: "test", exitCode: 0, wrote: false, escaped: false, artifactIds: [], evidenceIds: ["evd_ok"], hashes: ["abc"] }],
      writePaths: [],
      ownedPaths: ["src/a.ts"],
      requiredChecks: ["test"],
      completedChecks: [],
      constraints: [],
      retainedConstraintIds: [],
      progressed: true,
      stalledTurns: 0,
      independentEvidence: true
    });
    // check-coverage UNOBSERVED; others observed PASS → coverage < 1, quality = 1
    assert.equal(r.quality, 1);
    assert.ok(r.coverage < 1);
    assert.equal(r.P, Number((r.quality * r.coverage).toFixed(4)));
    assert.notEqual(r.P, 0);
  });

  it("returns 0 when nothing is observable", () => {
    const r = computePrescore({
      claims: [],
      toolSituations: [],
      writePaths: [],
      ownedPaths: [],
      requiredChecks: [],
      completedChecks: [],
      constraints: [],
      retainedConstraintIds: [],
      progressed: "UNOBSERVED",
      stalledTurns: 0,
      independentEvidence: false
    });
    assert.equal(r.P, 0);
    assert.equal(r.coverage, 0);
  });

  it("ignores NOT_APPLICABLE check-coverage when no checks are required", () => {
    const r = computePrescore({
      claims: [],
      toolSituations: [{ name: "read", exitCode: 0, wrote: false, escaped: false, artifactIds: [], evidenceIds: ["evd_ok"], hashes: ["abc"] }],
      writePaths: [],
      ownedPaths: ["src/a.ts"],
      requiredChecks: [],
      completedChecks: [],
      constraints: [],
      retainedConstraintIds: [],
      progressed: true,
      stalledTurns: 0,
      independentEvidence: true
    });
    assert.equal(r.dimensions.find((d) => d.id === "check-coverage")?.outcome, "NOT_APPLICABLE");
    assert.equal(r.P, 1);
  });

  it("may ABSTAIN on narrative coherence", () => {
    const result = computePrescore({
      claims: [],
      toolSituations: [{ name: "test", exitCode: 0, wrote: false, escaped: false, artifactIds: [], evidenceIds: ["evd_ok"], hashes: ["abc"] }],
      writePaths: [],
      ownedPaths: ["src/a.ts"],
      requiredChecks: ["test"],
      completedChecks: ["test"],
      constraints: [PRIVACY],
      retainedConstraintIds: ["privacy-1"],
      progressed: true,
      stalledTurns: 0,
      independentEvidence: true,
      narrative: "ABSTAIN"
    });
    assert.equal(result.dimensions.find((d) => d.id === "narrative-coherence")?.outcome, "ABSTAIN");
  });
});
