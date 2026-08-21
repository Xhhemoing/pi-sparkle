import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { hashCandidateContent } from "../../../src/adaptation/candidate.js";
import {
  assertPromotableFromSupport,
  assertSplitSeparation,
  assignEvaluationSplit,
  evaluateProposalShadow,
  proposeCandidates,
} from "../../../src/adaptation/reflection.js";
import type {
  OptimizerEvidence,
  OptimizerInput,
  OptimizerResult,
  ProposedCandidate,
} from "../../../src/adaptation/reflection.js";
import { createCandidateId, createResourceVersionId } from "../../../src/domain/ids.js";
import { validateExperimentPlan } from "../../../src/experiments/plan.js";
import type { ExperimentPlan } from "../../../src/experiments/plan.js";
import type { ExperimentOutcome } from "../../../src/experiments/shadow.js";

const PARENT = createResourceVersionId(() => "parent01");

function evidence(overrides: Partial<OptimizerEvidence> = {}): OptimizerEvidence {
  return {
    patternKey: "execution:cluster-0",
    boundary: "execution",
    redacted: true,
    actorModelId: "actor-1",
    supportingEvaluatorIds: ["critic-1"],
    ...overrides,
  };
}

function input(overrides: Partial<OptimizerInput> = {}): OptimizerInput {
  return {
    parentVersionId: PARENT,
    parentContent: "You are a careful coding assistant.",
    parentKind: "prompt",
    identity: { kind: "prompt", name: "main-agent-prompt" },
    evidence: [evidence()],
    budget: {
      maxCandidatesPerEpoch: 4,
      maxTopologyCandidates: 1,
      lowRiskTaskFamilies: ["edit", "test", "refactor"],
    },
    taskFamily: "edit",
    epoch: 0,
    seed: 7,
    ...overrides,
  };
}

function assertNoLiveMutationSurface(value: object): void {
  for (const key of ["activeVersion", "setActive", "promote", "casActivePointer"] as const) {
    assert.equal(key in value, false, `must not expose ${key}`);
  }
}

