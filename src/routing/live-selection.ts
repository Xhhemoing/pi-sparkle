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

const CONSTRAINT_LABELS: Readonly<Record<string, string>> = {
  "provider-policy": "provider policy",
  "privacy-class": "privacy class",
  capability: "required capability",
  "context-window": "context window",
  "max-output": "max output tokens",
  role: "role",
  complexity: "complexity"
};

/**
 * Fail-closed message precedence is part of the public contract:
 * high-risk-approval first, then budget/deadline, then the named constraints
 * that actually bound the refusal. The rejection matrix always carried them,
 * but the caller only ever sees `message`, so a privacy or capability refusal
 * used to be reported as a role/complexity mismatch. The high-risk and
 * budget/deadline wordings are load-bearing: the flowchart supervisor matches
 * the cost/time phrase to fail a node instead of the run.
 */
export function liveRefusalMessage(
  input: {
    readonly role: FlowchartNodeRole;
    readonly complexity: TaskComplexity;
    readonly highRisk: boolean;
  },
  refusals: readonly RoutingRefusal[]
): string {
  const constraints = [...new Set(refusals.map((row) => row.constraint))];
  if (input.highRisk && constraints.includes("high-risk-approval")) {
    return "No allowed model is approved for high-risk tasks";
  }
  if (constraints.includes("budget") || constraints.includes("deadline")) {
    return "No allowed model fits the remaining cost and time limits";
  }
  const named = constraints.filter((row) => row !== "role" && row !== "complexity");
  if (named.length === 0) {
    return `No allowed model satisfies role ${input.role} and complexity ${input.complexity}`;
  }
  const detail = named
    .map((constraint) => {
      const rows = refusals
        .filter((row) => row.constraint === constraint)
        .map((row) => `${row.modelId}: ${row.detail}`)
        .join("; ");
      return `${CONSTRAINT_LABELS[constraint] ?? constraint} (${rows})`;
    })
    .join(", ");
  return `No allowed model satisfies ${detail}`;
}
