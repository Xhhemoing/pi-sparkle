import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DomainValidationError } from "../../../src/domain/errors.js";
import {
  applyRoutingScoreUpdate,
  assertCanPromoteFromReview,
} from "../../../src/review/self-review.js";

describe("M4-T3: self-review cannot update routing or promote", () => {
  it("self-review cannot change the actor routing score", () => {
    assert.throws(
      () =>
        applyRoutingScoreUpdate({
          reviewerId: "actor-1",
          actorId: "actor-1",
          reviewerKind: "self",
          currentScore: 0.4,
          delta: 0.2,
        }),
      DomainValidationError
    );
    assert.throws(
      () =>
        applyRoutingScoreUpdate({
          reviewerId: "actor-1",
          actorId: "actor-1",
          reviewerKind: "peer",
          currentScore: 0.4,
          delta: 0.2,
        }),
      DomainValidationError
    );
  });

  it("independent review can update the actor routing score", () => {
    const next = applyRoutingScoreUpdate({
      reviewerId: "critic-1",
      actorId: "actor-1",
      reviewerKind: "independent",
      currentScore: 2,
      delta: 3,
    });
    assert.equal(next, 5);
  });

  it("self-review cannot promote the actor resource", () => {
    assert.throws(
      () =>
        assertCanPromoteFromReview({
          reviewerKind: "self",
          reviewerId: "actor-1",
          actorId: "actor-1",
        }),
      DomainValidationError
    );
    assert.doesNotThrow(() =>
      assertCanPromoteFromReview({
        reviewerKind: "independent",
        reviewerId: "critic-1",
        actorId: "actor-1",
      })
    );
  });
});
