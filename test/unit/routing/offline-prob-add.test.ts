import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fitProbabilityAdditive } from "../../../src/routing/offline-prob-add.js";
import { OFFLINE_FIXTURE_ROWS } from "./offline-fixture.js";

describe("probability-additive attribution", () => {
  it("does not double-count an mp cell as extra parent evidence", () => {
    const rows: Array<{
      scenarioId: string;
      modelVersion: string;
      projectId: string;
      y: 0 | 1;
      occurredAtMs: number;
    }> = [
      { scenarioId: "s|r", modelVersion: "m1", projectId: "prj_a", y: 0, occurredAtMs: 1 },
      { scenarioId: "s|r", modelVersion: "m1", projectId: "prj_a", y: 0, occurredAtMs: 2 },
      { scenarioId: "s|r", modelVersion: "m1", projectId: "prj_a", y: 0, occurredAtMs: 3 },
      { scenarioId: "s|r", modelVersion: "m2", projectId: "prj_b", y: 1, occurredAtMs: 4 },
      { scenarioId: "s|r", modelVersion: "m2", projectId: "prj_b", y: 1, occurredAtMs: 5 },
      { scenarioId: "s|r", modelVersion: "m2", projectId: "prj_c", y: 1, occurredAtMs: 6 }
    ];
    const report = fitProbabilityAdditive(rows);
    assert.equal(report.writesActivePointer, false);
    assert.equal(report.estimator, "probability-additive");
    const model = report.effects.find((e) => e.name === "p_m-mu_s:m1");
    assert.ok(model);
    // All six rows are used exactly once.
    assert.equal(report.rowsUsed, 6);
  });

  it("returns uncertain when intervals are wide", () => {
    const report = fitProbabilityAdditive([
      { scenarioId: "s|r", modelVersion: "m1", projectId: "prj_a", y: 1, occurredAtMs: 1 }
    ]);
    assert.equal(report.diagnosis, "uncertain");
  });

  it("flags a uniformly failing scenario as scenario-hard on the fixture shape", () => {
    const rows = OFFLINE_FIXTURE_ROWS.map((row) => ({ ...row, y: 0 as const }));
    const manyProjects = Array.from({ length: 4 }, (_, i) => ({
      scenarioId: "s|r",
      modelVersion: i % 2 === 0 ? "weak" : "strong",
      projectId: `prj_${i}`,
      y: 0 as const,
      occurredAtMs: i + 1
    }));
    const report = fitProbabilityAdditive([...rows, ...manyProjects]);
    assert.equal(report.diagnosis, "scenario-hard");
  });
});
