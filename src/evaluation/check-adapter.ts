import type {
  AdapterContext,
  AdapterDeclaration,
  AdapterEvaluation,
  CommandResult,
  ProjectAdapter,
} from "./adapters.js";
import { hash32 } from "../domain/hash.js";

const CHECK_DECLARATION: AdapterDeclaration = {
  supportedCriteria: ["typecheck", "lint", "build", "test"],
  inputContract: "CommandResult",
  trustClass: "deterministic",
  timeoutMs: 300000,
  unavailableSemantics: "UNOBSERVED",
  evidenceOwner: "system",
};

export class CheckAdapter implements ProjectAdapter {
  readonly declaration = CHECK_DECLARATION;

  async evaluate(
    context: AdapterContext,
    input: unknown
  ): Promise<AdapterEvaluation> {
    if (!this.isCommandResult(input)) {
      return {
        outcome: "ABSTAIN",
        reason: "invalid input: expected CommandResult",
      };
    }

    if (!hasContextBinding(context)) {
      return {
        outcome: "UNOBSERVED",
        reason: "invalid context: expected working directory, revision and change set",
      };
    }

    const result = input;
    const metadata = attributionMetadata(result, context);
    if (result.revision === undefined || result.changeSet === undefined) {
      const missing = [
        ...(result.revision === undefined ? ["revision"] : []),
        ...(result.changeSet === undefined ? ["change set"] : []),
      ];
      return {
        outcome: "UNOBSERVED",
        reason: `command evidence missing recorded ${missing.join(" and ")}; rerun with explicit attribution`,
        metadata,
      };
    }

    if (result.cwd !== context.workingDirectory) {
      return {
        outcome: "FAIL",
        evidenceRef: `cwd:${result.cwd}`,
        reason: `command ran outside the episode working directory (${result.cwd})`,
        metadata: {
          ...metadata,
          expectedCwd: context.workingDirectory,
        },
      };
    }

    if (result.revision !== context.revision) {
      return {
        outcome: "FAIL",
        evidenceRef: `stale:${result.revision}`,
        reason: `stale result for revision ${result.revision}; episode revision is ${context.revision}`,
        metadata,
      };
    }

    if (!changeSetsEqual(result.changeSet, context.changeSet)) {
      return {
        outcome: "FAIL",
        evidenceRef: `stale-changeset:${result.changeSet.join(",")}`,
        reason: `stale result for change set; episode change set does not match`,
        metadata,
      };
    }

    if (result.exitCode !== 0) {
      return {
        outcome: "FAIL",
        evidenceRef: `exit:${result.exitCode}`,
        reason: result.stderr || "command failed",
        metadata,
      };
    }

    return {
      outcome: "PASS",
      evidenceRef: "exit:0",
      metadata,
    };
  }

  private isCommandResult(v: unknown): v is CommandResult {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
    const r = v as Record<string, unknown>;
    if (
      !Number.isSafeInteger(r.exitCode) ||
      typeof r.stdout !== "string" ||
      typeof r.stderr !== "string" ||
      typeof r.durationMs !== "number" || !Number.isFinite(r.durationMs) || r.durationMs < 0 ||
      !isNonBlank(r.command) ||
      !isNonBlank(r.cwd)
    ) {
      return false;
    }
    if (r.environmentPolicy !== undefined && typeof r.environmentPolicy !== "string") {
      return false;
    }
    if (r.revision !== undefined && !isNonBlank(r.revision)) return false;
    if (r.changeSet !== undefined && !isChangeSet(r.changeSet)) return false;
    return true;
  }
}

export function createCheckAdapter(): ProjectAdapter {
  return new CheckAdapter();
}

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isChangeSet(value: unknown): value is readonly string[] {
  // Array.from also exposes sparse entries instead of silently skipping them.
  return Array.isArray(value) && Array.from(value).every(isNonBlank);
}

function hasContextBinding(context: AdapterContext): boolean {
  return typeof context === "object" && context !== null && !Array.isArray(context) &&
    isNonBlank(context.workingDirectory) && isNonBlank(context.revision) &&
    isChangeSet(context.changeSet);
}

/** Deterministic artifact fingerprint so a specific stdout/stderr combination is attributable. */
function hashArtifact(stdout: string, stderr: string): string {
  return `hash_${hash32(`${stdout}\u0000${stderr}`)}`;
}

function changeSetsEqual(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const item of left) {
    if (!right.has(item)) return false;
  }
  return true;
}

/**
 * Keep actual attribution separate from expected context. Missing provenance
 * remains unavailable, and arrays are copied so later caller edits cannot
 * rewrite this assessment. The fingerprint is not a cryptographic guarantee.
 */
function attributionMetadata(
  result: CommandResult,
  context: AdapterContext
): Record<string, unknown> {
  return {
    command: result.command,
    exitCode: result.exitCode,
    artifactHash: hashArtifact(result.stdout, result.stderr),
    cwd: result.cwd,
    workingDirectory: context.workingDirectory,
    environmentPolicy: result.environmentPolicy ?? "unavailable",
    revision: result.revision ?? "unavailable",
    changeSet: result.changeSet === undefined ? null : [...result.changeSet],
    expectedRevision: context.revision,
    expectedChangeSet: [...context.changeSet],
    durationMs: result.durationMs,
  };
}
