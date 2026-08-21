import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractHeuristicContract,
  isVague,
  namedTargets
} from "../../../src/requirement/heuristic.js";

test("isVague is true for underspecified vibe-coding prompts", () => {
  assert.equal(isVague("do it"), true);
  assert.equal(isVague("make it better"), true);
  assert.equal(isVague("Implement the checkout parser and add tests"), false);
});

test("namedTargets extracts workspace paths from the objective", () => {
  assert.deepEqual(namedTargets("Fix src/pay/parser.ts"), ["src/pay/parser.ts"]);
  assert.deepEqual(namedTargets("Rename helper.ts and update README.md"), ["helper.ts", "README.md"]);
  assert.deepEqual(namedTargets("Implement the checkout parser"), []);
});

test("an implement contract adds a smallest-change constraint and non-goals", async () => {
  const candidate = await extractHeuristicContract({
    objective: "Implement the checkout parser and add tests"
  });
  assert.ok(candidate.contract.constraints.some((constraint) => constraint.id === "c-smallest"));
  assert.ok(candidate.contract.nonGoals.length > 0);
  assert.equal(candidate.contract.questions.some((question) => question.id === "q-scope"), false);
});

test("a tiny edit with no file path asks which files to touch", async () => {
  const candidate = await extractHeuristicContract({
    objective: "one-line rename of the helper"
  });
  assert.ok(candidate.contract.questions.some((question) => question.id === "q-scope"));
});
