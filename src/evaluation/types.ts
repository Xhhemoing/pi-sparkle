import type { EpisodeId, RunId, TaskId } from "../domain/ids.js";
import type { IsoTimestamp } from "../domain/timestamp.js";

export type EvaluationOutcome = "PASS" | "FAIL" | "ABSTAIN" | "UNOBSERVED";

export type EvaluatorKind = "deterministic" | "human" | "inferential";

/**
 * M3-T6: how this evaluation relates to other evaluations of the same work.
 * `paired` shares the episode with its baseline; `independent` uses disjoint
 * evidence; `same-author` shares provenance and must not be treated as
 * independent corroboration.
 */
export const INDEPENDENCE_CLASSES = ["paired", "independent", "same-author"] as const;
export type IndependenceClass = (typeof INDEPENDENCE_CLASSES)[number];

/** The artifact (and optionally its version) this evaluation is about. */
export interface EvaluationTarget {
  readonly artifactId: string;
  readonly artifactVersion?: string | undefined;
}

export interface EvaluatorIdentity {
  readonly kind: EvaluatorKind;
  readonly version: string;
  readonly model?: string | undefined;
  readonly rubricVersion: string;
}

export interface CriterionScore {
  readonly criterionId: string;
  readonly outcome: EvaluationOutcome;
  readonly evidenceRef?: string | undefined;
  readonly confidence?: number | undefined; // 0-1 for inferential
  readonly reason?: string | undefined;
}

export interface Finding {
  readonly id: string;
  readonly criterionId: string;
  readonly severity: "blocker" | "major" | "minor" | "info";
  readonly message: string;
  readonly evidenceRef?: string | undefined;
}

export interface EvaluationRecord {
  readonly id: string;
  readonly episodeId: EpisodeId;
  readonly taskId?: TaskId | undefined;
  readonly runId?: RunId | undefined;
  readonly evaluator: EvaluatorIdentity;
  readonly rubricId: string;
  readonly rubricVersion: number;
  readonly scores: readonly CriterionScore[];
  readonly findings: readonly Finding[];
  readonly overall: EvaluationOutcome;
  readonly createdAt: IsoTimestamp;
  readonly evidenceHash?: string | undefined;
  /** What was evaluated, at which version. */
  readonly target?: EvaluationTarget | undefined;
  /** Relationship to other evaluations of the same work. */
  readonly independenceClass?: IndependenceClass | undefined;
}
