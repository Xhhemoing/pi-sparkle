import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HoldoutVault } from "../../../src/experiments/holdout.js";
import type { IsoTimestamp } from "../../../src/domain/timestamp.js";

const NOW = "2026-08-14T00:00:00.000Z" as IsoTimestamp;
const ID = () => "ha_01234567";

function vault(): HoldoutVault {
  return new HoldoutVault({ now: () => NOW, generateId: ID });
}

describe("M6-T2: audited holdout lifecycle", () => {
  it("registers an open holdout and audits every access with a purpose", () => {
    const v = vault();
    v.register("ds-1");
    assert.equal(v.state("ds-1").status, "open");
    const audit = v.access("ds-1", "evaluate-candidate-c1");
    assert.equal(audit.length, 1);
    assert.equal(audit[0]?.purpose, "evaluate-candidate-c1");
    assert.equal(audit[0]?.datasetId, "ds-1");
    assert.equal(audit[0]?.accessedAt, NOW);
    v.access("ds-1", "check-contamination");
    assert.equal(v.state("ds-1").audit.length, 2);
  });

  it("rejects access to unregistered datasets and empty purposes", () => {
    const v = vault();
    assert.throws(() => v.access("ghost", "anything"), /unregistered/);
    v.register("ds-1");
    assert.throws(() => v.access("ds-1", "  "), /purpose/);
  });

  it("seals a compromised holdout and rejects further access", () => {
    const v = vault();
    v.register("ds-1");
    v.access("ds-1", "first-check");
    v.seal("ds-1", "episode leakage detected");
    const state = v.state("ds-1");
    assert.equal(state.status, "sealed");
    assert.equal(state.sealedReason, "episode leakage detected");
    assert.throws(() => v.access("ds-1", "try-again"), /sealed/);
    assert.throws(() => v.seal("ds-1", "double seal"), /already sealed/);
  });

  it("replaces a sealed holdout and never reuses it silently", () => {
    const v = vault();
    v.register("ds-1");
    v.seal("ds-1", "compromised");
    v.register("ds-2");
    v.replace("ds-1", "ds-2", "rotated to a fresh holdout");
    assert.equal(v.state("ds-1").replacedBy, "ds-2");
    assert.equal(v.state("ds-2").status, "open");
    // the old holdout stays sealed even after replacement
    assert.throws(() => v.access("ds-1", "reuse attempt"), /sealed/);
    v.access("ds-2", "fresh evaluation");
    assert.equal(v.state("ds-2").audit.length, 1);
  });

  it("refuses to replace an unsealed holdout", () => {
    const v = vault();
    v.register("ds-1");
    v.register("ds-2");
    assert.throws(() => v.replace("ds-1", "ds-2", "premature"), /unsealed/);
  });

  it("refuses replacement with an unregistered or already-sealed target", () => {
    const v = vault();
    v.register("ds-1");
    v.seal("ds-1", "compromised");
    assert.throws(() => v.replace("ds-1", "ghost", "bad target"), /replacement .* unregistered/);
    v.register("ds-3");
    v.seal("ds-3", "also compromised");
    assert.throws(() => v.replace("ds-1", "ds-3", "bad target"), /replacement .* not open/);
  });

  it("rejects unknown datasets on state and seal", () => {
    const v = vault();
    assert.throws(() => v.state("ghost"), /unregistered/);
    assert.throws(() => v.seal("ghost", "reason"), /unregistered/);
  });
});
