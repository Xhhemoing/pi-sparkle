import type { EpisodeId, RunId, TaskId } from "../domain/ids.js";
import type { IsoTimestamp } from "../domain/timestamp.js";

export type EvaluationOutcome = "PASS" | "FAIL" | "ABSTAIN" | "UNOBSERVED";

export type EvaluatorKind = "deterministic" | "human" | "inferential";

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
}

export interface EvaluationPrecedence {
  readonly deterministic: 3;
  readonly human: 2;
  readonly inferential: 1;
}

export const EVALUATION_PRECEDENCE: EvaluationPrecedence = {
  deterministic: 3,
  human: 2,
  inferential: 1,
} as const;
