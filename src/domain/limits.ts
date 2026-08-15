import { DomainValidationError } from "./errors.js";

export interface RunLimits {
  maxTasks: number;
  maxConcurrentTasks: number;
  maxAttemptsPerTask: number;
  maxRounds: number;
  maxConsecutiveStalls: number;
  maxWallTimeMs: number;
  maxCostUsd?: number;
  minHumanConfidence?: number;
}

export function defaultRunLimits(): RunLimits {
  return {
    maxTasks: 16,
    maxConcurrentTasks: 2,
    maxAttemptsPerTask: 3,
    maxRounds: 32,
    maxConsecutiveStalls: 3,
    maxWallTimeMs: 3_600_000
  };
}

const REQUIRED_INT_FIELDS = [
  "maxTasks",
  "maxConcurrentTasks",
  "maxAttemptsPerTask",
  "maxRounds",
  "maxConsecutiveStalls",
  "maxWallTimeMs"
] as const;

function limitsError(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) {
    return "expected an object";
  }
  const record = value as Record<string, unknown>;
  for (const field of REQUIRED_INT_FIELDS) {
    const n = record[field];
    if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) {
      return `${field} must be a positive integer`;
    }
  }
  const maxTasks = record.maxTasks as number;
  const maxConcurrentTasks = record.maxConcurrentTasks as number;
  if (maxConcurrentTasks > maxTasks) {
    return `maxConcurrentTasks (${maxConcurrentTasks}) exceeds maxTasks (${maxTasks})`;
  }
  const maxCostUsd = record.maxCostUsd;
  if (maxCostUsd !== undefined) {
    if (typeof maxCostUsd !== "number" || !Number.isFinite(maxCostUsd) || maxCostUsd <= 0) {
      return "maxCostUsd must be a positive number";
    }
  }
  const minHumanConfidence = record.minHumanConfidence;
  if (
    minHumanConfidence !== undefined &&
    (typeof minHumanConfidence !== "number" ||
      !Number.isFinite(minHumanConfidence) ||
      minHumanConfidence < 0 ||
      minHumanConfidence > 1)
  ) {
    return "minHumanConfidence must be a finite number between 0 and 1";
  }
  return undefined;
}

export function isRunLimits(value: unknown): value is RunLimits {
  return limitsError(value) === undefined;
}

export function validateRunLimits(value: unknown): RunLimits {
  const reason = limitsError(value);
  if (reason !== undefined) {
    throw new DomainValidationError(`Invalid RunLimits: ${reason}`);
  }
  return value as RunLimits;
}
