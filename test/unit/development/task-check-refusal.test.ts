import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyTaskCheckRefusal } from "../../../src/development/task-check-refusal.js";
import type { DevelopmentTaskSpec } from "../../../src/development/task-spec.js";
import type { AuthorizedCommandRunResult } from "../../../src/execution/command-runner.js";

const check: DevelopmentTaskSpec["checks"][number] = { id: "typescript-typecheck", command: process.execPath,
  args: ["typecheck/check.mjs"], verifierVersion: "example-typescript-v1", protectedPaths: ["typecheck"], expect: { baseline: "pass" } };
function result(code = "TS_CONFIG_MISSING", overrides: Partial<AuthorizedCommandRunResult> = {}): AuthorizedCommandRunResult {
  const stdoutText = JSON.stringify({ protocol: "sparkle-example-typescript-check-v1", code });
  const stderrText = "PRIVATE_PATH_AND_SECRET";
  return { status: "completed", spawned: true, ok: false, exitCode: 2, signal: null, stdoutText, stderrText,
    stdoutByteLength: Buffer.byteLength(stdoutText), stderrByteLength: Buffer.byteLength(stderrText), ...overrides };
}
test("known TypeScript refusals contain only static guidance, never checker output", () => {
  for (const [code, exitCode, category] of [["TS_COMPILER_MISSING", 2, "infrastructure"], ["TS_CONFIG_MISSING", 2, "infrastructure"], ["TS_UNDECLARED_RED", 1, "undeclared-red"]] as const) {
    const refusal = classifyTaskCheckRefusal(check, result(code, { exitCode }));
    assert.equal(refusal?.code, code); assert.equal(refusal?.category, category);
    assert.equal(JSON.stringify(refusal).includes("PRIVATE_PATH_AND_SECRET"), false);
  }
});
test("TypeScript guidance cannot classify success, incomplete effects, partial output or unknown failure", () => {
  for (const overrides of [{ exitCode: 0, ok: true }, { exitCode: 1 }, { exitCode: null }, { status: "timed_out" },
    { status: "spawn_error", spawned: false }, { signal: "SIGTERM" }, { cleanupUnsettled: true }, { stdoutByteLength: 10000 },
    { stderrByteLength: 10000 }] as const) assert.equal(classifyTaskCheckRefusal(check, result("TS_CONFIG_MISSING", overrides)), undefined);
  assert.equal(classifyTaskCheckRefusal(check, result("UNKNOWN")), undefined);
  assert.equal(classifyTaskCheckRefusal({ ...check, verifierVersion: "other" }, result()), undefined);
  assert.equal(classifyTaskCheckRefusal({ ...check, protectedPaths: [] }, result()), undefined);
  for (const stdoutText of ['{"protocol":"sparkle-example-typescript-check-v1","code":"TS_CONFIG_MISSING","next":"PRIVATE"}',
    '{"assertion":"typecheck","outcome":"failed"}', 'not json']) {
    assert.equal(classifyTaskCheckRefusal(check, result("TS_CONFIG_MISSING", { stdoutText, stdoutByteLength: Buffer.byteLength(stdoutText) })), undefined);
  }
});
