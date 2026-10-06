import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import path from "node:path";
import { DomainValidationError } from "../domain/errors.js";
import { authorizeCommand, type CommandPolicy } from "./command-policy.js";
import { runAuthorizedCommand } from "./command-runner.js";
import { readWorktreeRevision } from "./worktree.js";
import {
  WORKTREE_FINGERPRINT_SCHEMA,
  captureWorktreeFingerprint,
  fingerprintsCompatible,
  type SnapshotManifest,
  type WorktreeFingerprint
} from "./worktree-snapshot.js";

export interface IndependentCheckInput {
  /** Worktree cwd the command must run inside. */
  readonly cwd: string;
  /** Shell-less argv[0]. */
  readonly command: string;
  /** Remaining argv. */
  readonly args?: readonly string[];
  /** Optional absolute path of an artifact already bound to this check. */
  readonly artifactPath?: string;
  /** Max wall time in ms (default 60s). */
  readonly timeoutMs?: number;
  /** Host-fixed snapshot scope (model cannot override after the fact). */
  readonly snapshotManifest?: SnapshotManifest;
  /**
   * Optional host command policy (shared with sparkle_run_command). When
   * omitted, the host-supplied command/args are treated as an allow rule with
   * empty env allowlist — host API reuse, not model default-deny.
   */
  readonly commandPolicy?: CommandPolicy;
  readonly signal?: AbortSignal;
}

/**
 * Evidence produced by executing a declared command in the worktree — not a
 * child's self-report. Stream text is bounded storage, not a digest. This is
 * not cryptographic verification.
 */
export interface IndependentCheckRecord {
  readonly kind: "command-check";
  readonly schemaVersion: typeof WORKTREE_FINGERPRINT_SCHEMA;
  /** Opaque check id. Not an integrity digest. */
  readonly checkId: string;
  readonly cwd: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly exitCode: number;
  readonly stdoutText: string;
  readonly stderrText: string;
  readonly stdoutByteLength: number;
  readonly stderrByteLength: number;
  readonly revision: string;
  readonly artifactPath?: string;
  /**
   * Byte length of a readable artifact path, decimal string. Kept under the
   * historical name so acceptance.ts still compiles. Not an integrity digest.
   */
  readonly artifactBytes?: number;
  readonly contentFingerprintBefore: WorktreeFingerprint;
  readonly contentFingerprintAfter: WorktreeFingerprint;
  /** Host manifest used for before/after compatibility (must match accept). */
  readonly snapshotManifest: SnapshotManifest;
  readonly ok: boolean;
}

const STORED_STREAM_MAX_BYTES = 4096;

function boundedText(text: string): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.byteLength <= STORED_STREAM_MAX_BYTES) return text;
  return bytes.subarray(0, STORED_STREAM_MAX_BYTES).toString("utf8");
}

function artifactByteLength(filePath: string): number | undefined {
  try {
    const st = statSync(filePath);
    if (!st.isFile()) return undefined;
    return st.size;
  } catch {
    return undefined;
  }
}

/**
 * Run a declared command inside the worktree and bind exit code, bounded
 * stdout/stderr text, byte lengths, cwd, git revision, and g1a-v1 content
 * fingerprints before/after. Does not hash output and does not trust any
 * agent-authored verdict.
 */
export async function runIndependentCheck(input: IndependentCheckInput): Promise<IndependentCheckRecord> {
  const cwd = path.resolve(input.cwd);
  if (input.command.trim() === "") {
    throw new DomainValidationError("independent check command must be non-empty");
  }

  const manifest = input.snapshotManifest ?? {};
  const before = captureWorktreeFingerprint(cwd, manifest);

  const args = input.args ?? [];
  const policy: CommandPolicy =
    input.commandPolicy ??
    ({
      allow: [{ executable: input.command, maxArgs: 256 }],
      envAllowlist: [],
      timeoutMs: input.timeoutMs ?? 60_000
    } satisfies CommandPolicy);
  const authorized = authorizeCommand(policy, input.command, args);
  const result = await runAuthorizedCommand({
    executable: authorized.executable,
    args: authorized.args,
    cwd,
    env: authorized.env,
    timeoutMs: authorized.timeoutMs,
    maxStdoutBytes: authorized.maxStdoutBytes,
    maxStderrBytes: authorized.maxStderrBytes,
    ...(input.signal === undefined ? {} : { signal: input.signal })
  });

  const after = captureWorktreeFingerprint(cwd, manifest);
  const compat = fingerprintsCompatible(before, after, manifest);

  const exitCode = result.exitCode ?? (result.signal !== null ? 128 : 1);
  const stdout = result.stdoutText;
  const stderr = result.stderrText;
  const stdoutByteLength = result.stdoutByteLength;
  const stderrByteLength = result.stderrByteLength;
  const stdoutOver = result.status === "output_limit" && stdoutByteLength > authorized.maxStdoutBytes;
  const stderrOver = result.status === "output_limit" && stderrByteLength > authorized.maxStderrBytes;
  const revision = readWorktreeRevision(cwd);

  const storedArtifactByteLength =
    input.artifactPath !== undefined ? artifactByteLength(input.artifactPath) : undefined;

  const ok =
    result.status === "completed" &&
    exitCode === 0 &&
    compat.ok &&
    !stdoutOver &&
    !stderrOver &&
    (input.artifactPath === undefined || storedArtifactByteLength !== undefined);

  return {
    kind: "command-check",
    schemaVersion: WORKTREE_FINGERPRINT_SCHEMA,
    checkId: `check_v2_${randomUUID()}`,
    cwd,
    command: input.command,
    args,
    exitCode,
    stdoutText: boundedText(stdout),
    stderrText: boundedText(stderr),
    stdoutByteLength,
    stderrByteLength,
    revision,
    ...(input.artifactPath !== undefined ? { artifactPath: input.artifactPath } : {}),
    ...(storedArtifactByteLength !== undefined ? { artifactBytes: storedArtifactByteLength } : {}),
    contentFingerprintBefore: before,
    contentFingerprintAfter: after,
    snapshotManifest: manifest,
    ok
  };
}
