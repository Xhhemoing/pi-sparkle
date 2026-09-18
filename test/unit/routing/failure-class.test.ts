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

test("429 and transport errors are provider, even if the agent tagged MODEL_ERROR", () => {
  assert.equal(
    classifyTaskFailure({
      outcome: "FAILURE",
      verificationKind: "FAILED",
      httpStatus: 429,
      summary: "provider said no"
    }),
    "provider"
  );
  assert.equal(
    classifyTaskFailure({
      outcome: "FAILURE",
      verificationKind: "FAILED",
      transportCode: "ECONNRESET"
    }),
    "provider"
  );
  assert.equal(
    classifyTaskFailure({
      outcome: "FAILURE",
      verificationKind: "FAILED",
      failure: { category: "MODEL_ERROR" },
      summary: "upstream 429 rate limited"
    }),
    "provider"
  );
});

test("maps protocol PROVIDER_ERROR to provider", () => {
  assert.equal(
    classifyTaskFailure({
      outcome: "FAILURE",
      verificationKind: "UNOBSERVED",
      failure: { category: "PROVIDER_ERROR", detail: "provider rate-limit status=429: slow down" }
    }),
    "provider"
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

test("FAILED with empty evidenceIds and a provider hint is provider, not model", () => {
  // Reconciled 2026-09-17 with main's enhanced classifier (ed9a6e9): a 429
  // summary matches PROVIDER_HINT and classifies as "provider" — more precise
  // than the original hotfix's "environment". Both keep the failure out of
  // the model posterior; the assertion's purpose (never model) is unchanged.
  assert.equal(
    classifyTaskFailure({
      outcome: "FAILURE",
      verificationKind: "FAILED",
      summary: "pi agent failed: 429 Too Many Requests",
      evidenceIds: []
    }),
    "provider"
  );
});

test("FAILED with cited evidence still defaults to model when unlabeled", () => {
  assert.equal(
    classifyTaskFailure({
      outcome: "FAILURE",
      verificationKind: "FAILED",
      summary: "output did not match the golden fixture",
      evidenceIds: ["evd_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]
    }),
    "model"
  );
});
