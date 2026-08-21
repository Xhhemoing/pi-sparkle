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

    const result = input;
    const metadata = attributionMetadata(result, context);

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

    if (result.revision !== undefined && result.revision !== context.revision) {
      return {
        outcome: "FAIL",
        evidenceRef: `stale:${result.revision}`,
        reason: `stale result for revision ${result.revision}; episode revision is ${context.revision}`,
        metadata,
      };
    }

    if (
      result.changeSet !== undefined &&
      !changeSetsEqual(result.changeSet, context.changeSet)
    ) {
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
    if (typeof v !== "object" || v === null) return false;
    const r = v as Record<string, unknown>;
    if (
      typeof r.exitCode !== "number" ||
      typeof r.stdout !== "string" ||
      typeof r.stderr !== "string" ||
      typeof r.command !== "string" ||
      typeof r.cwd !== "string"
    ) {
      return false;
    }
    if (r.environmentPolicy !== undefined && typeof r.environmentPolicy !== "string") {
      return false;
    }
    if (r.changeSet !== undefined) {
      if (!Array.isArray(r.changeSet) || !r.changeSet.every((p) => typeof p === "string")) {
        return false;
      }
    }
    return true;
  }
}

export function createCheckAdapter(): ProjectAdapter {
  return new CheckAdapter();
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
 * Attribution required on every PASS/FAIL. Missing environmentPolicy is
 * recorded as `"unavailable"` — never invented.
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
    revision: result.revision ?? context.revision,
    changeSet: result.changeSet ?? context.changeSet,
    durationMs: result.durationMs,
  };
}
