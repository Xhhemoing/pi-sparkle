import { DomainValidationError } from "../domain/errors.js";

export type OutcomeKind = "PASS" | "FAIL" | "ABSTAIN" | "UNOBSERVED";

export const OUTCOME_CRITERIA = [
  "taskSuccess",
  "policyCompliance",
  "userAcceptance",
  "cost",
  "latency",
  "rework"
] as const;
export type OutcomeCriterion = (typeof OUTCOME_CRITERIA)[number];

export type FailureClass = "model" | "contract" | "tool" | "environment" | "run";

export interface OutcomeObservation {
  readonly taskFamily: string;
  readonly role: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly featureVersion: string;
  readonly criterion: OutcomeCriterion;
  readonly outcome: OutcomeKind;
  readonly occurredAtMs: number;
  readonly source?: "deterministic-check" | "human" | "peer" | undefined;
  readonly failureClass?: FailureClass | undefined;
  readonly taskId?: string | undefined;
  readonly runId?: string | undefined;
  readonly evidenceIds?: readonly string[] | undefined;
}

export interface OutcomeKeyParts {
  readonly taskFamily: string;
  readonly role: string;
  readonly modelVersion: string;
  readonly featureVersion: string;
}

/** Estimates are keyed by task family, role, model version, and feature version. */
export function outcomeKey(parts: OutcomeKeyParts): string {
  return `${parts.taskFamily}|${parts.role}|${parts.modelVersion}|${parts.featureVersion}`;
}

const OUTCOME_KINDS: readonly OutcomeKind[] = ["PASS", "FAIL", "ABSTAIN", "UNOBSERVED"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseOutcomeObservation(value: unknown): OutcomeObservation {
  if (!isRecord(value)) {
    throw new DomainValidationError("outcome observation must be an object");
  }
  if (typeof value.criterion !== "string" || !(OUTCOME_CRITERIA as readonly string[]).includes(value.criterion)) {
    throw new DomainValidationError("outcome observation criterion is required");
  }
  if (typeof value.outcome !== "string" || !(OUTCOME_KINDS as readonly string[]).includes(value.outcome)) {
    throw new DomainValidationError("outcome observation outcome is invalid");
  }
  if (
    typeof value.taskFamily !== "string" ||
    typeof value.role !== "string" ||
    typeof value.modelId !== "string" ||
    typeof value.modelVersion !== "string" ||
    typeof value.featureVersion !== "string" ||
    typeof value.occurredAtMs !== "number"
  ) {
    throw new DomainValidationError("outcome observation is missing required fields");
  }
  if (value.criterion === "taskSuccess" && value.source !== "deterministic-check") {
    throw new DomainValidationError("taskSuccess requires source deterministic-check");
  }
  const failureClasses = ["model", "contract", "tool", "environment", "run"];
  if (value.failureClass !== undefined &&
      (typeof value.failureClass !== "string" || !failureClasses.includes(value.failureClass))) {
    throw new DomainValidationError("outcome observation failureClass is invalid");
  }
  return {
    taskFamily: value.taskFamily,
    role: value.role,
    modelId: value.modelId,
    modelVersion: value.modelVersion,
    featureVersion: value.featureVersion,
    criterion: value.criterion as OutcomeCriterion,
    outcome: value.outcome as OutcomeKind,
    occurredAtMs: value.occurredAtMs,
    ...(typeof value.source === "string"
      ? { source: value.source as OutcomeObservation["source"] }
      : {}),
    ...(typeof value.failureClass === "string" ? { failureClass: value.failureClass as FailureClass } : {}),
    ...(typeof value.taskId === "string" ? { taskId: value.taskId } : {}),
    ...(typeof value.runId === "string" ? { runId: value.runId } : {}),
    ...(Array.isArray(value.evidenceIds)
      ? { evidenceIds: value.evidenceIds.filter((id): id is string => typeof id === "string") }
      : {})
  };
}

/** ABSTAIN and UNOBSERVED are not evidence — they must not become failures or zeros. */
export function isInformativeOutcome(observation: OutcomeObservation): boolean {
  return observation.outcome === "PASS" || observation.outcome === "FAIL";
}

/** Production R1 consumes only attributed model taskSuccess PASS/FAIL. */
export function observationsForR1(
  observations: readonly OutcomeObservation[]
): OutcomeObservation[] {
  return observations.filter((row) => {
    if (row.criterion !== "taskSuccess" || !isInformativeOutcome(row)) return false;
    if (row.source !== "deterministic-check") return false;
    if (row.outcome === "FAIL" && row.failureClass !== "model") return false;
    return true;
  });
}
