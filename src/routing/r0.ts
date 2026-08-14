import type { ModelDescriptor } from "./capability-registry.js";
import { estimateCostUsd } from "./capability-registry.js";
import type { ConstraintFailure, RouteRequest } from "./policy.js";
import { evaluateCandidate } from "./policy.js";

export interface R0Config {
  /** Confidence a cheaper tier must reach before escalation is considered. */
  readonly confidenceGate: number;
  /** Enables deterministic cost-cascade escalation. */
  readonly cascade: boolean;
  readonly policyVersion: string;
}

export interface R0CandidateRecord {
  readonly modelId: string;
  readonly eligible: boolean;
  readonly failures: readonly ConstraintFailure[];
  readonly estimatedCostUsd: number;
}

export interface R0Decision {
  readonly request: RouteRequest;
  /** Every candidate and its rejection reason — nothing is dropped silently. */
  readonly candidates: readonly R0CandidateRecord[];
  readonly selection: string | undefined;
  /** Eligible models ordered cheapest-first; escalation tiers after the selection. */
  readonly fallbacks: readonly string[];
  readonly reason: string;
  readonly policyVersion: string;
  /** R0 is static and never explores. */
  readonly exploratory: false;
  /** Cascade steps already taken (empty until a confidence gate triggers). */
  readonly escalations: readonly string[];
}

function eligibleCandidates(
  models: readonly ModelDescriptor[],
  request: RouteRequest
): R0CandidateRecord[] {
  return models
    .map((model) => {
      const check = evaluateCandidate(model, request);
      return {
        modelId: model.modelId,
        eligible: check.eligible,
        failures: check.failures,
        estimatedCostUsd: estimateCostUsd(model, request.contextNeeded, request.outputNeeded),
      };
    })
    .sort((a, b) => {
      const costDiff = a.estimatedCostUsd - b.estimatedCostUsd;
      if (costDiff !== 0) return costDiff;
      return a.modelId < b.modelId ? -1 : a.modelId > b.modelId ? 1 : 0;
    });
}

/**
 * Deterministic R0: filter on hard constraints, rank by estimated cost, and
 * fail closed when nothing is eligible. High-risk requests only ever consider
 * models explicitly approved for high-risk work.
 */
export function routeR0(
  config: R0Config,
  models: readonly ModelDescriptor[],
  request: RouteRequest
): R0Decision {
  const candidates = eligibleCandidates(models, request);
  const eligible = candidates.filter((c) => c.eligible);
  const tiered = eligible.map((c) => c.modelId);

  let selection: string | undefined;
  let reason: string;

  if (request.highRisk) {
    const approved = eligible.filter((c) => {
      const model = models.find((m) => m.modelId === c.modelId);
      return model?.approvedForHighRisk === true;
    });
    if (approved.length === 0) {
      selection = undefined;
      reason = "no model approved for high-risk tasks is eligible; routing refused";
    } else {
      selection = approved[0]?.modelId;
      reason = "cheapest eligible model approved for high-risk tasks";
    }
  } else if (tiered.length === 0) {
    selection = undefined;
    reason = "no eligible model for the request; routing refused";
  } else {
    selection = tiered[0];
    reason = "cheapest eligible model under deterministic constraints";
  }

  const fallbacks = selection === undefined ? tiered : tiered.filter((id) => id !== selection);

  return {
    request,
    candidates,
    selection,
    fallbacks,
    reason,
    policyVersion: config.policyVersion,
    exploratory: false,
    escalations: [],
  };
}

export interface CascadeInput {
  /** The model that produced the previous attempt. */
  readonly previousModelId: string;
  /** Evidence confidence (0..1) reported for that attempt. */
  readonly previousConfidence: number;
}

/**
 * Deterministic cost-cascade: a cheaper tier that clears the confidence gate
 * is retained; otherwise routing escalates to the next eligible tier. Every
 * step is recorded. High-risk requests never cascade into exploration — the
 * tier list is the same approved set.
 */
export function applyCascade(
  config: R0Config,
  decision: R0Decision,
  input: CascadeInput
): R0Decision {
  if (!config.cascade) {
    return {
      ...decision,
      reason: "cascade disabled; selection unchanged",
    };
  }
  if (decision.selection === undefined) {
    return { ...decision, reason: "no selection to cascade from" };
  }
  if (input.previousConfidence >= config.confidenceGate) {
    return {
      ...decision,
      reason: `confidence ${input.previousConfidence} >= gate ${config.confidenceGate}; retained ${decision.selection}`,
    };
  }

  const tiers = [decision.selection, ...decision.fallbacks];
  const currentIndex = tiers.indexOf(input.previousModelId);
  if (currentIndex < 0) {
    return {
      ...decision,
      reason: `previous model ${input.previousModelId} is not in the cascade tiers`,
    };
  }
  const nextIndex = currentIndex + 1;
  if (nextIndex >= tiers.length) {
    return {
      ...decision,
      reason: "cascade exhausted; staying on the most expensive eligible tier",
    };
  }

  const escalated = tiers[nextIndex];
  if (escalated === undefined) {
    return { ...decision, reason: "cascade exhausted" };
  }
  return {
    ...decision,
    selection: escalated,
    fallbacks: decision.fallbacks.filter((id) => id !== escalated),
    escalations: [...decision.escalations, `${input.previousModelId}->${escalated}`],
    reason: `confidence ${input.previousConfidence} < gate ${config.confidenceGate}; escalated ${input.previousModelId} -> ${escalated}`,
  };
}
