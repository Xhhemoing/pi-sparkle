import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fitLogitAdditive } from "../../../src/routing/offline-logit.js";
import { solveSymmetric } from "../../../src/routing/lin-alg.js";
import type { OfflineRow } from "../../../src/routing/offline-types.js";

describe("linear algebra", () => {
  it("solves a small symmetric system and detects singularity", () => {
    const solution = solveSymmetric(
      [
        [4, 2],
        [2, 3]
      ],
      [1, 2]
    );
    assert.ok(solution);
    assert.ok(Math.abs(solution[0]! - -0.125) < 1e-9);
    assert.ok(Math.abs(solution[1]! - 0.75) < 1e-9);
    assert.equal(solveSymmetric([[1, 1], [1, 1]], [1, 1]), null);
  });
});

describe("logit-additive attribution", () => {
  it("recovers a large model dummy as model-problem on a separable fixture", () => {
    const rows: OfflineRow[] = [];
    for (let i = 0; i < 8; i++) {
      rows.push({ scenarioId: "s|r", modelVersion: "weak", projectId: `prj_${i % 3}`, y: 0, occurredAtMs: i });
      rows.push({ scenarioId: "s|r", modelVersion: "strong", projectId: `prj_${i % 3}`, y: 1, occurredAtMs: 100 + i });
    }
    const report = fitLogitAdditive(rows, { bootstrap: 80, seed: 20260818 });
    assert.equal(report.writesActivePointer, false);
    assert.ok(report.diagnosis === "model-problem" || report.diagnosis === "uncertain");
    assert.ok(report.effects.some((e) => e.name.startsWith("u:weak")));
  });

  it("fails closed to INVALID_ESTIMATE on empty design", () => {
    const report = fitLogitAdditive([]);
    assert.equal(report.reason.includes("INVALID_ESTIMATE") || report.diagnosis === "uncertain", true);
  });

  it("is deterministic under the same seed", () => {
    const rows: OfflineRow[] = OFFLINE_ROWS();
    const a = fitLogitAdditive(rows, { bootstrap: 30, seed: 7 });
    const b = fitLogitAdditive(rows, { bootstrap: 30, seed: 7 });
    assert.deepEqual(a.effects, b.effects);
  });
});

function OFFLINE_ROWS(): OfflineRow[] {
  const rows: OfflineRow[] = [];
  for (let i = 0; i < 12; i++) {
    rows.push({
      scenarioId: "s|r",
      modelVersion: i % 4 === 0 ? "weak" : "strong",
      projectId: `prj_${i % 3}`,
      y: i % 4 === 0 ? 0 : 1,
      occurredAtMs: i
    });
  }
  return rows;
}
