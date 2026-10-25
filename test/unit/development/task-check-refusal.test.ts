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

const rustCheck: DevelopmentTaskSpec["checks"][number] = { id: "rust-tests", command: process.execPath,
  args: ["-e", "host-authored Cargo wrapper"], verifierVersion: "explicit-rust-refusal-v1", protectedPaths: ["Cargo.toml", "Cargo.lock"], expect: { baseline: "pass" } };
const rustDiagnostics = [
  ["RUST_TOOLCHAIN_UNAVAILABLE", "error: rustup could not choose a version of cargo to run, because one wasn't specified explicitly, and no default is configured.\nhelp: run 'rustup default stable' to download the latest stable release of Rust and set it as your default toolchain.\n"],
  ["RUST_OFFLINE_DEPENDENCY_MISSING", "error: no matching package named `PRIVATE_PACKAGE` found\nlocation searched: crates.io index\nrequired by package `fixture v0.1.0 (C:/PRIVATE_HOME)`\nnote: offline mode (via `--offline`) can sometimes cause surprising resolution failures\n"]
] as const;
function rustResult(stderrText: string, overrides: Partial<AuthorizedCommandRunResult> = {}): AuthorizedCommandRunResult {
  return result("unused", { stdoutText: "", stdoutByteLength: 0, stderrText, stderrByteLength: Buffer.byteLength(stderrText), exitCode: 101, ...overrides });
}
test("Rust refusal recognizes only complete observed diagnostic combinations and returns static preparation advice", () => {
  for (const [code, stderrText] of rustDiagnostics) {
    const refusal = classifyTaskCheckRefusal(rustCheck, rustResult(stderrText, { exitCode: code === "RUST_TOOLCHAIN_UNAVAILABLE" ? 1 : 101 }));
    assert.equal(refusal?.code, code); assert.equal(refusal?.category, "infrastructure");
    for (const value of ["PRIVATE_PACKAGE", "PRIVATE_HOME", "rustup default stable"]) assert.equal(JSON.stringify(refusal).includes(value), false);
  }
});
test("Rust hints do not reinterpret success, unknown compilation failure or unsettled/truncated output", () => {
  for (const [code, stderrText] of rustDiagnostics) {
    for (const overrides of [{ exitCode: 0, ok: true }, { status: "timed_out" }, { status: "cancelled" }, { status: "spawn_error", spawned: false },
      { signal: "SIGTERM" }, { cleanupUnsettled: true }, { stderrByteLength: 10000 }] as const) {
      assert.equal(classifyTaskCheckRefusal(rustCheck, rustResult(stderrText, overrides)), undefined);
    }
    assert.equal(classifyTaskCheckRefusal({ ...rustCheck, protectedPaths: ["test"] }, rustResult(stderrText)), undefined);
    assert.equal(classifyTaskCheckRefusal(rustCheck, rustResult(stderrText, { exitCode: code === "RUST_TOOLCHAIN_UNAVAILABLE" ? 101 : 1 })), undefined);
  }
  for (const stderrText of ["error[E0308]: mismatched types", "toolchain offline", "error: no matching package named `secret` found\nlocation searched: crates.io index\n",
    "note: offline mode (via `--offline`) can sometimes cause surprising resolution failures\n"]) {
    assert.equal(classifyTaskCheckRefusal(rustCheck, rustResult(stderrText)), undefined);
  }
});
