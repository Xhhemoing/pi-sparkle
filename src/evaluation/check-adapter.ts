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

    if (result.cwd !== context.workingDirectory) {
      return {
        outcome: "FAIL",
        evidenceRef: `cwd:${result.cwd}`,
        reason: `command ran outside the episode working directory (${result.cwd})`,
        metadata: {
          command: result.command,
          expectedCwd: context.workingDirectory,
          durationMs: result.durationMs,
        },
      };
    }

    if (result.revision !== undefined && result.revision !== context.revision) {
      return {
        outcome: "FAIL",
        evidenceRef: `stale:${result.revision}`,
        reason: `stale result for revision ${result.revision}; episode revision is ${context.revision}`,
        metadata: {
          command: result.command,
          cwd: result.cwd,
        },
      };
    }

    if (result.exitCode !== 0) {
      return {
        outcome: "FAIL",
        evidenceRef: `exit:${result.exitCode}`,
        reason: result.stderr || "command failed",
        metadata: {
          command: result.command,
          cwd: result.cwd,
          durationMs: result.durationMs,
          artifactHash: hashArtifact(result.stdout, result.stderr),
        },
      };
    }

    return {
      outcome: "PASS",
      evidenceRef: "exit:0",
      metadata: {
        command: result.command,
        cwd: result.cwd,
        durationMs: result.durationMs,
        artifactHash: hashArtifact(result.stdout, result.stderr),
      },
    };
  }

  private isCommandResult(v: unknown): v is CommandResult {
    if (typeof v !== "object" || v === null) return false;
    const r = v as Record<string, unknown>;
    return (
      typeof r.exitCode === "number" &&
      typeof r.stdout === "string" &&
      typeof r.stderr === "string" &&
      typeof r.command === "string" &&
      typeof r.cwd === "string"
    );
  }
}

export function createCheckAdapter(): ProjectAdapter {
  return new CheckAdapter();
}

/** Deterministic artifact fingerprint so a specific stdout/stderr combination is attributable. */
function hashArtifact(stdout: string, stderr: string): string {
  return `hash_${hash32(`${stdout}\u0000${stderr}`)}`;
}
