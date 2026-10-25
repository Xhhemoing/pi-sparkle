import assert from "node:assert/strict";
import { test } from "node:test";
import { projectDevelopmentCheckFeedback, snapshotDevelopmentCheckPlan } from "../../../src/development/check-plan.js";
import type { IndependentCheckRecord } from "../../../src/execution/independent-check.js";

const plan = snapshotDevelopmentCheckPlan({ checks: [
  { id: "visible", command: process.execPath, args: ["-e", "process.exit(0)"], verifierVersion: "v1" },
  { id: "hidden", command: process.execPath, args: ["-e", "process.exit(1)"], verifierVersion: "v1", visibleToWorker: false }
] });
function report() {
  return { schemaVersion: 1, results: [
    { recipeId: "visible", ok: true, status: "completed", exitCode: 0, signal: null,
      stdoutText: "visible output", stderrText: "", stdoutByteLength: 14, stderrByteLength: 0, cleanupUnsettled: false },
    { recipeId: "hidden", ok: false, status: "completed", exitCode: 1, signal: null,
      stdoutText: "HOST_PRIVATE", stderrText: "", stdoutByteLength: 12, stderrByteLength: 0, cleanupUnsettled: false }
  ], unobserved: [] as string[] };
}
// Pure decoder tests supply only its input fields. These synthetic records are
// not issued verification capabilities or production acceptance evidence.
function record(stdoutText: string, overrides: Record<string, unknown> = {}): IndependentCheckRecord {
  return { processStatus: "completed", processSignal: null, processExitCode: 1, exitCode: 1,
    processCleanupUnsettled: false, trustedVerification: { ok: true }, stdoutText,
    stdoutByteLength: Buffer.byteLength(stdoutText), stderrText: "", stderrByteLength: 0, ...overrides } as unknown as IndependentCheckRecord;
}

test("complete structured failure projects only visible results", () => {
  const feedback = projectDevelopmentCheckFeedback(plan, record(JSON.stringify(report())));
  assert.equal(feedback?.outcome, "not-accepted");
  assert.deepEqual(feedback?.checks.map((entry) => entry.id), ["visible"]);
  assert.ok(!JSON.stringify(feedback).includes("HOST_PRIVATE"));
});

for (const invalid of ["malformed JSON", "duplicate result", "unobserved check", "outer truncation", "row truncation", "infrastructure exit", "unsettled cleanup"] as const) {
  test(`structured ${invalid} cannot authorize repair feedback`, () => {
    const value = report();
    if (invalid === "duplicate result") value.results[1]!.recipeId = "visible";
    if (invalid === "unobserved check") value.unobserved.push("hidden");
    if (invalid === "row truncation") value.results[1]!.stdoutByteLength += 100;
    const encoded = JSON.stringify(value);
    const check = record(invalid === "malformed JSON" ? encoded.slice(0, -1) : encoded,
      invalid === "outer truncation" ? { stdoutByteLength: Buffer.byteLength(encoded) + 100 } :
      invalid === "infrastructure exit" ? { processExitCode: 2, exitCode: 2 } :
      invalid === "unsettled cleanup" ? { processCleanupUnsettled: true } : {});
    assert.equal(projectDevelopmentCheckFeedback(plan, check), undefined);
  });
}
