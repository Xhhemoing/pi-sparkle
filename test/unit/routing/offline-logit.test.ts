import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fitLogitAdditive } from "../../../src/routing/offline-logit.js";
import { solveSymmetric } from "../../../src/routing/lin-alg.js";
import type { AttributionReport, OfflineRow } from "../../../src/routing/offline-types.js";

describe("linear algebra", () => {
  it("solves a small symmetric system and detects singularity", () => {
    const solution = solveSymmetric([[4, 2], [2, 3]], [1, 2]);
    assert.ok(solution);
    assert.ok(Math.abs(solution[0]! - -0.125) < 1e-9);
    assert.ok(Math.abs(solution[1]! - 0.75) < 1e-9);
    assert.equal(solveSymmetric([[1, 1], [1, 1]], [1, 1]), null);
  });
});

describe("logit-additive attribution", () => {
  it("retains a named negative weak-reference effect on a separable fixture with two-row pairs", () => {
    const rows: OfflineRow[] = [];
    for (let i = 0; i < 8; i++) {
      rows.push({ scenarioId: "s|r", modelVersion: "weak", projectId: `prj_${i % 3}`, y: 0, occurredAtMs: i });
      rows.push({ scenarioId: "s|r", modelVersion: "strong", projectId: `prj_${i % 3}`, y: 1, occurredAtMs: 100 + i });
    }
    const report = fitLogitAdditive(rows, { bootstrap: 80, seed: 20260818 });
    assert.equal(report.writesActivePointer, false);
    assert.equal(report.rowsUsed, 16);
    assert.ok(report.diagnosis === "model-problem" || report.diagnosis === "uncertain");
    assert.ok(effect(report, "u:weak").point < -0.49);
  });

  it("standardizes every model including the canonical weak reference on a common full grid", () => {
    const rows = balancedRows();
    const report = fitLogitAdditive(rows, { bootstrap: 40, seed: 7 });
    assert.equal(report.diagnosis, "model-problem");
    assert.equal(report.rowsUsed, 144);
    assert.equal(report.writesActivePointer, false);
    assert.match(report.reason, /^logit-standardized-v2:/);
    assert.ok(Math.abs(effect(report, "u:weak").point + 0.25) < 1e-5);
    assert.ok(Math.abs(effect(report, "u:strong").point - 0.25) < 1e-5);
    assert.ok(effect(report, "u:weak").ucb < -0.1);
    for (const name of ["a:s-a", "a:s-b", "v:p-a", "v:p-b", "v:p-c"]) {
      assert.ok(Math.abs(effect(report, name).point) < 1e-5, name);
    }
    assert.equal(report.effects.filter((e) => e.name.startsWith("w:")).length, 6);
  });

  it("keeps names, intervals and diagnosis invariant under fixed shuffles without mutating inputs", () => {
    const rows = balancedRows();
    const original = structuredClone(rows);
    for (const row of rows) Object.freeze(row);
    Object.freeze(rows);
    const expected = fitLogitAdditive(rows, { bootstrap: 40, seed: 7 });
    const orders = [
      [...rows].reverse(),
      rows.filter((_, i) => i % 2 === 1).concat(rows.filter((_, i) => i % 2 === 0)),
      Array.from({ length: rows.length }, (_, i) => rows[(i * 53) % rows.length]!)
    ];
    for (const order of orders) {
      const before = structuredClone(order);
      const actual = fitLogitAdditive(order, { bootstrap: 40, seed: 7 });
      assert.equal(actual.diagnosis, expected.diagnosis);
      assert.equal(actual.reason, expected.reason);
      assert.deepEqual(actual.effects.map((e) => e.name), expected.effects.map((e) => e.name));
      for (const wanted of expected.effects) {
        const found = effect(actual, wanted.name);
        for (const key of ["point", "lcb", "ucb"] as const) {
          assert.ok(Math.abs(found[key] - wanted[key]) <= 1e-10, `${wanted.name}.${key}`);
        }
      }
      assert.deepEqual(order, before);
    }
    assert.deepEqual(rows, original);
  });

  it("fails closed when model and project are perfectly confounded despite mixed outcomes", () => {
    const rows: OfflineRow[] = [];
    for (const [modelVersion, projectId, successes] of [["strong", "p-a", 9], ["weak", "p-b", 3]] as const) {
      for (let i = 0; i < 12; i++) rows.push({ scenarioId: "s", modelVersion, projectId, y: i < successes ? 1 : 0, occurredAtMs: i });
    }
    const report = fitLogitAdditive(rows, { bootstrap: 40, seed: 7 });
    assert.equal(report.rowsUsed, 24);
    assert.equal(report.diagnosis, "uncertain");
    assert.deepEqual(report.effects, []);
    assert.match(report.reason, /^logit-standardized-v2: INVALID_ESTIMATE:.*rank/);
  });

  it("rejects an exact scenario interaction dependency before bootstrap regardless of duplicate counts", () => {
    // In all four cells a:s-a = intercept - u:m0 - v:p0 + 2*w:[m0,p0].
    // Uneven duplicates previously introduced a spurious pivot in X'X.
    const rows = dependentRows([5353, 5568, 5227, 3418]);
    const report = fitLogitAdditive(rows, { bootstrap: 0, seed: 7 });
    assert.equal(report.rowsUsed, 19566);
    assert.equal(report.diagnosis, "uncertain");
    assert.deepEqual(report.effects, []);
    assert.match(report.reason, /INVALID_ESTIMATE: rank-deficient design/);
  });

  it("accepts the formerly dependent design when an independent scenario row identifies it", () => {
    const rows = dependentRows([12, 12, 12, 12]);
    for (let i = 0; i < 12; i++) {
      rows.push({ scenarioId: "s-b", modelVersion: "m0", projectId: "p0", y: i % 2 as 0 | 1, occurredAtMs: rows.length });
    }
    const report = fitLogitAdditive(rows, { bootstrap: 40, seed: 7 });
    assert.equal(report.rowsUsed, 60);
    assert.equal(report.effects.length, 10);
    assert.doesNotMatch(report.reason, /INVALID_ESTIMATE/);
    assert.ok(report.effects.every((e) => Math.abs(e.point) < 1e-10));
  });
  it("preserves exact model-project identities when labels contain delimiters and prefixes", () => {
    const hostile = interactionRows(["a", "a|b", "z"], ["b|c", "c", "z"]);
    const safe = interactionRows(["m0", "m1", "m2"], ["p0", "p1", "p2"]);
    const report = fitLogitAdditive(hostile, { bootstrap: 40, seed: 7 });
    const renamed = fitLogitAdditive(safe, { bootstrap: 40, seed: 7 });
    assert.equal(report.diagnosis, "interaction-only");
    assert.equal(report.diagnosis, renamed.diagnosis);
    assert.equal(new Set(report.effects.map((e) => e.name)).size, report.effects.length);
    assert.ok(Math.abs(effect(report, 'w:["a","b|c"]').point + 1 / 3) < 1e-5);
    assert.ok(Math.abs(effect(report, 'w:["a|b","c"]').point + 1 / 3) < 1e-5);
    const models = ["a", "a|b", "z"];
    const projects = ["b|c", "c", "z"];
    for (let m = 0; m < models.length; m++) {
      for (let p = 0; p < projects.length; p++) {
        const actual = effect(report, `w:${JSON.stringify([models[m], projects[p]])}`);
        const expected = effect(renamed, `w:${JSON.stringify([`m${m}`, `p${p}`])}`);
        for (const key of ["point", "lcb", "ucb"] as const) assert.ok(Math.abs(actual[key] - expected[key]) < 1e-10);
      }
    }
  });

  it("rejects rank-losing bootstrap draws rather than letting ridge identify absent levels", () => {
    const rows: OfflineRow[] = Array.from({ length: 40 }, (_, i) => ({
      scenarioId: "common", modelVersion: "m", projectId: "p", y: i % 2 as 0 | 1, occurredAtMs: i
    }));
    rows.push({ scenarioId: "rare", modelVersion: "m", projectId: "p", y: 0, occurredAtMs: 40 });
    const report = fitLogitAdditive(rows, { bootstrap: 20, seed: 7 });
    assert.equal(report.rowsUsed, 41);
    assert.equal(report.diagnosis, "uncertain");
    assert.deepEqual(report.effects, []);
    assert.match(report.reason, /^logit-standardized-v2: INVALID_ESTIMATE: fewer than 20 successful bootstrap draws/);
  });

  it("fails closed on empty or single-class data", () => {
    for (const rows of [[], balancedRows().map((row) => ({ ...row, y: 0 as const })), balancedRows().map((row) => ({ ...row, y: 1 as const }))]) {
      const report = fitLogitAdditive(rows);
      assert.equal(report.diagnosis, "uncertain");
      assert.equal(report.rowsUsed, rows.length);
      assert.deepEqual(report.effects, []);
      assert.match(report.reason, /^logit-standardized-v2: INVALID_ESTIMATE/);
      assert.equal(report.writesActivePointer, false);
    }
  });

  it("is deterministic under the same seed", () => {
    const rows = balancedRows();
    const a = fitLogitAdditive(rows, { bootstrap: 30, seed: 7 });
    const b = fitLogitAdditive(rows, { bootstrap: 30, seed: 7 });
    assert.deepEqual(a.effects, b.effects);
  });
});

