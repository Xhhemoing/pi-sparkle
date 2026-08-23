import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseOfflineRow } from "../../../src/routing/offline-types.js";

describe("offline row schema", () => {
  it("rejects a row that carries tracking score instead of taskSuccess y", () => {
    assert.throws(() =>
      parseOfflineRow({
        scenarioId: "bugfix|engineer",
        modelVersion: "v1",
        projectId: "prj_a",
        y: 0.41,
        occurredAtMs: 1
      })
    );
  });

  it("accepts a 0/1 taskSuccess row", () => {
    const row = parseOfflineRow({
      scenarioId: "bugfix|engineer",
      modelVersion: "v1",
      projectId: "prj_a",
      y: 1,
      occurredAtMs: 1
    });
    assert.equal(row.y, 1);
  });

  it("fails closed on empty ids and bad timestamps", () => {
    assert.throws(() =>
      parseOfflineRow({ scenarioId: "", modelVersion: "v1", projectId: "p", y: 0, occurredAtMs: 1 })
    );
    assert.throws(() =>
      parseOfflineRow({ scenarioId: "s", modelVersion: "v1", projectId: "p", y: 0, occurredAtMs: -1 })
    );
    assert.throws(() =>
      parseOfflineRow({ scenarioId: "s", modelVersion: "v1", projectId: "p", y: 0, occurredAtMs: Number.NaN })
    );
  });
});
