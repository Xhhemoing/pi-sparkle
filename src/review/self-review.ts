import { DomainValidationError } from "../domain/errors.js";

export type ReviewerKind = "self" | "peer" | "independent";

export type RoutingScoreUpdate = { readonly actorId: string; readonly delta: number };

function assertNotSelfReview(opts: {
  reviewerKind: ReviewerKind;
  reviewerId: string;
  actorId: string;
  action: "update routing score" | "promote the actor resource";
}): void {
  if (opts.reviewerKind === "self" || opts.reviewerId === opts.actorId) {
    throw new DomainValidationError(
      `self-review cannot ${opts.action}`
    );
  }
}

/**
 * Apply a routing-score delta from a review. Self-review (by kind or by
 * identity) is rejected fail-closed and must not change the score.
 */
export function applyRoutingScoreUpdate(opts: {
  reviewerId: string;
  actorId: string;
  reviewerKind: ReviewerKind;
  currentScore: number;
  delta: number;
}): number {
  assertNotSelfReview({
    reviewerKind: opts.reviewerKind,
    reviewerId: opts.reviewerId,
    actorId: opts.actorId,
    action: "update routing score",
  });
  const update: RoutingScoreUpdate = { actorId: opts.actorId, delta: opts.delta };
  return opts.currentScore + update.delta;
}

/**
 * Gate resource promotion on review provenance. Self-review cannot promote
 * the actor's own resource.
 */
export function assertCanPromoteFromReview(opts: {
  reviewerKind: ReviewerKind;
  reviewerId: string;
  actorId: string;
}): void {
  assertNotSelfReview({
    ...opts,
    action: "promote the actor resource",
  });
}
