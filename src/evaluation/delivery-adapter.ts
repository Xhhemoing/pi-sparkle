import type {
  AdapterContext,
  AdapterDeclaration,
  AdapterEvaluation,
  DeliveryEvidence,
  ProjectAdapter,
} from "./adapters.js";

const DELIVERY_DECLARATION: AdapterDeclaration = {
  supportedCriteria: ["manual-acceptance", "delivery", "rollback"],
  inputContract: "DeliveryEvidence",
  trustClass: "observed",
  timeoutMs: 60000,
  unavailableSemantics: "UNOBSERVED",
  evidenceOwner: "user",
};

export class DeliveryAdapter implements ProjectAdapter {
  readonly declaration = DELIVERY_DECLARATION;

  async evaluate(
    context: AdapterContext,
    input: unknown
  ): Promise<AdapterEvaluation> {
    if (!this.isDeliveryEvidence(input)) {
      return {
        outcome: "UNOBSERVED",
        reason: "no delivery evidence configured",
      };
    }

    const evidence = input;

    if (evidence.rollbackDetected) {
      return {
        outcome: "FAIL",
        evidenceRef: `rollback:${context.revision}`,
        reason: "rollback detected after delivery",
      };
    }

    if (evidence.reopenDetected) {
      return {
        outcome: "FAIL",
        evidenceRef: `reopen:${context.revision}`,
        reason: "episode reopened after closure",
      };
    }

    if (evidence.manualAcceptance === true) {
      return {
        outcome: "PASS",
        evidenceRef: `manual:${context.episodeId}`,
        reason: evidence.userComment ?? "accepted",
      };
    }

    if (evidence.manualAcceptance === false) {
      return {
        outcome: "FAIL",
        evidenceRef: `manual-reject:${context.episodeId}`,
        reason: evidence.userComment ?? "manual rejection",
      };
    }

    return {
      outcome: "UNOBSERVED",
      reason: "manual acceptance not recorded",
    };
  }

  private isDeliveryEvidence(v: unknown): v is DeliveryEvidence {
    if (typeof v !== "object" || v === null) return false;
    const d = v as Record<string, unknown>;
    return (
      d.manualAcceptance === undefined ||
      typeof d.manualAcceptance === "boolean" ||
      typeof d.userComment === "string" ||
      typeof d.rollbackDetected === "boolean" ||
      typeof d.reopenDetected === "boolean"
    );
  }
}

export function createDeliveryAdapter(): ProjectAdapter {
  return new DeliveryAdapter();
}
