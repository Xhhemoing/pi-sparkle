import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateIndependentAcceptance } from "../../../src/execution/acceptance.js";
import type { IndependentCheckRecord } from "../../../src/execution/independent-check.js";
import {
  WORKTREE_FINGERPRINT_SCHEMA,
  type WorktreeFingerprint
} from "../../../src/execution/worktree-snapshot.js";

function fp(over: Partial<WorktreeFingerprint> = {}): WorktreeFingerprint {
  const snapshotId = over.snapshotId ?? `snap_v2_${"d".repeat(56)}`;
  return {
    schemaVersion: WORKTREE_FINGERPRINT_SCHEMA,
    headRevision: over.headRevision ?? "deadbeef",
    entries: over.entries ?? [],
    snapshotId,
    digest: snapshotId,
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
    checkId: "check_v2_fixture",
    stdoutText: "",
    stderrText: "",
    stdoutByteLength: 0,
    stderrByteLength: 0,
    revision: "deadbeef",
    artifactBytes: 64,
    contentFingerprintBefore: fingerprint,
    contentFingerprintAfter: fingerprint,
    snapshotManifest: {},
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
    artifactId: "a".repeat(64),
    independentCheck: {
      kind: "command-check",
      schemaVersion: WORKTREE_FINGERPRINT_SCHEMA,
      cwd: "/fixture",
      command: "different-check",
      args: [],
      exitCode: 0,
      checkId: "check_v2_fixture",
      stdoutText: "",
      stderrText: "",
      stdoutByteLength: 0,
      stderrByteLength: 0,
      revision: "same-head",
      snapshotManifest: {},
      contentFingerprintBefore: fp({ headRevision: "same-head", snapshotId: `snap_v2_${"e".repeat(56)}` }),
      contentFingerprintAfter: fp({ headRevision: "same-head", snapshotId: `snap_v2_${"e".repeat(56)}` }),
      ok: true
    }
  });
  assert.equal(result.accepted, false);
  assert.match(result.reason, /command\/argv mismatch/);
});

test("G1A: argv mismatch rejects", () => {
  const result = evaluateIndependentAcceptance({
    independentCheck: okCheck({ args: ["-e", "process.exit(0)"] }),
    artifactId: "art_v2_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
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
    artifactId: "art_v2_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    revision: "deadbeef",
    cwd: "/tmp/wt",
    command: "node",
    args: ["-e", "process.exit(0)"]
  });
  assert.equal(result.accepted, false);
  assert.match(result.reason, /schemaVersion|fingerprint/i);
});

test("G1A: fingerprint candidate drift rejects", () => {
  const before = fp({
    snapshotId: `snap_v2_${"1".repeat(56)}`,
    entries: [{ path: "src/a.ts", kind: "modified", byteLength: 1 }]
  });
  const after = fp({
    snapshotId: `snap_v2_${"2".repeat(56)}`,
    entries: [{ path: "src/a.ts", kind: "modified", byteLength: 2 }]
  });
  const result = evaluateIndependentAcceptance({
    independentCheck: okCheck({
      contentFingerprintBefore: before,
      contentFingerprintAfter: after,
      ok: true
    }),
    artifactId: "art_v2_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    revision: "deadbeef",
    cwd: "/tmp/wt",
    command: "node",
    args: ["-e", "process.exit(0)"]
  });
  assert.equal(result.accepted, false);
  assert.match(result.reason, /candidate content changed|fingerprint/i);
});

test("G1A: allowedOutputDirs digest change still accepts when compatible", () => {
  const before = fp({ snapshotId: `snap_v2_${"1".repeat(56)}`, entries: [] });
  const after = fp({
    snapshotId: `snap_v2_${"2".repeat(56)}`,
    entries: [{ path: "out/log.txt", kind: "untracked", byteLength: 3 }]
  });
  const result = evaluateIndependentAcceptance({
    independentCheck: okCheck({
      contentFingerprintBefore: before,
      contentFingerprintAfter: after,
      snapshotManifest: { allowedOutputDirs: ["out"] },
      ok: true
    }),
    artifactId: "art_v2_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    revision: "deadbeef",
    cwd: "/tmp/wt",
    command: "node",
    args: ["-e", "process.exit(0)"]
  });
  assert.equal(result.accepted, true);
});

test("independent check success + artifactId + matching argv/fingerprint accepts", () => {
  const check = okCheck();
  const result = evaluateIndependentAcceptance({
    selfReport: {
      source: "subagent",
      verification: "PASSED",
      evidenceIds: []
    },
    independentCheck: check,
    artifactId: "art_v2_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    revision: "deadbeef",
    cwd: "/tmp/wt",
    command: "node",
    args: ["-e", "process.exit(0)"]
  });
  assert.equal(result.accepted, true);
  assert.equal(result.artifactId, "art_v2_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  assert.equal(result.independentCheck?.exitCode, 0);
});

test("independent check non-zero exit fails acceptance", () => {
  const check = okCheck({ exitCode: 1, ok: false });
  const result = evaluateIndependentAcceptance({
    independentCheck: check,
    artifactId: "art_v2_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    revision: "deadbeef",
    cwd: "/tmp/wt",
    command: "node",
    args: ["-e", "process.exit(0)"]
  });
  assert.equal(result.accepted, false);
  assert.match(result.reason, /independent check failed/);
});

test("missing artifactId fails closed even when check ok", () => {
  const result = evaluateIndependentAcceptance({
    independentCheck: okCheck(),
    revision: "deadbeef",
    cwd: "/tmp/wt",
    command: "node",
    args: ["-e", "process.exit(0)"]
  });
  assert.equal(result.accepted, false);
  assert.match(result.reason, /artifactId/);
});

test("cwd/revision mismatch with check fails closed", () => {
  const result = evaluateIndependentAcceptance({
    independentCheck: okCheck(),
    artifactId: "art_v2_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    revision: "other",
    cwd: "/tmp/wt",
    command: "node",
    args: ["-e", "process.exit(0)"]
  });
  assert.equal(result.accepted, false);
  assert.match(result.reason, /mismatch/);
});
