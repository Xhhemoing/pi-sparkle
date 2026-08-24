import { DomainValidationError } from "../domain/errors.js";
import {
  DEFAULT_COMPARISON_REPORT_CONFIG,
  type ComparisonReport,
  type ComparisonReportConfig,
  type PairedEvaluationRecord,
} from "../experiments/comparison-report.js";
import {
  gatedComparisonReport,
  stripImprovementClaims,
} from "../experiments/gated-comparison.js";
import type { ModelDescriptor } from "./capability-registry.js";
import type { OutcomeObservation } from "./outcomes.js";
import type { RouteRequest } from "./policy.js";
import { routeR0, type R0Config, type R0Decision } from "./r0.js";
import { routeR1 } from "./r1.js";

const SIMULATION_COMPARISON_CONFIG: ComparisonReportConfig = {
  ...DEFAULT_COMPARISON_REPORT_CONFIG,
  evidenceClass: "simulation",
};

const SIMULATION_CLAIM = "仿真证据";

export interface FrozenR1ShadowEpisode {
  readonly episodeHash: string;
  readonly taskFamily: string;
  readonly role: string;
  readonly request: RouteRequest;
  readonly taskSuccess: "PASS" | "FAIL" | "UNOBSERVED";
  /** Frozen per-episode posterior inputs. Not carried into the next episode. */
  readonly observations?: readonly OutcomeObservation[];
}

export interface R1ShadowReportInput {
  readonly episodes: readonly FrozenR1ShadowEpisode[];
  readonly models: readonly ModelDescriptor[];
  readonly r0Config: R0Config;
  readonly featureVersion: string;
  readonly nowMs: number;
  /** Frozen shared posterior inputs for every episode. */
  readonly observations?: readonly OutcomeObservation[];
  readonly claims?: readonly string[];
  readonly qualityFloor?: number | undefined;
  readonly hysteresisMargin?: number | undefined;
  readonly previousModelId?: string | undefined;
}

export interface R1ShadowPair {
  readonly episodeHash: string;
  readonly taskFamily: string;
  readonly r0ModelId: string | undefined;
  readonly r1ModelId: string | undefined;
  readonly r1Fallback: boolean;
  readonly invoked: false;
}

export interface R1ShadowReport {
  readonly comparison: ComparisonReport;
  readonly pairs: readonly R1ShadowPair[];
}

/**
 * Offline paired R0 vs R1 shadow report over frozen episodes.
 * Live coordinators must not import this module.
 */
export function buildR1ShadowReport(input: R1ShadowReportInput): R1ShadowReport {
  if (input.episodes.length === 0) {
    throw new DomainValidationError("R1 shadow report requires at least one frozen episode");
  }

  const pairs: R1ShadowPair[] = [];
  const records: PairedEvaluationRecord[] = [];
  const sharedObservations = input.observations ?? [];

  for (const episode of input.episodes) {
    if (episode.episodeHash.trim() === "" || episode.taskFamily.trim() === "") {
      throw new DomainValidationError("frozen episode requires episodeHash and taskFamily");
    }
    const request: RouteRequest = {
      ...episode.request,
      taskFamily: episode.taskFamily,
    };
    const r0 = routeR0(input.r0Config, input.models, request);
    const observations = [...sharedObservations, ...(episode.observations ?? [])];
    const r1 = routeR1({
      r0,
      role: episode.role,
      featureVersion: input.featureVersion,
      models: input.models,
      observations,
      nowMs: input.nowMs,
      qualityFloor: input.qualityFloor,
      hysteresisMargin: input.hysteresisMargin,
      previousModelId: input.previousModelId,
    });
    if (r0.exploratory !== false || r1.exploratory !== false) {
      throw new DomainValidationError("R1 shadow report forbids exploratory routing");
    }
    pairs.push({
      episodeHash: episode.episodeHash,
      taskFamily: episode.taskFamily,
      r0ModelId: r0.selection,
      r1ModelId: r1.selection,
      r1Fallback: r1.fallback,
      invoked: false,
    });

    if (episode.taskSuccess !== "PASS" && episode.taskSuccess !== "FAIL") {
      continue;
    }
    if (r0.selection === undefined || r1.selection === undefined) {
      continue;
    }
    const utility = episode.taskSuccess === "PASS" ? 1 : 0;
    records.push({
      episodeHash: episode.episodeHash,
      taskFamily: episode.taskFamily,
      baselineUtility: utility,
      candidateUtility: utility,
      baselineCostUsd: selectedCost(r0, r0.selection),
      candidateCostUsd: selectedCost(r0, r1.selection),
    });
  }

  if (records.length === 0) {
    throw new DomainValidationError(
      "R1 shadow report requires at least one episode with recorded PASS or FAIL"
    );
  }

  return {
    comparison: gatedComparison(records, sanitizeClaims(input.claims)),
    pairs,
  };
}

function sanitizeClaims(claims: readonly string[] | undefined): readonly string[] {
  return stripImprovementClaims(claims ?? [SIMULATION_CLAIM]);
}

function selectedCost(r0: R0Decision, modelId: string): number {
  const row = r0.candidates.find((candidate) => candidate.modelId === modelId);
  if (row === undefined) {
    throw new DomainValidationError(`selected model ${modelId} is not in the R0 catalog`);
  }
  return row.estimatedCostUsd;
}

function gatedComparison(
  records: readonly PairedEvaluationRecord[],
  claims: readonly string[]
): ComparisonReport {
  return gatedComparisonReport({
    records,
    claims,
    config: SIMULATION_COMPARISON_CONFIG,
    difficultyTier: "simulation",
  });
}
