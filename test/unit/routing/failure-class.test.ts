import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyTaskFailure } from "../../../src/routing/failure-class.js";

test("maps protocol MODEL_ERROR to model", () => {
  assert.equal(
    classifyTaskFailure({
      outcome: "FAILURE",
      verificationKind: "FAILED",
      failure: { category: "MODEL_ERROR" }
    }),
    "model"
  );
});

test("maps TOOL_ERROR to tool", () => {
  assert.equal(
    classifyTaskFailure({
      outcome: "FAILURE",
      verificationKind: "FAILED",
      failure: { category: "TOOL_ERROR", detail: "crashed" }
    }),
    "tool"
  );
});

test("maps TIMEOUT category and timedOut flag to run", () => {
  assert.equal(
    classifyTaskFailure({
      outcome: "FAILURE",
      verificationKind: "FAILED",
      failure: { category: "TIMEOUT" }
    }),
    "run"
  );
  assert.equal(classifyTaskFailure({ timedOut: true }), "run");
});

test("maps VALIDATION and planning-omission summaries to contract", () => {
  assert.equal(
    classifyTaskFailure({
      outcome: "FAILURE",
      verificationKind: "FAILED",
      failure: { category: "VALIDATION" }
    }),
    "contract"
  );
  assert.equal(
    classifyTaskFailure({
      outcome: "FAILURE",
      verificationKind: "FAILED",
      summary: "Acceptance criterion ac-1 was never specified in the contract"
    }),
    "contract"
  );
});

test("maps permission and sandbox summaries to environment", () => {
  assert.equal(
    classifyTaskFailure({
      outcome: "FAILURE",
      verificationKind: "FAILED",
      summary: "EACCES: permission denied writing /etc/hosts"
    }),
    "environment"
  );
});

test("unlabeled deterministic FAILED defaults to model", () => {
  assert.equal(
    classifyTaskFailure({
      outcome: "FAILURE",
      verificationKind: "FAILED",
      summary: "output did not match the golden fixture"
    }),
    "model"
  );
});

test("PASSED verification is not a failure class", () => {
  assert.equal(
    classifyTaskFailure({
      outcome: "SUCCESS",
      verificationKind: "PASSED"
    }),
    undefined
  );
});