describe("M6-T4: reflective optimizer", () => {
  it("rejects unredacted evidence", () => {
    const missing = {
      patternKey: "execution:cluster-0",
      boundary: "execution",
      supportingEvaluatorIds: ["critic-1"],
    } as unknown as OptimizerEvidence;
    assert.throws(() => proposeCandidates(input({ evidence: [missing] })), (error: unknown) => {
      assert.ok(error instanceof DomainValidationError);
      assert.match(error.message, /unredacted evidence/);
      return true;
    });
    const flagged = { ...evidence(), redacted: false as unknown as true };
    assert.throws(() => proposeCandidates(input({ evidence: [flagged] })), /unredacted evidence/);
  });

  it("rejects self-support from actor-only evaluators and does not propose them", () => {
    const actorOnly = evidence({
      patternKey: "execution:cluster-self",
      supportingEvaluatorIds: ["actor-1"],
    });
    const emptySupport = evidence({
      patternKey: "execution:cluster-empty",
      supportingEvaluatorIds: [],
    });
    const external = evidence({
      patternKey: "execution:cluster-ok",
      supportingEvaluatorIds: ["critic-1"],
    });
    const result = proposeCandidates(input({ evidence: [actorOnly, emptySupport, external] }));
    assert.equal(result.rejectedSelfSupported, 2);
    assert.equal(result.proposals.length, 1);
    assert.equal(result.proposals[0]?.selfSupported, false);
    assert.deepEqual(result.proposals[0]?.evidenceRefs, ["execution:cluster-ok"]);

    assert.throws(
      () =>
        assertPromotableFromSupport({
          actorModelId: "actor-1",
          supportingEvaluatorIds: ["actor-1"],
        }),
      DomainValidationError
    );
    assert.throws(
      () => assertPromotableFromSupport({ actorModelId: "actor-1", supportingEvaluatorIds: [] }),
      DomainValidationError
    );
    assertPromotableFromSupport({
      actorModelId: "actor-1",
      supportingEvaluatorIds: ["critic-1"],
    });
  });

  it("caps proposals at maxCandidatesPerEpoch", () => {
    const items = ["a", "b", "c"].map((suffix) =>
      evidence({ patternKey: `execution:cluster-${suffix}`, supportingEvaluatorIds: ["critic-1"] })
    );
    const result = proposeCandidates(
      input({
        evidence: items,
        budget: {
          maxCandidatesPerEpoch: 2,
          maxTopologyCandidates: 0,
          lowRiskTaskFamilies: ["edit"],
        },
      })
    );
    assert.equal(result.proposals.length, 2);
    assert.equal(result.budgetSpent.candidates, 2);
  });

  it("reports topology budget spent for low-risk workflow-template search", () => {
    const items = ["a", "b", "c"].map((suffix) =>
      evidence({ patternKey: `plan:cluster-${suffix}`, boundary: "plan" })
    );
    const result = proposeCandidates(
      input({
        parentKind: "workflow-template",
        identity: { kind: "workflow-template", name: "edit-loop" },
        parentContent: "steps:\n  - edit\n  - test",
        evidence: items,
        budget: {
          maxCandidatesPerEpoch: 5,
          maxTopologyCandidates: 2,
          lowRiskTaskFamilies: ["edit", "test", "refactor"],
        },
        taskFamily: "edit",
      })
    );
    assert.equal(result.proposals.length, 2);
    assert.equal(result.topologyCandidatesUsed, 2);
    assert.deepEqual(result.budgetSpent, { candidates: 2, topology: 2 });
    assert.ok(result.proposals.every((proposal) => proposal.kind === "workflow-template"));
  });

  it("rejects topology search when the topology budget is 0", () => {
    assert.throws(
      () =>
        proposeCandidates(
          input({
            parentKind: "workflow-template",
            identity: { kind: "workflow-template", name: "edit-loop" },
            budget: {
              maxCandidatesPerEpoch: 3,
              maxTopologyCandidates: 0,
              lowRiskTaskFamilies: ["edit"],
            },
            taskFamily: "edit",
          })
        ),
      (error: unknown) => {
        assert.ok(error instanceof DomainValidationError);
        assert.match(error.message, /topology search budget is 0/);
        return true;
      }
    );
  });

  it("rejects topology search for high-risk task families", () => {
    assert.throws(
      () =>
        proposeCandidates(
          input({
            parentKind: "workflow-template",
            identity: { kind: "workflow-template", name: "deploy-loop" },
            budget: {
              maxCandidatesPerEpoch: 3,
              maxTopologyCandidates: 2,
              lowRiskTaskFamilies: ["edit", "deploy"],
            },
            taskFamily: "deploy",
          })
        ),
      /high-risk|forbidden/
    );
  });

  it("preserves parentVersionId lineage on every proposal", () => {
    const result = proposeCandidates(input());
    assert.equal(result.proposals.length, 1);
    const proposal = result.proposals[0]!;
    assert.equal(proposal.parentVersionId, PARENT);
    assert.equal(proposal.kind, "prompt");
    assert.equal(proposal.contentHash, hashCandidateContent(proposal.content));
    assert.ok(proposal.content.startsWith("You are a careful coding assistant."));
  });

  it("does not pass or return an active pointer", () => {
    const result: OptimizerResult = proposeCandidates(input());
    assertNoLiveMutationSurface(result);
    for (const proposal of result.proposals) {
      assertNoLiveMutationSurface(proposal);
    }
    type ResultHasActive = "activeVersion" extends keyof OptimizerResult ? true : false;
    type ProposalHasActive = "activeVersion" extends keyof ProposedCandidate ? true : false;
    const resultHasActive: ResultHasActive = false;
    const proposalHasActive: ProposalHasActive = false;
    assert.equal(resultHasActive, false);
    assert.equal(proposalHasActive, false);
  });

  it("separates generation and evaluation splits", () => {
    assert.throws(() => assertSplitSeparation("holdout", "validation"), (error: unknown) => {
      assert.ok(error instanceof DomainValidationError);
      assert.match(error.message, /holdout is sealed/);
      return true;
    });
    assert.throws(() => assertSplitSeparation("validation", "validation"), DomainValidationError);
    assertSplitSeparation("train", "holdout");
    assertSplitSeparation("train", "validation");
    assertSplitSeparation("validation", "holdout");

    const first = assignEvaluationSplit("cnd_split-a", 42);
    const second = assignEvaluationSplit("cnd_split-a", 42);
    assert.equal(first, second);
    assert.ok(first === "validation" || first === "holdout");
  });

  it("accepts a well-formed candidate id on an experiment plan without claiming improvement", () => {
    const candidateId = createCandidateId(() => "opt01");
    const plan: ExperimentPlan = {
      planVersion: 1,
      experimentId: "exp_optimizer-1",
      mode: "shadow",
      baselineVersionId: PARENT,
      candidateId,
      population: ["ep-a", "ep-b"],
      metrics: ["utility", "cost"],
      thresholds: { maxGuardrailBreaches: 0, maxCostUsd: 10 },
      budget: { maxAssignments: 2, maxWallClockMs: 10_000 },
      randomization: { seed: 3 },
      stopPolicy: { onGuardrail: "halt", onBudgetExhausted: "halt" },
      missingOutcomePolicy: "exclude",
    };
    validateExperimentPlan(plan);
    assert.match(plan.candidateId, /^cnd_/);

    const outcomes: ExperimentOutcome[] = [
      { episodeHash: "ep-a", utility: 0.4, costUsd: 0.1, guardrailBreached: false },
      { episodeHash: "ep-b", utility: 0.5, costUsd: 0.1, guardrailBreached: false },
    ];
    const shadow = evaluateProposalShadow(plan, outcomes, 0);
    assert.ok(shadow.assignments.every((assignment) => assignment.liveAction === "baseline"));
    assert.ok(shadow.assignments.every((assignment) => assignment.changedLiveAction === false));
  });
});
