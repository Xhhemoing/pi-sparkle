import { DomainValidationError } from "../domain/errors.js";
import { hash32 } from "../domain/hash.js";
import { isResourceVersionId } from "../domain/ids.js";
import type { ResourceVersionId } from "../domain/ids.js";
import { validateExperimentPlan } from "../experiments/plan.js";
import type { ExperimentPlan } from "../experiments/plan.js";
import { createShadowRunner } from "../experiments/shadow.js";
import type { ExperimentOutcome, ShadowState } from "../experiments/shadow.js";
import {
  HIGH_RISK_TASK_FAMILIES,
  isMutatableKind,
  mutateOnce,
} from "./mutate.js";
import type { MutatableKind } from "./mutate.js";

/**
 * Reflective prompt/workflow optimizer (M6-T4).
 *
 * Generates bounded, interpretable improvement candidates from redacted,
 * attributable failures. Offline, inter-test-time only.
 *
 * This module does not mutate active pointers, does not call promotion APIs,
 * does not attach R1/bandit to the live loop, does not claim Outcome-supported
 * improvement, and does not close Checkpoint F.
 *
 * Generation consumes evidence (train-like). `assignEvaluationSplit` is for
 * later scoring only. A proposal must not be scored on the split it was
 * generated from — use `assertSplitSeparation`.
 */

export const EVIDENCE_BOUNDARIES = [
  "contract",
  "context",
  "plan",
  "route",
  "execution",
  "tool",
  "review",
  "delivery",
] as const;

export type EvidenceBoundary = (typeof EVIDENCE_BOUNDARIES)[number];
export type GenerationSplit = "train" | "validation" | "holdout";
export type EvaluationSplit = "validation" | "holdout";

export interface SearchBudget {
  readonly maxCandidatesPerEpoch: number;
  readonly maxTopologyCandidates: number;
  readonly lowRiskTaskFamilies: readonly string[];
}

export interface OptimizerEvidence {
  readonly patternKey: string;
  readonly boundary: string;
  readonly redacted: true;
  readonly actorModelId?: string | undefined;
  readonly supportingEvaluatorIds: readonly string[];
}

export interface OptimizerInput {
  readonly parentVersionId: ResourceVersionId;
  readonly parentContent: string;
  readonly parentKind: MutatableKind;
  readonly identity: { kind: MutatableKind; name: string };
  readonly evidence: readonly OptimizerEvidence[];
  readonly budget: SearchBudget;
  readonly taskFamily: string;
  readonly epoch: number;
  readonly seed: number;
}

export interface ProposedCandidate {
  readonly content: string;
  readonly contentHash: string;
  readonly kind: MutatableKind;
  readonly parentVersionId: ResourceVersionId;
  readonly evidenceRefs: readonly string[];
  readonly selfSupported: boolean;
}

export interface OptimizerResult {
  readonly proposals: readonly ProposedCandidate[];
  readonly rejectedSelfSupported: number;
  readonly topologyCandidatesUsed: number;
  readonly budgetSpent: { readonly candidates: number; readonly topology: number };
}

export interface PromotableSupport {
  readonly actorModelId?: string | undefined;
  readonly supportingEvaluatorIds: readonly string[];
}

export function proposeCandidates(input: OptimizerInput): OptimizerResult {
  validateOptimizerInput(input);
  const { eligible, rejectedSelfSupported } = partitionEvidence(input.evidence);

  if (input.parentKind === "workflow-template") {
    assertTopologySearchAllowed(input);
  }

  const cap =
    input.parentKind === "workflow-template"
      ? Math.min(input.budget.maxCandidatesPerEpoch, input.budget.maxTopologyCandidates)
      : input.budget.maxCandidatesPerEpoch;

  const proposals: ProposedCandidate[] = [];
  for (const evidence of eligible) {
    if (proposals.length >= cap) {
      break;
    }
    const mutated = mutateOnce(
      {
        what: input.parentKind,
        when: "offline-inter-test-time",
        where: "typed-parameters",
        parentContent: input.parentContent,
        parentVersionId: input.parentVersionId,
        instruction: instructionFor(evidence, input.identity.name),
      },
      input.parentKind === "workflow-template"
        ? {
            topologySearchAllowed: true,
            taskFamily: input.taskFamily,
            lowRiskTaskFamilies: input.budget.lowRiskTaskFamilies,
          }
        : undefined
    );
    proposals.push({
      content: mutated.content,
      contentHash: mutated.contentHash,
      kind: mutated.kind,
      parentVersionId: mutated.parentVersionId,
      evidenceRefs: [evidence.patternKey],
      selfSupported: false,
    });
  }

  const topologyCandidatesUsed = input.parentKind === "workflow-template" ? proposals.length : 0;
  return {
    proposals,
    rejectedSelfSupported,
    topologyCandidatesUsed,
    budgetSpent: { candidates: proposals.length, topology: topologyCandidatesUsed },
  };
}

