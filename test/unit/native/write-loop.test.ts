import assert from "node:assert/strict";
import { test } from "node:test";
import { isRepairableCheck, prepareNativeWriteLoopLimits, repairFeedback } from "../../../src/native/write-loop.js";
import type { IndependentCheckRecord } from "../../../src/execution/independent-check.js";
import type { RunId } from "../../../src/domain/ids.js";

const fingerprint = { schemaVersion: "g1a-v1" as const, headRevision: "base", entries: [], snapshotId: "same", digest: "same" };
const record: IndependentCheckRecord = { kind: "command-check", schemaVersion: "g1a-v1", checkId: "check_v2_test", cwd: "/candidate",
  command: "node", args: [], exitCode: 1, stdoutText: "x".repeat(5000), stderrText: "y".repeat(5000),
  stdoutByteLength: 5000, stderrByteLength: 5000, revision: "base", contentFingerprintBefore: fingerprint,
  contentFingerprintAfter: fingerprint, snapshotManifest: {}, ok: false };

test("legacy or infrastructure check failures never qualify for automatic repair", () => {
  const completed = { ...record, processStatus: "completed" as const, processExitCode: 1, processSignal: null };
  assert.equal(isRepairableCheck(record), false);
  for (const processStatus of ["cancelled", "timed_out", "output_limit", "spawn_error"] as const) {
    assert.equal(isRepairableCheck({ ...record, processStatus }), false);
  }
  assert.equal(isRepairableCheck({ ...record, processStatus: "completed" }), false);
  assert.equal(isRepairableCheck(completed), true);
  assert.equal(isRepairableCheck({ ...completed, exitCode: 0, processExitCode: 0 }), false);
  assert.equal(isRepairableCheck({ ...completed, processSignal: "SIGTERM", processExitCode: null, exitCode: 128 }), false);
  assert.equal(isRepairableCheck({ ...completed, processExitCode: 128, exitCode: 128 }), true);
  assert.equal(isRepairableCheck({ ...completed, contentFingerprintAfter: { ...fingerprint, headRevision: "drift" } }), false);
});
test("repair feedback is bounded, immutable, and contains no verifier authority", () => {
  const feedback = repairFeedback(record, "run_test" as RunId, "art_v2_test");
  assert.equal(feedback.stdoutText.length, 4096); assert.equal(feedback.stderrText.length, 4096);
  assert.equal(feedback.stdoutByteLength, 5000); assert.equal(Object.isFrozen(feedback), true);
  assert.equal("command" in feedback, false); assert.equal("args" in feedback, false);
});
test("implicit defaults remain one attempt while limits are copied and frozen", () => {
  assert.deepEqual(prepareNativeWriteLoopLimits({}), { enabled: false, maxAttempts: 1, maxWallTimeMs: 360000 });
  const input = { maxAttempts: 3, maxWallTimeMs: 2000 };
  const limits = prepareNativeWriteLoopLimits(input); input.maxAttempts = 5;
  assert.equal(limits.maxAttempts, 3); assert.equal(Object.isFrozen(limits), true);
});
