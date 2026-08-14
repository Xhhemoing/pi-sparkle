export interface BudgetState {
  readonly remainingBudgetUsd: number;
  readonly remainingTimeMs: number;
}

export interface TopologyCost {
  readonly extraCostUsd: number;
  readonly extraTimeMs: number;
}

export interface ExpectedValueResult {
  readonly evUsd: number;
  readonly affordable: boolean;
  readonly positive: boolean;
  /** Additional agents require positive EV under the remaining budget. */
  readonly approve: boolean;
}

/**
 * Expected value of adding agents: utility gain converted to budget value
 * minus the extra cost. The topology is only affordable when both cost and
 * time fit inside the remaining budget.
 */
export function evaluateExpectedValue(
  budget: BudgetState,
  cost: TopologyCost,
  expectedUtilityGain: number,
  valuePerUtilityPointUsd: number
): ExpectedValueResult {
  const evUsd = expectedUtilityGain * valuePerUtilityPointUsd - cost.extraCostUsd;
  const affordable =
    cost.extraCostUsd <= budget.remainingBudgetUsd &&
    cost.extraTimeMs <= budget.remainingTimeMs;
  return {
    evUsd,
    affordable,
    positive: evUsd > 0,
    approve: evUsd > 0 && affordable,
  };
}
