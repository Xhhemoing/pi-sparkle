import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCriticObservation } from "../../../src/review/critic.js";
import { blindPairwiseCompare } from "../../../src/review/pairwise.js";
import { reconcileReviews } from "../../../src/review/reconcile.js";
import { createRubric } from "../../../src/rubric/types.js";
import type { RubricCriterion } from "../../../src/rubric/types.js";
import { createEpisodeId } from "../../../src/domain/ids.js";

const criteria: RubricCriterion[] = [
  { id: "build", description: "build passes", weight: 1, observableCheck: "build exits 0" },
  { id: "docs", description: "docs updated", weight: 1, observableCheck: "docs diff" },
];
const rubric = createRubric("m4-review", "task", criteria);
const episodeId = createEpisodeId();

describe("M4-T3: independent critic and blind pairwise review", () => {
  describe("critic", () => {
    it("a critic that receives actor defense abstains instead of judging", () => {
      const output = createCriticObservation({
        episodeId,
        rubric,
        evidence: { build: "log" },
        actorDefense: "the actor explains why the failure is not its fault",
      });
      assert.equal(output.overall, "ABSTAIN");
      assert.equal(output.scores.length, 0);
      assert.match(output.comment, /must not receive actor defense/);
    });

    it("scores criteria strictly from evidence without actor identity", () => {
      const output = createCriticObservation({
        episodeId,
        rubric,
        evidence: { build: "build-log.txt" },
      });
      assert.equal(output.scores.length, 2);
      assert.equal(output.scores[0]?.outcome, "PASS");
      assert.equal(output.scores[0]?.evidenceRef, "build-log.txt");
      assert.equal(output.scores[1]?.outcome, "UNOBSERVED");
      assert.ok(!("evidenceRef" in (output.scores[1] ?? {})));
      assert.equal(output.overall, "PASS");
    });

    it("produces UNOBSERVED rather than FAIL when evidence is absent", () => {
      const output = createCriticObservation({ episodeId, rubric, evidence: {} });
      assert.equal(output.overall, "UNOBSERVED");
      assert.ok(output.scores.every((s) => s.outcome === "UNOBSERVED"));
    });
  });

  describe("pairwise", () => {
    it("is blind to presentation order: swapped order flips the reported winner", () => {
      const first = blindPairwiseCompare({
        episodeId,
        aId: "cand-a",
        bId: "cand-b",
        aScore: 0.9,
        bScore: 0.5,
        aComment: "a",
        bComment: "b",
      });
      assert.equal(first.winner, "a");
      assert.equal(first.aId, "cand-a");

      const swapped = blindPairwiseCompare({
        episodeId,
        aId: "cand-a",
        bId: "cand-b",
        aScore: 0.9,
        bScore: 0.5,
        aComment: "a",
        bComment: "b",
      }, true);
      assert.equal(swapped.winner, "b");
      assert.equal(swapped.orderSwapped, true);
      assert.equal(swapped.aId, "cand-b");
    });

    it("ties on equal material regardless of position (no position bias)", () => {
      const base = {
        episodeId,
        aId: "x",
        bId: "y",
        aScore: 0.7,
        bScore: 0.7,
        aComment: "a",
        bComment: "b",
      };
      const direct = blindPairwiseCompare(base);
      const swapped = blindPairwiseCompare(base, true);
      assert.equal(direct.winner, "tie");
      assert.equal(swapped.winner, "tie");
      assert.match(direct.rationale, /position bias/);
    });

    it("position-sensitive disagreement becomes uncertainty with dissent preserved", () => {
      const base = {
        episodeId,
        aId: "cand-a",
        bId: "cand-b",
        aScore: 0.9,
        bScore: 0.5,
        aComment: "a",
        bComment: "b",
      };
      const first = blindPairwiseCompare(base);
      const swapped = blindPairwiseCompare(base, true);
      assert.equal(first.winner, "a");
      assert.equal(swapped.winner, "b");

      const reconciliation = reconcileReviews([first, swapped]);
      assert.equal(reconciliation.consensus, "uncertain");
      assert.equal(reconciliation.dissent.length, 2);
      assert.equal(reconciliation.dissentCount, 2);
    });

    it("an empty comparison set reconciles to a tie with no dissent", () => {
      const result = reconcileReviews([]);
      assert.equal(result.consensus, "tie");
      assert.equal(result.dissent.length, 0);
      assert.equal(result.dissentCount, 0);
    });
  });

  describe("reconciliation", () => {
    it("deduplicates causal defects while preserving dissent", () => {
      const mkB = () =>
        blindPairwiseCompare({
          episodeId,
          aId: "x",
          bId: "y",
          aScore: 0.4,
          bScore: 0.9,
          aComment: "a",
          bComment: "b",
        });
      // Three agreeing results and two dissenting results that share the same
      // underlying rationale: consensus is "a" but the causal defect is counted once.
      const a1 = blindPairwiseCompare({
        episodeId,
        aId: "x",
        bId: "y",
        aScore: 0.9,
        bScore: 0.4,
        aComment: "a",
        bComment: "b",
      });
      const a2 = { ...a1, id: `${a1.id}-2` };
      const a3 = { ...a1, id: `${a1.id}-3` };
      const b1 = mkB();
      const b2 = { ...b1, id: `${b1.id}-2` };

      const result = reconcileReviews([a1, a2, a3, b1, b2]);
      assert.equal(result.consensus, "a");
      assert.equal(result.dissentCount, 2);
      assert.equal(result.causalDefects.length, 1);
      assert.equal(result.causalDefects[0], b1.rationale);
    });

    it("empty input yields a tie with zero dissent and no defects", () => {
      const result = reconcileReviews([]);
      assert.equal(result.consensus, "tie");
      assert.equal(result.dissentCount, 0);
      assert.equal(result.causalDefects.length, 0);
    });
  });
});
