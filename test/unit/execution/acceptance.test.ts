import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateIndependentAcceptance } from "../../../src/execution/acceptance.js";
import type { IndependentCheckRecord } from "../../../src/execution/independent-check.js";

function okCheck(over: Partial<IndependentCheckRecord> = {}): IndependentCheckRecord {
  return {
    kind: "command-check",
    cwd: "/tmp/wt",
    command: "node",
    args: ["-e", "process.exit(0)"],
    exitCode: 0,
    stdoutHash: "a".repeat(64),
    stderrHash: "b".repeat(64),
    revision: "deadbeef",
    artifactHash: "c".repeat(64),
    ok: true,
    ...over
  };
}

test("self-report PASSED with empty evidenceIds alone is not independent acceptance", () => {
  const result = evaluateIndependentAcceptance({
    selfReport: {
      source: "subagent",
      verification: "PASSED",
      evidenceIds: [],
      summary: "looks good"
    },
    revision: "deadbeef",
    cwd: "/tmp/wt",
    command: "node"
  });
  assert.equal(result.accepted, false);
  assert.match(result.reason, /self-report alone|independentCheck required/);
});

test("independent check success + artifactHash accepts", () => {
  const check = okCheck();
  const result = evaluateIndependentAcceptance({
    selfReport: {
      source: "subagent",
      verification: "PASSED",
      evidenceIds: []
    },
    independentCheck: check,
    artifactHash: "c".repeat(64),
    revision: "deadbeef",
    cwd: "/tmp/wt",
    command: "node"
  });
  assert.equal(result.accepted, true);
  assert.equal(result.artifactHash, "c".repeat(64));
  assert.equal(result.independentCheck?.exitCode, 0);
});

test("independent check non-zero exit fails acceptance", () => {
  const check = okCheck({ exitCode: 1, ok: false });
  const result = evaluateIndependentAcceptance({
    independentCheck: check,
    artifactHash: "c".repeat(64),
    revision: "deadbeef",
    cwd: "/tmp/wt",
    command: "node"
  });
  assert.equal(result.accepted, false);
  assert.match(result.reason, /independent check failed/);
});

test("missing artifactHash fails closed even when check ok", () => {
  const result = evaluateIndependentAcceptance({
    independentCheck: okCheck(),
    revision: "deadbeef",
    cwd: "/tmp/wt",
    command: "node"
  });
  assert.equal(result.accepted, false);
  assert.match(result.reason, /artifactHash/);
});

test("cwd/revision mismatch with check fails closed", () => {
  const result = evaluateIndependentAcceptance({
    independentCheck: okCheck(),
    artifactHash: "c".repeat(64),
    revision: "other",
    cwd: "/tmp/wt",
    command: "node"
  });
  assert.equal(result.accepted, false);
  assert.match(result.reason, /mismatch/);
});
