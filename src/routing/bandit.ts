import { DomainValidationError } from "../domain/errors.js";

/** Observable, versioned task features — anything outside this schema is rejected. */
export const OBSERVABLE_FEATURE_KEYS = [
  "featureVersion",
  "taskFamily",
  "role",
  "contextTokens",
  "outputTokens",
  "capabilities",
] as const;

export interface TaskFeatures {
  readonly featureVersion: string;
  readonly taskFamily: string;
  readonly role: string;
  readonly contextTokens: number;
  readonly outputTokens: number;
  readonly capabilities: readonly string[];
}

export function validateTaskFeatures(features: unknown): asserts features is TaskFeatures {
  if (typeof features !== "object" || features === null) {
    throw new DomainValidationError("task features must be an object");
  }
  const record = features as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(OBSERVABLE_FEATURE_KEYS as readonly string[]).includes(key)) {
      throw new DomainValidationError(`unobservable feature rejected: ${key}`);
    }
  }
  if (typeof record.featureVersion !== "string" || record.featureVersion === "") {
    throw new DomainValidationError("featureVersion is required");
  }
  if (typeof record.taskFamily !== "string" || typeof record.role !== "string") {
    throw new DomainValidationError("taskFamily and role must be strings");
  }
}

export interface BanditConfig {
  readonly seed: number;
  /** Maximum exploratory draws allowed before the bandit becomes greedy. */
  readonly explorationBudget: number;
  /** Probability of an exploratory draw while budget remains. */
  readonly epsilon: number;
}

export interface BanditState {
  readonly arms: readonly string[];
  readonly pulls: Record<string, number>;
  readonly rewardSum: Record<string, number>;
  readonly explorationsUsed: number;
  /** Must always remain zero — high-risk tasks never explore. */
  readonly highRiskExplorations: number;
}

export function createBanditState(arms: readonly string[]): BanditState {
  const pulls: Record<string, number> = {};
  const rewardSum: Record<string, number> = {};
  for (const arm of arms) {
    pulls[arm] = 0;
    rewardSum[arm] = 0;
  }
  return { arms: [...arms], pulls, rewardSum, explorationsUsed: 0, highRiskExplorations: 0 };
}

export interface ArmChoice {
  readonly arm: string;
  readonly exploratory: boolean;
}

/**
 * Epsilon-greedy selection with deterministic mean-reward tie-breaks.
 * This is not UCB. High-risk tasks never explore — the exploration counter stays at zero.
 */
export function selectArm(
  state: BanditState,
  config: BanditConfig,
  features: TaskFeatures,
  highRisk: boolean,
  rng: () => number
): ArmChoice {
  validateTaskFeatures(features);
  if (state.arms.length === 0) {
    throw new DomainValidationError("bandit has no arms");
  }
  const canExplore =
    !highRisk && config.epsilon > 0 && state.explorationsUsed < config.explorationBudget;

  if (canExplore && rng() < config.epsilon) {
    const index = Math.floor(rng() * state.arms.length) % state.arms.length;
    return { arm: state.arms[index] ?? state.arms[0]!, exploratory: true };
  }

  // Greedy: highest mean reward, ties broken by arm order (deterministic).
  let best = state.arms[0]!;
  let bestMean = meanReward(state, best);
  for (const arm of state.arms) {
    const mean = meanReward(state, arm);
    if (mean > bestMean) {
      best = arm;
      bestMean = mean;
    }
  }
  return { arm: best, exploratory: false };
}

export function recordReward(state: BanditState, arm: string, reward: number): BanditState {
  if (!state.arms.includes(arm)) {
    throw new DomainValidationError(`unknown arm: ${arm}`);
  }
  return {
    ...state,
    pulls: { ...state.pulls, [arm]: (state.pulls[arm] ?? 0) + 1 },
    rewardSum: { ...state.rewardSum, [arm]: (state.rewardSum[arm] ?? 0) + reward },
  };
}

export function recordExploration(state: BanditState, highRisk: boolean): BanditState {
  if (highRisk) {
    return { ...state, highRiskExplorations: state.highRiskExplorations + 1 };
  }
  return { ...state, explorationsUsed: state.explorationsUsed + 1 };
}

function meanReward(state: BanditState, arm: string): number {
  const pulls = state.pulls[arm] ?? 0;
  if (pulls === 0) return 0;
  return (state.rewardSum[arm] ?? 0) / pulls;
}
