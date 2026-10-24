import type {
  AdapterContext,
  AdapterDeclaration,
  AdapterEvaluation,
  DiffScope,
  ProjectAdapter,
} from "./adapters.js";

const DIFF_DECLARATION: AdapterDeclaration = {
  supportedCriteria: ["diff-scope", "change-review"],
  inputContract: "DiffScope",
  trustClass: "deterministic",
  timeoutMs: 30000,
  unavailableSemantics: "UNOBSERVED",
  evidenceOwner: "system",
};

export class DiffAdapter implements ProjectAdapter {
  readonly declaration = DIFF_DECLARATION;

  async evaluate(
    context: AdapterContext,
    input: unknown
  ): Promise<AdapterEvaluation> {
    if (!this.isDiffScope(input)) {
      return {
        outcome: "ABSTAIN",
        reason: "invalid input: expected DiffScope",
      };
    }

    const scope = input;
    const hasUnrelated = scope.unrelatedUser.length > 0;
    const hasUnknown = scope.unknown.length > 0;
    const hasEpisodeOwned = scope.episodeOwned.length > 0;

    if (hasUnrelated || hasUnknown) {
      return {
        outcome: "FAIL",
        evidenceRef: `diff:${context.revision}`,
        reason: hasUnrelated
          ? "unrelated user changes detected"
          : "unknown ownership files detected",
        metadata: {
          episodeOwned: scope.episodeOwned.length,
          unrelated: scope.unrelatedUser.length,
          generated: scope.generated.length,
          unknown: scope.unknown.length,
        },
      };
    }

    if (!hasEpisodeOwned) {
      return {
        outcome: "UNOBSERVED",
        reason: "no episode-owned changes",
      };
    }

    return {
      outcome: "PASS",
      evidenceRef: `diff:${context.revision}`,
      metadata: {
        episodeOwned: scope.episodeOwned.length,
        generated: scope.generated.length,
      },
    };
  }

  private isDiffScope(v: unknown): v is DiffScope {
    if (typeof v !== "object" || v === null) return false;
    const d = v as Record<string, unknown>;
    return (
      Array.isArray(d.episodeOwned) &&
      Array.isArray(d.unrelatedUser) &&
      Array.isArray(d.generated) &&
      Array.isArray(d.unknown)
    );
  }
}

export function createDiffAdapter(): ProjectAdapter {
  return new DiffAdapter();
}
