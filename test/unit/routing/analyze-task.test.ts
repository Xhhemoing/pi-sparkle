import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeTask } from "../../../src/routing/analyze-task.js";

test("scout and tester stay low complexity; planner prefers the primary model", () => {
  const scout = analyzeTask("Survey the payment module", "scout");
  assert.equal(scout.complexity, "LOW");
  assert.equal(scout.family, "research");
  assert.equal(scout.preferPrimary, false);

  const planner = analyzeTask("Plan the checkout migration", "planner");
  assert.equal(planner.preferPrimary, true);
  assert.equal(planner.family, "plan");

  const tester = analyzeTask("Run the unit tests", "tester");
  assert.equal(tester.complexity, "LOW");
  assert.equal(tester.family, "test");
});

test("high-risk analysis does not add high-risk to requiredCapabilities", () => {
  const analysis = analyzeTask("Deploy payment credentials to production", "implementer");
  assert.equal(analysis.highRisk, true);
  assert.deepEqual([...analysis.requiredCapabilities], ["tool-use"]);
  assert.ok(!analysis.requiredCapabilities.includes("high-risk"));
});

test("mentioning delete or auth in a document objective is not high-risk", () => {
  const docs = analyzeTask("Document how to delete a cache key and describe auth headers", "implementer");
  assert.equal(docs.highRisk, false);
  assert.equal(docs.family, "edit");
});

test("screenshot work requires vision; docker image does not", () => {
  const vision = analyzeTask("Look at this screenshot and fix the button spacing", "implementer");
  assert.ok(vision.requiredCapabilities.includes("vision"));
  const docker = analyzeTask("Build the docker image for the worker service", "implementer");
  assert.ok(!docker.requiredCapabilities.includes("vision"));
  assert.deepEqual([...docker.requiredCapabilities], ["tool-use"]);
});

test("local-only wording raises a local privacy requirement", () => {
  const local = analyzeTask("Refactor the billing module; this must stay local", "implementer");
  assert.equal(local.privacyRequired, "local");
  const ordinary = analyzeTask("Refactor the billing module", "implementer");
  assert.equal(ordinary.privacyRequired, "cloud-general");
});
