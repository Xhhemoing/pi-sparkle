import type { CascadeEvidence } from "./cascade-evidence.js";
import { resolveEvidenceCascade } from "./cascade-evidence.js";
import type { FailureClass } from "./outcomes.js";

export interface LiveCascadeTier {
  readonly modelId: string;
  readonly version: string;
}

export interface LiveCascadePlan {
  readonly highRisk: boolean;
  readonly tiers: readonly LiveCascadeTier[];
}

export interface LiveCascadeDecision {
  readonly action: "retain" | "escalate" | "abstain";
  readonly reason: string;
  readonly nextModelId: string;
  readonly nextVersion?: string | undefined;
}

export function liveCascadePlanFromAssignment(
  assignment: {
    readonly analysis: { readonly highRisk: boolean };
    readonly decision: { readonly eligibleModels: readonly string[] };
  },
  catalog: {
    readonly models: readonly {
      readonly id: string;
      readonly version?: string;
      readonly estimatedCostUsd: number;
    }[];
  }
): LiveCascadePlan {
  return {
    highRisk: assignment.analysis.highRisk,
    tiers: cheapFirstTiers(assignment.decision.eligibleModels, catalog.models)
  };
}

export function cheapFirstTiers(
  eligibleIds: readonly string[],
  models: readonly {
    readonly id: string;
    readonly version?: string;
    readonly estimatedCostUsd: number;
  }[]
): LiveCascadeTier[] {
  const byId = new Map(models.map((model) => [model.id, model]));
  return [...eligibleIds]
    .filter((id) => {
      const model = byId.get(id);
      return model !== undefined && typeof model.version === "string" && model.version.trim() !== "";
    })
    .sort((left, right) => {
      const cost =
        (byId.get(left)?.estimatedCostUsd ?? Number.POSITIVE_INFINITY) -
        (byId.get(right)?.estimatedCostUsd ?? Number.POSITIVE_INFINITY);
      if (cost !== 0) return cost;
      return left.localeCompare(right);
    })
    .map((id) => {
      const model = byId.get(id)!;
      return { modelId: model.id, version: model.version! };
    });
}

export function evidenceFromTaskResult(result: {
  readonly verification: { readonly kind: string };
}): CascadeEvidence {
  if (result.verification.kind === "PASSED") {
    return { source: "deterministic-check", kind: "PASS" };
  }
  if (result.verification.kind === "FAILED") {
    return { source: "deterministic-check", kind: "FAIL" };
  }
  return { source: "none", kind: "ABSTAIN" };
}

export function decideLiveCascade(input: {
  readonly plan: LiveCascadePlan;
  readonly previousModelId: string;
  readonly evidence: CascadeEvidence;
  readonly failureClass?: FailureClass | undefined;
}): LiveCascadeDecision {
  const current = input.plan.tiers.find((tier) => tier.modelId === input.previousModelId);
  const stay = (action: LiveCascadeDecision["action"], reason: string): LiveCascadeDecision => ({
    action,
    reason,
    nextModelId: input.previousModelId,
    ...(current !== undefined ? { nextVersion: current.version } : {})
  });

  if (
    input.evidence.kind === "FAIL" &&
    input.failureClass !== undefined &&
    input.failureClass !== "model"
  ) {
    return stay("abstain", `failureClass=${input.failureClass}; cascade skipped`);
  }

  const choice = resolveEvidenceCascade(input.plan.highRisk, input.evidence);
  if (choice.action !== "escalate") {
    return stay(choice.action, choice.reason);
  }

  const index = input.plan.tiers.findIndex((tier) => tier.modelId === input.previousModelId);
  const successor = index >= 0 ? input.plan.tiers[index + 1] : undefined;
  if (successor === undefined) {
    return stay("retain", "cascade exhausted; staying on the most expensive eligible tier");
  }
  return {
    action: "escalate",
    reason: `cascade ${input.previousModelId}->${successor.modelId}`,
    nextModelId: successor.modelId,
    nextVersion: successor.version
  };
}