/**
 * Deterministic later-scoring split. Generation uses evidence (train-like);
 * this helper never returns both splits and is not used to generate content.
 */
export function assignEvaluationSplit(candidateId: string, seed: number): EvaluationSplit {
  if (typeof candidateId !== "string" || candidateId.trim() === "") {
    throw new DomainValidationError("candidateId is required");
  }
  if (!Number.isInteger(seed)) {
    throw new DomainValidationError("seed must be an integer");
  }
  const digest = Number.parseInt(hash32(`${candidateId}:${seed}`), 16);
  return digest % 2 === 0 ? "validation" : "holdout";
}

/**
 * A proposal must not be scored on the split it was generated from.
 * train→validation and train→holdout are allowed; validation→holdout is
 * allowed; the same split is not; holdout is sealed and cannot generate.
 */
export function assertSplitSeparation(
  generationSplit: GenerationSplit,
  evalSplit: EvaluationSplit
): void {
  if (generationSplit === "holdout") {
    throw new DomainValidationError("holdout is sealed");
  }
  if (generationSplit !== "train" && generationSplit !== "validation") {
    throw new DomainValidationError(`invalid generation split: ${String(generationSplit)}`);
  }
  if (evalSplit !== "validation" && evalSplit !== "holdout") {
    throw new DomainValidationError(`invalid evaluation split: ${String(evalSplit)}`);
  }
  if (generationSplit === evalSplit) {
    throw new DomainValidationError(
      `cannot evaluate on the same split used for generation (${evalSplit})`
    );
  }
}

/**
 * Throws when a candidate is supported only by itself or its actor model.
 * The optimizer never promotes; this is a gate for later promotion callers.
 */
export function assertPromotableFromSupport(input: PromotableSupport): void {
  if (typeof input !== "object" || input === null) {
    throw new DomainValidationError("support record is required");
  }
  if (!Array.isArray(input.supportingEvaluatorIds)) {
    throw new DomainValidationError("supportingEvaluatorIds must be an array");
  }
  if (isSelfSupported(input.actorModelId, input.supportingEvaluatorIds)) {
    throw new DomainValidationError(
      "candidate supported only by itself or its actor model cannot promote"
    );
  }
}

/**
 * Thin shadow-loop helper for a frozen experiment plan. Live action stays
 * baseline; this does not claim Outcome-supported improvement.
 */
export function evaluateProposalShadow(
  plan: ExperimentPlan,
  outcomes: readonly ExperimentOutcome[],
  nowMs = 0
): ShadowState {
  validateExperimentPlan(plan);
  const runner = createShadowRunner(plan);
  let state = runner.start(nowMs);
  for (const outcome of outcomes) {
    if (state.halted) {
      break;
    }
    state = runner.assign(state, outcome.episodeHash, nowMs);
    state = runner.recordOutcome(state, outcome, nowMs);
  }
  return state;
}

function validateOptimizerInput(input: OptimizerInput): void {
  if (typeof input !== "object" || input === null) {
    throw new DomainValidationError("optimizer input is required");
  }
  if (!isResourceVersionId(input.parentVersionId)) {
    throw new DomainValidationError(`invalid parent version id: ${String(input.parentVersionId)}`);
  }
  if (typeof input.parentContent !== "string") {
    throw new DomainValidationError("parentContent must be a string");
  }
  if (!isMutatableKind(input.parentKind)) {
    throw new DomainValidationError(`cannot optimize ${String(input.parentKind)}`);
  }
  if (typeof input.identity !== "object" || input.identity === null) {
    throw new DomainValidationError("identity is required");
  }
  if (input.identity.kind !== input.parentKind) {
    throw new DomainValidationError("identity.kind must match parentKind");
  }
  if (typeof input.identity.name !== "string" || input.identity.name.trim() === "") {
    throw new DomainValidationError("identity.name is required");
  }
  if (!Array.isArray(input.evidence)) {
    throw new DomainValidationError("evidence must be an array");
  }
  validateSearchBudget(input.budget);
  if (typeof input.taskFamily !== "string" || input.taskFamily.trim() === "") {
    throw new DomainValidationError("taskFamily is required");
  }
  if (!Number.isInteger(input.epoch) || input.epoch < 0) {
    throw new DomainValidationError("epoch must be an integer >= 0");
  }
  if (!Number.isInteger(input.seed)) {
    throw new DomainValidationError("seed must be an integer");
  }
}

