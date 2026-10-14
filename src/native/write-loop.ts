import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import path from "node:path";
import { DomainValidationError } from "../domain/errors.js";
import type { RunId } from "../domain/ids.js";
import type { IndependentCheckRecord } from "../execution/independent-check.js";
import type { LoopArtifactRef } from "../execution/loop-artifact.js";
import { captureWorktreeFingerprint, fingerprintsCompatible } from "../execution/worktree-snapshot.js";

export interface NativeWriteFeedback {
  readonly runId: RunId;
  readonly artifactId: string;
  readonly exitCode: number;
  readonly stdoutText: string;
  readonly stderrText: string;
  readonly stdoutByteLength: number;
  readonly stderrByteLength: number;
}
export interface NativeWriteAttemptContext {
  readonly number: number;
  readonly maxAttempts: number;
  /** Untrusted command output for repair, never executable authority. */
  readonly previous?: NativeWriteFeedback;
}
export type NativeWriteStopReason = "accepted" | "attempt-limit" | "no-progress" | "cancelled" |
  "time-budget" | "executor-failed" | "verification-unavailable" | "snapshot-unavailable" | "source-changed";
export interface NativeWriteAttemptRecord {
  readonly number: number;
  readonly runId: RunId;
  readonly artifact: LoopArtifactRef;
  readonly accepted: boolean;
  readonly taskContractArtifact?: LoopArtifactRef;
}
export interface NativeWriteLoopResult {
  readonly maxAttempts: number;
  readonly maxWallTimeMs: number;
  readonly attempts: readonly NativeWriteAttemptRecord[];
  readonly stopReason: NativeWriteStopReason;
  readonly artifact: LoopArtifactRef;
}
export interface NativeWriteLoopLimits {
  readonly enabled: boolean;
  readonly maxAttempts: number;
  readonly maxWallTimeMs: number;
}
export function prepareNativeWriteLoopLimits(input: { maxAttempts?: number; maxWallTimeMs?: number }): NativeWriteLoopLimits {
  const maxAttempts = input.maxAttempts ?? 1;
  const maxWallTimeMs = input.maxWallTimeMs ?? Math.min(maxAttempts * 360_000, 1_800_000);
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new DomainValidationError("maxAttempts must be an integer from 1 to 5");
  }
  if (!Number.isSafeInteger(maxWallTimeMs) || maxWallTimeMs < 1 || maxWallTimeMs > 1_800_000) {
    throw new DomainValidationError("maxWallTimeMs must be an integer from 1 to 1800000");
  }
  return Object.freeze({ enabled: input.maxAttempts !== undefined || input.maxWallTimeMs !== undefined, maxAttempts, maxWallTimeMs });
}
export function repairFeedback(check: IndependentCheckRecord, runId: RunId, artifactId: string): NativeWriteFeedback {
  return Object.freeze({ runId, artifactId, exitCode: check.exitCode,
    stdoutText: check.stdoutText.slice(0, 4096), stderrText: check.stderrText.slice(0, 4096),
    stdoutByteLength: check.stdoutByteLength, stderrByteLength: check.stderrByteLength });
}
export function isRepairableCheck(check: IndependentCheckRecord, repairableExitCodes?: readonly number[]): boolean {
  // Legacy records without runner status cannot distinguish spawn failures
  // from exit 1. They never authorize automatic repair.
  return check.processStatus === "completed" && check.processSignal === null &&
    (repairableExitCodes === undefined || repairableExitCodes.includes(check.exitCode)) &&
    (check.trustedVerification === undefined || check.trustedVerification.ok) &&
    Number.isSafeInteger(check.processExitCode) && check.processExitCode === check.exitCode && check.exitCode !== 0 &&
    fingerprintsCompatible(check.contentFingerprintBefore, check.contentFingerprintAfter, check.snapshotManifest).ok;
}

interface ExactFile { readonly path: string; readonly kind: string; readonly mode: number; readonly bytes: Buffer; }
export interface NativeCandidateSnapshot { readonly revision: string; readonly files: readonly ExactFile[]; }
/** Ephemeral exact bytes, never persisted as a new privacy store or hash. */
export function captureNativeCandidate(cwd: string): NativeCandidateSnapshot {
  const fp = captureWorktreeFingerprint(cwd);
  if (fp.entries.length > 256) throw new DomainValidationError("candidate progress snapshot exceeds 256 files");
  let remaining = 4 * 1024 * 1024;
  const files = fp.entries.map((entry): ExactFile => {
    if (entry.kind === "deleted") return { path: entry.path, kind: entry.kind, mode: 0, bytes: Buffer.alloc(0) };
    const absolute = path.resolve(cwd, entry.path);
    if (!absolute.startsWith(`${path.resolve(cwd)}${path.sep}`) || realpathSync(absolute) !== absolute || !lstatSync(absolute).isFile()) {
      throw new DomainValidationError("candidate progress snapshot refuses linked or nonregular paths");
    }
    const fd = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const before = fstatSync(fd);
      if (!before.isFile() || before.size > remaining) throw new DomainValidationError("candidate progress snapshot exceeds 4 MiB");
      const bytes = Buffer.alloc(before.size + 1);
      let read = 0;
      while (read < bytes.length) {
        const n = readSync(fd, bytes, read, bytes.length - read, read);
        if (n === 0) break;
        read += n;
      }
      const after = fstatSync(fd);
      if (read !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
        throw new DomainValidationError("candidate changed during progress snapshot");
      }
      remaining -= read;
      return { path: entry.path, kind: entry.kind, mode: before.mode, bytes: bytes.subarray(0, read) };
    } finally { closeSync(fd); }
  });
  return { revision: fp.headRevision, files };
}
export function sameNativeCandidate(a: NativeCandidateSnapshot, b: NativeCandidateSnapshot): boolean {
  return a.revision === b.revision && a.files.length === b.files.length && a.files.every((file, index) => {
    const next = b.files[index]!;
    return file.path === next.path && file.kind === next.kind && file.mode === next.mode && file.bytes.equals(next.bytes);
  });
}
