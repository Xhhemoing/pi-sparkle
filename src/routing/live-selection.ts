import type { RoutingRefusal } from "../domain/errors.js";
import type { FlowchartNodeRole, TaskComplexity } from "../domain/flowchart.js";
import type { CatalogModel } from "./catalog-model.js";

/**
 * Live ranking total order: preferred constraint first, then cheapest
 * estimatedCostUsd, then id.localeCompare. This is the R0-equivalent static
 * policy; adaptive R1/bandit rankers must never replace it on the live path.
 */
export function compareLiveCandidates(
  left: CatalogModel,
  right: CatalogModel,
  preferredModel: string | undefined
): number {
  const preferredDifference =
    Number(right.id === preferredModel) - Number(left.id === preferredModel);
  if (preferredDifference !== 0) return preferredDifference;
  const costDifference = left.estimatedCostUsd - right.estimatedCostUsd;
  if (costDifference !== 0) return costDifference;
  return left.id.localeCompare(right.id);
}

/**
 * Single-pass minimum under compareLiveCandidates. Ties keep the earliest
 * (catalog-order) candidate, matching the stable sort-then-take-first this
 * replaces. Precondition: eligible is non-empty.
 */
export function selectLiveModel(
  eligible: readonly CatalogModel[],
  preferredModel: string | undefined
): CatalogModel {
  let best = eligible[0]!;
  for (let index = 1; index < eligible.length; index += 1) {
    const candidate = eligible[index]!;
    if (compareLiveCandidates(candidate, best, preferredModel) < 0) {
      best = candidate;
    }
  }
  return best;
}

/**
 * Fail-closed message precedence is part of the public contract:
 * high-risk-approval first, then budget/deadline, then role/complexity.
 */
export function liveRefusalMessage(
  input: {
    readonly role: FlowchartNodeRole;
    readonly complexity: TaskComplexity;
    readonly highRisk: boolean;
  },
  refusals: readonly RoutingRefusal[]
): string {
  if (input.highRisk && refusals.some((row) => row.constraint === "high-risk-approval")) {
    return "No allowed model is approved for high-risk tasks";
  }
  if (refusals.some((row) => row.constraint === "budget" || row.constraint === "deadline")) {
    return "No allowed model fits the remaining cost and time limits";
  }
  return `No allowed model satisfies role ${input.role} and complexity ${input.complexity}`;
}