function effect(report: AttributionReport, name: string) {
  const found = report.effects.find((e) => e.name === name);
  assert.ok(found, `missing effect ${name}`);
  return found;
}

function balancedRows(): OfflineRow[] {
  const rows: OfflineRow[] = [];
  for (const scenarioId of ["s-a", "s-b"]) {
    for (const modelVersion of ["strong", "weak"]) {
      for (const projectId of ["p-a", "p-b", "p-c"]) {
        for (let i = 0; i < 12; i++) rows.push({ scenarioId, modelVersion, projectId, y: i < (modelVersion === "strong" ? 9 : 3) ? 1 : 0, occurredAtMs: rows.length });
      }
    }
  }
  return rows;
}

function interactionRows(models: readonly string[], projects: readonly string[]): OfflineRow[] {
  const successes = [[4, 20, 12], [20, 4, 12], [12, 12, 12]];
  const rows: OfflineRow[] = [];
  for (let m = 0; m < models.length; m++) {
    for (let p = 0; p < projects.length; p++) {
      for (let i = 0; i < 24; i++) rows.push({ scenarioId: "s", modelVersion: models[m]!, projectId: projects[p]!, y: i < successes[m]![p]! ? 1 : 0, occurredAtMs: rows.length });
    }
  }
  return rows;
}

function dependentRows(counts: readonly number[]): OfflineRow[] {
  const rows: OfflineRow[] = [];
  for (let m = 0; m < 2; m++) {
    for (let p = 0; p < 2; p++) {
      for (let i = 0; i < counts[m * 2 + p]!; i++) {
        rows.push({ scenarioId: m === p ? "s-a" : "s-b", modelVersion: `m${m}`, projectId: `p${p}`, y: i % 2 as 0 | 1, occurredAtMs: rows.length });
      }
    }
  }
  return rows;
}
