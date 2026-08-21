import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogFromPrimary } from "../../../src/routing/primary-catalog.js";
import { clarifyObjective } from "../../../src/track/clarify.js";
import { splitAndAssignForPrimary } from "../../../src/track/primary-split.js";

test("primary-owned split puts a planner on the primary model and cheaper work on other catalog models", async () => {
  const clarified = await clarifyObjective({
    objective: "Implement the checkout parser and add tests",
    projectKey: "proj-split",
    assumeDefaults: true
  });
  const result = splitAndAssignForPrimary({
    contract: clarified.candidate.contract,
    habits: clarified.habits,
    catalog: catalogFromPrimary({ primaryModelId: "premium", fastModelId: "cheap" }),
    generateId: (() => {
      let n = 0;
      return () => `split${++n}`;
    })()
  });
  assert.equal(result.source, "primary-schema");
  assert.equal(result.children[0]?.role, "planner");
  assert.ok(result.children.some((child) => child.role === "implementer"));
  const planner = result.assignments.find((item) => item.role === "planner");
  const implementer = result.assignments.find((item) => item.role === "implementer");
  assert.equal(planner?.decision.model, "premium");
  assert.equal(implementer?.decision.model, "cheap");
  assert.notEqual(planner?.taskId, implementer?.taskId);
});

test("investigation-only still starts with a primary planner then a scout", async () => {
  const clarified = await clarifyObjective({
    objective: "Investigate the checkout parser",
    projectKey: "proj-invest-split",
    assumeDefaults: true
  });
  const result = splitAndAssignForPrimary({
    contract: clarified.candidate.contract,
    habits: clarified.habits,
    answers: { "q-done": "investigation only" },
    catalog: catalogFromPrimary({ primaryModelId: "premium", fastModelId: "cheap" }),
    generateId: (() => {
      let n = 0;
      return () => `invest${++n}`;
    })()
  });
  assert.deepEqual(
    result.children.map((child) => child.role),
    ["planner", "scout"]
  );
  assert.equal(result.assignments[0]?.decision.model, "premium");
  assert.equal(result.children[1]?.dependsOn[0], result.children[0]?.taskId);
});
