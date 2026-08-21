import { DomainValidationError } from "../domain/errors.js";
import type { ModelDescriptor } from "../routing/capability-registry.js";
import { observationsForR1, type OutcomeObservation } from "../routing/outcomes.js";
import type { RouteRequest } from "../routing/policy.js";
import type { R0Config } from "../routing/r0.js";
import {
  buildR1ShadowReport,
  type FrozenR1ShadowEpisode,
  type R1ShadowPair,
} from "../routing/r1-shadow-report.js";
import type { ComparisonReport } from "./comparison-report.js";
import {
  validateSealedDatasetManifest,
  type SealedDatasetManifest,
} from "./dataset.js";
import type { HoldoutAccessEntry, HoldoutVault } from "./holdout.js";

const MIN_PAIRED_SAMPLES = 5;
const HOLDOUT_ACCESS_PURPOSE = "paired-simulation-holdout-evaluation";

export interface SimulationHoldoutEpisode {
  readonly episodeHash: string;
  readonly taskFamily: string;
  readonly role: string;
  readonly request: RouteRequest;
  readonly taskSuccess: "PASS" | "FAIL" | "UNOBSERVED";
  /** Historically observed model for this episode. Used for train posterior only. */
  readonly observedModelId: string;
  readonly observedModelVersion: string;
}

export interface SimulationHoldoutOpeAppendix {
  readonly role: "appendix";
  readonly validImprovementEstimate: false;
  readonly invalidReason: "INVALID_ESTIMATE";
  readonly payload: unknown;
}

export interface SimulationHoldoutProtocol {
  readonly design: "paired";
  readonly evidenceClass: "simulation";
  readonly minPairedSamples: 5;
  readonly trainEpisodeCount: number;
  readonly holdoutEpisodeCount: number;
  readonly canCloseProductionCheckpointF: false;
}

export interface SimulationHoldoutInput {
  readonly train?: readonly SimulationHoldoutEpisode[];
  readonly holdout?: readonly SimulationHoldoutEpisode[];
  readonly episodes?: readonly SimulationHoldoutEpisode[];
  readonly manifest?: SealedDatasetManifest;
  readonly models: readonly ModelDescriptor[];
  readonly r0Config: R0Config;
  readonly featureVersion: string;
  readonly nowMs: number;
  readonly claims?: readonly string[] | undefined;
  readonly qualityFloor?: number | undefined;
  readonly hysteresisMargin?: number | undefined;
  readonly previousModelId?: string | undefined;
  readonly vault?: HoldoutVault | undefined;
  readonly holdoutDatasetId?: string | undefined;
  readonly opeAppendix?: unknown;
}

export interface SimulationHoldoutResult {
  readonly comparison: ComparisonReport;
  readonly pairs: readonly R1ShadowPair[];
  readonly protocol: SimulationHoldoutProtocol;
  readonly opeAppendix?: SimulationHoldoutOpeAppendix;
  readonly holdoutAudit?: readonly HoldoutAccessEntry[];
}

/**
 * Paired R0 vs R1 simulation holdout. Train updates the frozen R1 posterior;
 * holdout is evaluate-only. Live coordinators must not import this module.
 */
export function runSimulationHoldout(input: SimulationHoldoutInput): SimulationHoldoutResult {
  const { train, holdout } = resolveSplit(input);
  const holdoutAudit = auditHoldoutAccess(input.vault, input.holdoutDatasetId);
  const trainObservations = observationsFromTrain(train, input.featureVersion, input.nowMs);
  const frozenHoldout = holdout.map(toFrozenEpisode);
  const shadow = buildR1ShadowReport({
    episodes: frozenHoldout,
    models: input.models,
    r0Config: input.r0Config,
    featureVersion: input.featureVersion,
    nowMs: input.nowMs,
    observations: trainObservations,
    ...(input.claims !== undefined ? { claims: input.claims } : {}),
    ...(input.qualityFloor !== undefined ? { qualityFloor: input.qualityFloor } : {}),
    ...(input.hysteresisMargin !== undefined ? { hysteresisMargin: input.hysteresisMargin } : {}),
    ...(input.previousModelId !== undefined ? { previousModelId: input.previousModelId } : {}),
  });

  const result: SimulationHoldoutResult = {
    comparison: shadow.comparison,
    pairs: shadow.pairs,
    protocol: {
      design: "paired",
      evidenceClass: "simulation",
      minPairedSamples: MIN_PAIRED_SAMPLES,
      trainEpisodeCount: train.length,
      holdoutEpisodeCount: holdout.length,
      canCloseProductionCheckpointF: false,
    },
  };
  if (input.opeAppendix !== undefined) {
    return {
      ...result,
      opeAppendix: wrapOpeAppendix(input.opeAppendix),
      ...(holdoutAudit !== undefined ? { holdoutAudit } : {}),
    };
  }
  return holdoutAudit !== undefined ? { ...result, holdoutAudit } : result;
}

