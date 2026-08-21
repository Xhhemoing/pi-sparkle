import { DomainValidationError } from "../domain/errors.js";

/**
 * Non-dominated retention over quality, preference, cost, latency, and risk.
 *
 * Maximize quality and preferenceFit; minimize costUsd, latencyMs, and risk.
 * The front is not a single winner: incomparable local optima coexist. This
 * ranking does not claim Outcome-supported improvement.
 */

export interface CandidateMetrics {
  readonly candidateId: string;
  readonly quality: number;
  readonly preferenceFit: number;
  readonly costUsd: number;
  readonly latencyMs: number;
  readonly risk: number;
}

export function paretoFront(points: readonly CandidateMetrics[]): CandidateMetrics[] {
  if (!Array.isArray(points)) {
    throw new DomainValidationError("pareto points must be an array");
  }
  if (points.length === 0) {
    return [];
  }
  for (const point of points) {
    validateCandidateMetrics(point);
  }
  const front = points.filter(
    (point, index) =>
      !points.some((other, otherIndex) => otherIndex !== index && dominates(other, point))
  );
  return [...front].sort(compareCandidateId);
}

function dominates(a: CandidateMetrics, b: CandidateMetrics): boolean {
  const geMax = a.quality >= b.quality && a.preferenceFit >= b.preferenceFit;
  const leMin = a.costUsd <= b.costUsd && a.latencyMs <= b.latencyMs && a.risk <= b.risk;
  const strict =
    a.quality > b.quality ||
    a.preferenceFit > b.preferenceFit ||
    a.costUsd < b.costUsd ||
    a.latencyMs < b.latencyMs ||
    a.risk < b.risk;
  return geMax && leMin && strict;
}

function compareCandidateId(a: CandidateMetrics, b: CandidateMetrics): number {
  if (a.candidateId < b.candidateId) {
    return -1;
  }
  if (a.candidateId > b.candidateId) {
    return 1;
  }
  return 0;
}

function validateCandidateMetrics(point: CandidateMetrics): void {
  if (typeof point !== "object" || point === null) {
    throw new DomainValidationError("candidate metrics are required");
  }
  if (typeof point.candidateId !== "string" || point.candidateId.trim() === "") {
    throw new DomainValidationError("candidateId is required");
  }
  assertUnitInterval(point.quality, "quality");
  assertUnitInterval(point.preferenceFit, "preferenceFit");
  assertUnitInterval(point.risk, "risk");
  assertNonNegativeFinite(point.costUsd, "costUsd");
  assertNonNegativeFinite(point.latencyMs, "latencyMs");
}

function assertUnitInterval(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new DomainValidationError(`${label} must be a finite number in [0, 1]`);
  }
}

function assertNonNegativeFinite(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new DomainValidationError(`${label} must be a finite number >= 0`);
  }
}
