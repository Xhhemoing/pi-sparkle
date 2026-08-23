import { DomainValidationError } from "../domain/errors.js";

/**
 * Phase C Task 1: shared offline observation schema for attribution
 * estimators. `y` is taskSuccess only — a tracking score or any non-binary
 * value must fail closed here, never enter an optimization dataset.
 */
export interface OfflineRow {
  /** taskFamily|role */
  readonly scenarioId: string;
  readonly modelVersion: string;
  readonly projectId: string;
  readonly y: 0 | 1;
  readonly occurredAtMs: number;
}

export interface AttributionEffect {
  readonly name: string;
  readonly point: number;
  readonly lcb: number;
  readonly ucb: number;
}

export type AttributionLabel =
  | "scenario-hard"
  | "model-problem"
  | "project-problem"
  | "interaction-only"
  | "uncertain";

export interface AttributionReport {
  readonly estimator: "logit-additive" | "probability-additive";
  readonly rowsUsed: number;
  readonly effects: readonly AttributionEffect[];
  readonly diagnosis: AttributionLabel;
  readonly reason: string;
  readonly writesActivePointer: false;
}

export function parseOfflineRow(value: unknown): OfflineRow {
  if (typeof value !== "object" || value === null) {
    throw new DomainValidationError("offline row must be an object");
  }
  const row = value as Record<string, unknown>;
  for (const key of ["scenarioId", "modelVersion", "projectId"] as const) {
    if (typeof row[key] !== "string" || (row[key] as string).trim() === "") {
      throw new DomainValidationError(`offline row ${key} must be a non-empty string`);
    }
  }
  // taskSuccess only: exactly 0 or 1. A tracking score (e.g. 0.41) fails closed.
  if (row.y !== 0 && row.y !== 1) {
    throw new DomainValidationError("offline row y must be exactly 0 or 1 (taskSuccess), not a score");
  }
  if (typeof row.occurredAtMs !== "number" || !Number.isFinite(row.occurredAtMs) || row.occurredAtMs < 0) {
    throw new DomainValidationError("offline row occurredAtMs must be a finite non-negative number");
  }
  return {
    scenarioId: row.scenarioId as string,
    modelVersion: row.modelVersion as string,
    projectId: row.projectId as string,
    y: row.y,
    occurredAtMs: row.occurredAtMs
  };
}