function resolveSplit(input: SimulationHoldoutInput): {
  train: readonly SimulationHoldoutEpisode[];
  holdout: readonly SimulationHoldoutEpisode[];
} {
  if (input.train !== undefined && input.holdout !== undefined) {
    assertExplicitSplit(input.train, input.holdout);
    return { train: input.train, holdout: input.holdout };
  }
  if (input.episodes !== undefined && input.manifest !== undefined) {
    return splitFromManifest(input.episodes, input.manifest);
  }
  throw new DomainValidationError(
    "simulation holdout requires an explicit train/holdout split or a sealed manifest"
  );
}

function assertExplicitSplit(
  train: readonly SimulationHoldoutEpisode[],
  holdout: readonly SimulationHoldoutEpisode[]
): void {
  if (train.length === 0) {
    throw new DomainValidationError("simulation holdout train split must not be empty");
  }
  if (holdout.length === 0) {
    throw new DomainValidationError("simulation holdout holdout split must not be empty");
  }
  const trainHashes = new Set<string>();
  for (const episode of train) {
    requireHash(episode.episodeHash, "train");
    if (trainHashes.has(episode.episodeHash)) {
      throw new DomainValidationError(`duplicate train episode ${episode.episodeHash}`);
    }
    trainHashes.add(episode.episodeHash);
  }
  for (const episode of holdout) {
    requireHash(episode.episodeHash, "holdout");
    if (trainHashes.has(episode.episodeHash)) {
      throw new DomainValidationError(
        `contamination: episode ${episode.episodeHash} appears in train and holdout`
      );
    }
  }
}

function splitFromManifest(
  episodes: readonly SimulationHoldoutEpisode[],
  manifest: SealedDatasetManifest
): {
  train: readonly SimulationHoldoutEpisode[];
  holdout: readonly SimulationHoldoutEpisode[];
} {
  validateSealedDatasetManifest(manifest);
  const byHash = new Map<string, SimulationHoldoutEpisode>();
  for (const episode of episodes) {
    requireHash(episode.episodeHash, "episodes");
    if (byHash.has(episode.episodeHash)) {
      throw new DomainValidationError(`duplicate episode ${episode.episodeHash}`);
    }
    byHash.set(episode.episodeHash, episode);
  }
  const train = lookupSplit(byHash, manifest.splits.train, "train");
  const holdout = lookupSplit(byHash, manifest.splits.holdout, "holdout");
  assertExplicitSplit(train, holdout);
  return { train, holdout };
}

function lookupSplit(
  byHash: ReadonlyMap<string, SimulationHoldoutEpisode>,
  hashes: readonly string[],
  label: string
): SimulationHoldoutEpisode[] {
  const rows: SimulationHoldoutEpisode[] = [];
  for (const hash of hashes) {
    const episode = byHash.get(hash);
    if (episode === undefined) {
      throw new DomainValidationError(`missing episode ${hash} for ${label} split`);
    }
    rows.push(episode);
  }
  return rows;
}

function requireHash(hash: string, label: string): void {
  if (hash.trim() === "") {
    throw new DomainValidationError(`${label} episode hash is required`);
  }
}

function observationsFromTrain(
  train: readonly SimulationHoldoutEpisode[],
  featureVersion: string,
  nowMs: number
): OutcomeObservation[] {
  const rows: OutcomeObservation[] = [];
  for (const episode of train) {
    if (episode.taskSuccess !== "PASS" && episode.taskSuccess !== "FAIL") {
      continue;
    }
    if (episode.observedModelId.trim() === "" || episode.observedModelVersion.trim() === "") {
      throw new DomainValidationError(
        `train episode ${episode.episodeHash} requires observedModelId and observedModelVersion`
      );
    }
    rows.push({
      taskFamily: episode.taskFamily,
      role: episode.role,
      modelId: episode.observedModelId,
      modelVersion: episode.observedModelVersion,
      featureVersion,
      criterion: "taskSuccess",
      outcome: episode.taskSuccess,
      occurredAtMs: nowMs,
      source: "deterministic-check",
      failureClass: "model",
    });
  }
  return observationsForR1(rows);
}

function toFrozenEpisode(episode: SimulationHoldoutEpisode): FrozenR1ShadowEpisode {
  return {
    episodeHash: episode.episodeHash,
    taskFamily: episode.taskFamily,
    role: episode.role,
    request: episode.request,
    taskSuccess: episode.taskSuccess,
  };
}

function auditHoldoutAccess(
  vault: HoldoutVault | undefined,
  datasetId: string | undefined
): readonly HoldoutAccessEntry[] | undefined {
  if (vault === undefined) {
    return undefined;
  }
  if (datasetId === undefined || datasetId.trim() === "") {
    throw new DomainValidationError("holdout vault access requires holdoutDatasetId");
  }
  try {
    vault.state(datasetId);
  } catch {
    vault.register(datasetId);
  }
  return vault.access(datasetId, HOLDOUT_ACCESS_PURPOSE);
}

function wrapOpeAppendix(payload: unknown): SimulationHoldoutOpeAppendix {
  return {
    role: "appendix",
    validImprovementEstimate: false,
    invalidReason: "INVALID_ESTIMATE",
    payload,
  };
}
