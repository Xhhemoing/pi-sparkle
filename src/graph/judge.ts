import { DomainValidationError } from "../domain/errors.js";
import { isEvidenceId, isTaskId, type EvidenceId, type TaskId } from "../domain/ids.js";
import { isRecord } from "../domain/record.js";
import type { TaskNode } from "../domain/task.js";
import type { VerificationResult } from "../protocol/v1.js";

export const JUDGE_VERDICTS = ["APPROVED", "REJECTED", "NEEDS_USER_DECISION"] as const;
export type JudgeVerdict = (typeof JUDGE_VERDICTS)[number];

export interface JudgeDecision {
  taskId: TaskId;
  verdict: JudgeVerdict;
  evidenceIds: EvidenceId[];
  reason?: string;
}

export interface JudgeInput {
  taskId: TaskId;
  task?: TaskNode;
  verification: VerificationResult;
  evidenceIds: EvidenceId[];
}

export interface JudgeAdapter {
  decide(input: JudgeInput): JudgeDecision;
}

function decisionError(value: unknown): string | undefined {
  if (!isRecord(value)) return "expected an object";
  if (!isTaskId(value.taskId)) return "taskId must be a valid TaskId";
  if (!(JUDGE_VERDICTS as readonly string[]).includes(String(value.verdict))) {
    return "verdict must be a known JudgeVerdict";
  }
  if (!Array.isArray(value.evidenceIds) || !value.evidenceIds.every(isEvidenceId)) {
    return "evidenceIds must be an array of EvidenceIds";
  }
  if (value.reason !== undefined && (typeof value.reason !== "string" || value.reason.trim() === "")) {
    return "reason must be a non-empty string";
  }
  return undefined;
}

export function isJudgeDecision(value: unknown): value is JudgeDecision {
  return decisionError(value) === undefined;
}

export function validateJudgeDecision(value: unknown): JudgeDecision {
  const reason = decisionError(value);
  if (reason !== undefined) {
    throw new DomainValidationError(`Invalid JudgeDecision: ${reason}`);
  }
  return value as JudgeDecision;
}

/**
 * Deterministic judge: PASSED verification with evidence approves; FAILED
 * rejects; UNOBSERVED (or missing evidence for criteria) needs a user
 * decision. It can only reference evidence it was given.
 */
export class DeterministicJudge implements JudgeAdapter {
  decide(input: JudgeInput): JudgeDecision {
    const evidenceIds = input.evidenceIds.filter((id) => input.verification.evidenceIds.includes(id));
    switch (input.verification.kind) {
      case "PASSED":
        return { taskId: input.taskId, verdict: "APPROVED", evidenceIds };
      case "FAILED":
        return { taskId: input.taskId, verdict: "REJECTED", evidenceIds };
      case "UNOBSERVED":
        return { taskId: input.taskId, verdict: "NEEDS_USER_DECISION", evidenceIds };
    }
  }
}
