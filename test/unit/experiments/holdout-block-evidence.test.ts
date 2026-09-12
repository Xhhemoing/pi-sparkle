import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const moduleUrl = pathToFileURL(
  join(process.cwd(), "scripts/lib/holdout-block-evidence.mjs")
).href;

const { classifyHoldoutBlockEvidenceClass } = await import(moduleUrl);

describe("F6 holdout-block evidenceClass", () => {
  it("marks fake executor as simulation", () => {
    assert.equal(
      classifyHoldoutBlockEvidenceClass({
        executor: "fake",
        results: [
          { invocations: [{ id: "1" }], status: "COMPLETED", runId: "run_a" },
          { invocations: [{ id: "2" }], status: "COMPLETED", runId: "run_b" }
        ]
      }),
      "simulation"
    );
  });

  it("demotes empty arms with UNKNOWN status to harness-failure (config/collector miss)", () => {
    // Heidi / report repro: both arms never started (invocationCount 0, UNKNOWN)
    // must not be production-candidate.
    assert.equal(
      classifyHoldoutBlockEvidenceClass({
        executor: "pi",
        results: [
          { invocations: [], status: "UNKNOWN" },
          { invocations: [], status: "UNKNOWN" }
        ]
      }),
      "harness-failure"
    );
  });

  it("demotes empty arms with missing runId to harness-failure", () => {
    assert.equal(
      classifyHoldoutBlockEvidenceClass({
        executor: "pi",
        results: [
          { invocations: [], status: "FAILED" },
          { invocations: [], status: "FAILED" }
        ]
      }),
      "harness-failure"
    );
  });

  it("keeps production-candidate when arms wrote invocations even if tasks failed", () => {
    assert.equal(
      classifyHoldoutBlockEvidenceClass({
        executor: "pi",
        results: [
          { invocations: [{ id: "inv_1" }], status: "FAILED", runId: "run_a" },
          { invocations: [{ id: "inv_2" }], status: "FAILED", runId: "run_b" }
        ]
      }),
      "production-candidate"
    );
  });

  it("keeps production-candidate for a completed pi block with invocations", () => {
    assert.equal(
      classifyHoldoutBlockEvidenceClass({
        executor: "pi",
        results: [
          { invocations: [{ id: "inv_1" }], status: "COMPLETED", runId: "run_a" },
          { invocations: [{ id: "inv_2" }], status: "COMPLETED", runId: "run_b" }
        ]
      }),
      "production-candidate"
    );
  });

  it("demotes when every arm is empty even if one reports a status string", () => {
    assert.equal(
      classifyHoldoutBlockEvidenceClass({
        executor: "pi",
        results: [
          { invocations: [], status: "UNKNOWN", runId: undefined },
          { invocations: [], status: "UNKNOWN", runId: undefined }
        ]
      }),
      "harness-failure"
    );
  });
});
