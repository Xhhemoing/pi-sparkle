import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { DomainValidationError } from "../domain/errors.js";
import { authorizeCommand, type CommandPolicy } from "./command-policy.js";
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
}

/**
 * Evidence produced by executing a declared command in the worktree — not a
 * child's self-report. This is the only kind of check that can satisfy
 * independent acceptance.
 */
export interface IndependentCheckRecord {
  readonly kind: "command-check";
  readonly schemaVersion: typeof WORKTREE_FINGERPRINT_SCHEMA;
  readonly cwd: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly exitCode: number;
  readonly stdoutHash: string;
  readonly stderrHash: string;
  readonly revision: string;
  readonly artifactPath?: string;
  readonly artifactHash?: string;
  readonly contentFingerprintBefore: WorktreeFingerprint;
  readonly contentFingerprintAfter: WorktreeFingerprint;
  /** Host manifest used for before/after compatibility (must match accept). */
  readonly snapshotManifest: SnapshotManifest;
  readonly ok: boolean;
}

export function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function sha256File(filePath: string): string | undefined {
  try {
    return createHash("sha256").update(readFileSync(filePath)).digest("hex");
  } catch {
    return undefined;
  }
}

/**
 * Run a declared command inside the worktree and bind exit code, stdout/stderr
 * hashes, cwd, git revision, and g1a-v1 content fingerprints before/after.
 * Does not trust any agent-authored verdict.
 */
export function runIndependentCheck(input: IndependentCheckInput): IndependentCheckRecord {
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
  const result = spawnSync(authorized.executable, [...authorized.args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    timeout: authorized.timeoutMs,
    env: authorized.env,
    maxBuffer: Math.max(authorized.maxStdoutBytes, authorized.maxStderrBytes)
  });

  if (result.error !== undefined && result.status === null && result.signal === null) {
    throw new DomainValidationError(`independent check failed to start: ${result.error.message}`);
  }

  const after = captureWorktreeFingerprint(cwd, manifest);
  const compat = fingerprintsCompatible(before, after, manifest);

  const exitCode = result.status ?? (result.signal !== null ? 128 : 1);
  const stdoutHash = sha256Text(result.stdout ?? "");
  const stderrHash = sha256Text(result.stderr ?? "");
  const revision = readWorktreeRevision(cwd);

  const artifactHash =
    input.artifactPath !== undefined ? sha256File(input.artifactPath) : undefined;

  const ok =
    exitCode === 0 &&
    compat.ok &&
    (input.artifactPath === undefined || artifactHash !== undefined);

  return {
    kind: "command-check",
    schemaVersion: WORKTREE_FINGERPRINT_SCHEMA,
    cwd,
    command: input.command,
    args,
    exitCode,
    stdoutHash,
    stderrHash,
    revision,
    ...(input.artifactPath !== undefined ? { artifactPath: input.artifactPath } : {}),
    ...(artifactHash !== undefined ? { artifactHash } : {}),
    contentFingerprintBefore: before,
    contentFingerprintAfter: after,
    snapshotManifest: manifest,
    ok
  };
}