function validateSearchBudget(budget: SearchBudget): void {
  if (typeof budget !== "object" || budget === null) {
    throw new DomainValidationError("search budget is required");
  }
  if (!Number.isInteger(budget.maxCandidatesPerEpoch) || budget.maxCandidatesPerEpoch < 1) {
    throw new DomainValidationError("maxCandidatesPerEpoch must be an integer >= 1");
  }
  if (!Number.isInteger(budget.maxTopologyCandidates) || budget.maxTopologyCandidates < 0) {
    throw new DomainValidationError("maxTopologyCandidates must be an integer >= 0");
  }
  if (!Array.isArray(budget.lowRiskTaskFamilies)) {
    throw new DomainValidationError("lowRiskTaskFamilies must be an array");
  }
}

function partitionEvidence(evidence: readonly OptimizerEvidence[]): {
  eligible: OptimizerEvidence[];
  rejectedSelfSupported: number;
} {
  const eligible: OptimizerEvidence[] = [];
  let rejectedSelfSupported = 0;
  const seen = new Set<string>();
  for (const item of evidence) {
    assertRedactedEvidence(item);
    if (isSelfSupported(item.actorModelId, item.supportingEvaluatorIds)) {
      rejectedSelfSupported += 1;
      continue;
    }
    const key = `${item.boundary}:${item.patternKey}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    eligible.push(item);
  }
  return { eligible, rejectedSelfSupported };
}

function assertRedactedEvidence(item: OptimizerEvidence): void {
  if (typeof item !== "object" || item === null) {
    throw new DomainValidationError("evidence item is required");
  }
  if (item.redacted !== true) {
    throw new DomainValidationError("unredacted evidence");
  }
  if (typeof item.patternKey !== "string" || item.patternKey.trim() === "") {
    throw new DomainValidationError("evidence patternKey is required");
  }
  if (!EVIDENCE_BOUNDARIES.includes(item.boundary as EvidenceBoundary)) {
    throw new DomainValidationError(`invalid evidence boundary: ${String(item.boundary)}`);
  }
  if (!Array.isArray(item.supportingEvaluatorIds)) {
    throw new DomainValidationError("supportingEvaluatorIds must be an array");
  }
}

function assertTopologySearchAllowed(input: OptimizerInput): void {
  if (input.budget.maxTopologyCandidates < 1) {
    throw new DomainValidationError("topology search budget is 0");
  }
  if ((HIGH_RISK_TASK_FAMILIES as readonly string[]).includes(input.taskFamily)) {
    throw new DomainValidationError(
      `topology mutation is forbidden for high-risk task family ${input.taskFamily}`
    );
  }
  if (!input.budget.lowRiskTaskFamilies.includes(input.taskFamily)) {
    throw new DomainValidationError(
      `topology search is forbidden for task family ${input.taskFamily}`
    );
  }
}

function isSelfSupported(
  actorModelId: string | undefined,
  supportingEvaluatorIds: readonly string[]
): boolean {
  if (supportingEvaluatorIds.length === 0) {
    return true;
  }
  const unique: string[] = [];
  for (const id of supportingEvaluatorIds) {
    if (typeof id !== "string" || id.trim() === "") {
      throw new DomainValidationError("supportingEvaluatorIds contains an empty entry");
    }
    if (!unique.includes(id)) {
      unique.push(id);
    }
  }
  return actorModelId !== undefined && unique.length === 1 && unique[0] === actorModelId;
}

function instructionFor(evidence: OptimizerEvidence, resourceName: string): string {
  return `Bounded delta for ${resourceName} at ${evidence.boundary} (${evidence.patternKey}): add an explicit check for this attributable failure.`;
}
