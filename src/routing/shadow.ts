import { DomainValidationError } from "../domain/errors.js";
import type { TaskFeatures } from "./bandit.js";
import { createBanditState, recordExploration, recordReward, selectArm } from "./bandit.js";
import type { BanditState } from "./bandit.js";
import { createDriftMonitor } from "./drift.js";
import type { DriftConfig, DriftMonitor } from "./drift.js";

export interface ShadowConfig {
  readonly seed: number;
  readonly epsilon: number;
  /** Exploration budget, separate from any isolated-comparison budget. */
  readonly explorationBudget: number;
  /** Explicit budget authorizing isolated comparisons of unselected models. */
  readonly comparisonBudgetUsd?: number | undefined;
  readonly driftConfig?: DriftConfig | undefined;
}

export interface ShadowDecision {
  readonly episodeHash: string;
  readonly chosenArm: string;
  readonly exploratory: boolean;
  /**
   * Shadow mode never invokes the unselected model and never changes
   * production side effects. An explicit comparison budget may authorize an
   * isolated invocation instead.
   */
  readonly invoked: boolean;
  readonly sideEffects: "none" | "isolated-only";
  readonly highRisk: boolean;
  readonly guardrailBreached: boolean;
  readonly uncertaintyScale: number;
}

export interface ShadowState {
  readonly bandit: BanditState;
  readonly monitor: DriftMonitor;
  readonly halted: boolean;
  readonly haltReason: string | undefined;
  readonly decisions: readonly ShadowDecision[];
  readonly highRiskExplorations: number;
}

export interface ShadowRunner {
  step(
    state: ShadowState,
    episodeHash: string,
    features: TaskFeatures,
    highRisk: boolean,
    guardrail: (arm: string, features: TaskFeatures) => boolean,
    rng: () => number
  ): ShadowState;
}

/**
 * A shadow bandit learns routing decisions without affecting live execution:
 * decisions are logged, unselected models are never invoked, side effects
 * stay untouched, high-risk tasks never explore, drift widens uncertainty
 * and falls back, and any guardrail breach halts the experiment.
 */
export function createShadowRunner(config: ShadowConfig): ShadowRunner {
  return {
    step(state, episodeHash, features, highRisk, guardrail, rng) {
      if (state.halted) {
        return {
          ...state,
          decisions: [
            ...state.decisions,
            {
              episodeHash,
              chosenArm: state.bandit.arms[0] ?? "",
              exploratory: false,
              invoked: false,
              sideEffects: "none",
              highRisk,
              guardrailBreached: false,
              uncertaintyScale: state.monitor.uncertaintyScale,
            },
          ],
        };
      }

      state.monitor.observe(features);
      const drifted = state.monitor.drifted;

      // Distribution shift widens uncertainty and forces the conservative
      // greedy fallback — no exploration while drifted.
      const choice = selectArm(
        state.bandit,
        { seed: config.seed, explorationBudget: config.explorationBudget, epsilon: drifted ? 0 : config.epsilon },
        features,
        highRisk,
        rng
      );

      const breached = guardrail(choice.arm, features);
      const isolatedAuthorized = (config.comparisonBudgetUsd ?? 0) > 0 && choice.exploratory;

      const decision: ShadowDecision = {
        episodeHash,
        chosenArm: choice.arm,
        exploratory: choice.exploratory,
        invoked: isolatedAuthorized,
        sideEffects: isolatedAuthorized ? "isolated-only" : "none",
        highRisk,
        guardrailBreached: breached,
        uncertaintyScale: state.monitor.uncertaintyScale,
      };

      const nextBandit = choice.exploratory
        ? recordExploration(state.bandit, highRisk)
        : state.bandit;

      if (breached) {
        return {
          ...state,
          bandit: nextBandit,
          halted: true,
          haltReason: `guardrail breach for arm ${choice.arm}`,
          decisions: [...state.decisions, decision],
          highRiskExplorations: highRisk
            ? state.highRiskExplorations + (choice.exploratory ? 1 : 0)
            : state.highRiskExplorations,
        };
      }

      return {
        ...state,
        bandit: nextBandit,
        decisions: [...state.decisions, decision],
        highRiskExplorations: state.highRiskExplorations,
      };
    },
  };
}

export function createShadowState(arms: readonly string[], config: ShadowConfig): ShadowState {
  if (arms.length === 0) {
    throw new DomainValidationError("shadow bandit requires at least one arm");
  }
  return {
    bandit: createBanditState(arms),
    monitor: createDriftMonitor(config.driftConfig),
    halted: false,
    haltReason: undefined,
    decisions: [],
    highRiskExplorations: 0,
  };
}

export { recordReward };
