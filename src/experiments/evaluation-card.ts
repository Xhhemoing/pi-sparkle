import { DomainValidationError } from "../domain/errors.js";

export interface EvaluationCard {
  readonly cardVersion: number;
  readonly domains: readonly string[];
  readonly difficultyTiers: readonly string[];
  /** Multiple metrics, not only local task replay. */
  readonly metrics: readonly string[];
  readonly baseline: {
    readonly utility: number;
    readonly costUsd: number;
    readonly uncertainty: number;
  };
  readonly candidate: {
    readonly utility: number;
    readonly costUsd: number;
    readonly uncertainty: number;
  };
  readonly guardrailViolations: readonly string[];
}

export const SUPPORTED_CARD_VERSION = 1;

/**
 * A versioned evaluation card reporting the static baseline, observed utility,
 * uncertainty, cost, and guardrails separately, with domain coverage,
 * difficulty tiers, and multiple metrics.
 */
export function createEvaluationCard(
  partial: Omit<EvaluationCard, "cardVersion">
): EvaluationCard {
  const card: EvaluationCard = { cardVersion: SUPPORTED_CARD_VERSION, ...partial };
  validateEvaluationCard(card);
  return card;
}

export function validateEvaluationCard(card: EvaluationCard): void {
  if (card.cardVersion !== SUPPORTED_CARD_VERSION) {
    throw new DomainValidationError(`unsupported evaluation card version: ${card.cardVersion}`);
  }
  if (card.domains.length === 0) {
    throw new DomainValidationError("evaluation card requires domain coverage");
  }
  if (card.difficultyTiers.length === 0) {
    throw new DomainValidationError("evaluation card requires difficulty tiers");
  }
  if (card.metrics.length === 0) {
    throw new DomainValidationError("evaluation card requires at least one metric");
  }
  for (const value of [card.baseline.utility, card.candidate.utility]) {
    if (!Number.isFinite(value) || value < -1 || value > 1) {
      throw new DomainValidationError(`utility out of range: ${value}`);
    }
  }
  for (const value of [card.baseline.uncertainty, card.candidate.uncertainty]) {
    if (!Number.isFinite(value) || value < 0) {
      throw new DomainValidationError(`uncertainty must be non-negative: ${value}`);
    }
  }
  for (const value of [card.baseline.costUsd, card.candidate.costUsd]) {
    if (!Number.isFinite(value) || value < 0) {
      throw new DomainValidationError(`cost must be non-negative: ${value}`);
    }
  }
}
