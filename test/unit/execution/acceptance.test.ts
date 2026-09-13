import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateIndependentAcceptance } from "../../../src/execution/acceptance.js";
import type { IndependentCheckRecord } from "../../../src/execution/independent-check.js";
import {
  WORKTREE_FINGERPRINT_SCHEMA,
  type WorktreeFingerprint
} from "../../../src/execution/worktree-snapshot.js";

function fp(over: Partial<WorktreeFingerprint> = {}): WorktreeFingerprint {
  const digest = over.digest ?? "d".repeat(64);
  return {
    schemaVersion: WORKTREE_FINGERPRINT_SCHEMA,
    headRevision: over.headRevision ?? "deadbeef",
    entries: over.entries ?? [],
    digest,
    ...over
  };
}

function okCheck(over: Partial<IndependentCheckRecord> = {}): IndependentCheckRecord {
  const fingerprint = fp({ headRevision: "deadbeef" });
  return {
    kind: "command-check",
    schemaVersion: WORKTREE_FINGERPRINT_SCHEMA,
    cwd: "/tmp/wt",
    command: "node",
    args: ["-e", "process.exit(0)"],
    exitCode: 0,
    stdoutHash: "a".repeat(64),
    stderrHash: "b".repeat(64),
    revision: "deadbeef",
    artifactHash: "c".repeat(64),
    contentFingerprintBefore: fingerprint,
    contentFingerprintAfter: fingerprint,
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

test("G1A: different command than host binding rejects (plan RED fixture)", () => {
  const result = evaluateIndependentAcceptance({
    revision: "same-head",
    cwd: "/fixture",
    command: "required-check",
    artifactHash: "a".repeat(64),
    independentCheck: {
      kind: "command-check",
      schemaVersion: WORKTREE_FINGERPRINT_SCHEMA,
      cwd: "/fixture",
      command: "different-check",
      args: [],
      exitCode: 0,
      stdoutHash: "b".repeat(64),
      stderrHash: "c".repeat(64),
      revision: "same-head",
      contentFingerprintBefore: fp({ headRevision: "same-head", digest: "e".repeat(64) }),
      contentFingerprintAfter: fp({ headRevision: "same-head", digest: "e".repeat(64) }),
      ok: true
    }
  });
  assert.equal(result.accepted, false);
  assert.match(result.reason, /command\/argv mismatch/);
});

test("G1A: argv mismatch rejects", () => {
  const result = evaluateIndependentAcceptance({
    independentCheck: okCheck({ args: ["-e", "process.exit(0)"] }),
    artifactHash: "c".repeat(64),
    revision: "deadbeef",
    cwd: "/tmp/wt",
    command: "node",
    args: ["-e", "process.exit(1)"]
  });
  assert.equal(result.accepted, false);
  assert.match(result.reason, /command\/argv mismatch/);
});

test("G1A: missing schemaVersion / fingerprints rejects (legacy not upgraded)", () => {
  const legacy = okCheck();
  const stripped = { ...legacy } as IndependentCheckRecord & {
    schemaVersion?: string;
    contentFingerprintBefore?: WorktreeFingerprint;
  };
  // simulate pre-g1a record shape for acceptance input
  const result = evaluateIndependentAcceptance({
    independentCheck: {
      ...stripped,
      schemaVersion: "legacy" as typeof WORKTREE_FINGERPRINT_SCHEMA
    },
    artifactHash: "c".repeat(64),
    revision: "deadbeef",
    cwd: "/tmp/wt",
    command: "node",
    args: ["-e", "process.exit(0)"]
  });
  assert.equal(result.accepted, false);
  assert.match(result.reason, /schemaVersion|fingerprint/i);
});

test("G1A: fingerprint digest drift rejects", () => {
  const before = fp({ digest: "1".repeat(64) });
  const after = fp({ digest: "2".repeat(64) });
  const result = evaluateIndependentAcceptance({
    independentCheck: okCheck({
      contentFingerprintBefore: before,
      contentFingerprintAfter: after,
      ok: true
    }),
    artifactHash: "c".repeat(64),
    revision: "deadbeef",
    cwd: "/tmp/wt",
    command: "node",
    args: ["-e", "process.exit(0)"]
  });
  assert.equal(result.accepted, false);
  assert.match(result.reason, /fingerprint changed/);
});

test("independent check success + artifactHash + matching argv/fingerprint accepts", () => {
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
    command: "node",
    args: ["-e", "process.exit(0)"]
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
    command: "node",
    args: ["-e", "process.exit(0)"]
  });
  assert.equal(result.accepted, false);
  assert.match(result.reason, /independent check failed/);
});

test("missing artifactHash fails closed even when check ok", () => {
  const result = evaluateIndependentAcceptance({
    independentCheck: okCheck(),
    revision: "deadbeef",
    cwd: "/tmp/wt",
    command: "node",
    args: ["-e", "process.exit(0)"]
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
    command: "node",
    args: ["-e", "process.exit(0)"]
  });
  assert.equal(result.accepted, false);
  assert.match(result.reason, /mismatch/);
});
