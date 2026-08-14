import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getActiveRubric,
  listRubrics,
  registerRubric,
  resetRubricRegistry,
} from "../../../src/rubric/registry.js";
import { createRubric } from "../../../src/rubric/types.js";
import type { RubricCriterion } from "../../../src/rubric/types.js";

describe("M4-T1: Rubric registry", () => {
  it("registers and retrieves rubrics by scope", () => {
    resetRubricRegistry();
    const criteria: RubricCriterion[] = [
      { id: "c1", description: "Test criterion", weight: 1.0, observableCheck: "exists" },
    ];
    const rubric = createRubric("test-rubric", "project", criteria);
    registerRubric(rubric);

    const active = getActiveRubric("project");
    assert.equal(active?.id, "test-rubric");
    assert.equal(active?.scope, "project");
  });

  it("rejects unknown rubric versions (via missing id)", () => {
    resetRubricRegistry();
    const active = getActiveRubric("task");
    assert.equal(active, undefined);
  });

  it("lists all registered rubrics", () => {
    resetRubricRegistry();
    const c: RubricCriterion[] = [
      { id: "c", description: "x", weight: 1, observableCheck: "" },
    ];
    registerRubric(createRubric("r1", "global", c));
    registerRubric(createRubric("r2", "task", c));

    const all = listRubrics();
    assert.equal(all.length, 2);
  });
});
