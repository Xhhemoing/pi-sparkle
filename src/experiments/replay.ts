import { DomainValidationError } from "../domain/errors.js";
import { manifestHash, stableStringify } from "./manifest.js";
import type { DatasetManifest } from "./manifest.js";
import { hash32 } from "../domain/hash.js";
import type { RouteRequest } from "../routing/policy.js";

export interface FrozenEpisode {
  readonly episodeHash: string;
  readonly request: RouteRequest;
  readonly role: string;
  readonly featureVersion: string;
  /** The live workspace this episode originated from — replay must never write there. */
  readonly originalWorkspace: string;
}

export interface RoutingPolicy {
  readonly policyVersion: string;
  /** Eligible model ids in deterministic tier order. */
  readonly eligibleFor: (episode: FrozenEpisode) => readonly string[];
  /** Propensity this policy assigns to each eligible model. */
  readonly propensityFor: (episode: FrozenEpisode, modelId: string) => number;
  /** Deterministic selection given a seeded rng in [0, 1). */
  readonly select: (episode: FrozenEpisode, rng: () => number) => string;
}

export interface ReplayAction {
  readonly episodeHash: string;
  readonly modelId: string;
  readonly propensity: number;
  readonly eligible: readonly string[];
  /** Propensity for every eligible action — the off-policy ledger. */
  readonly propensities: readonly {
    readonly modelId: string;
    readonly propensity: number;
  }[];
}

export interface ReplayResult {
  readonly manifestHash: string;
  /** Hash over the manifest and every action — byte-stable for a frozen rerun. */
  readonly rerunHash: string;
  readonly actions: readonly ReplayAction[];
  readonly policyVersion: string;
  readonly seed: number;
}

/** Deterministic seeded PRNG (mulberry32). */
export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Replay a frozen dataset through a routing policy. The output directory must
 * be isolated from every original workspace — replay may only produce new
 * artifacts and never touch live pointers.
 */
export function replayPolicy(
  manifest: DatasetManifest,
  episodes: readonly FrozenEpisode[],
  policy: RoutingPolicy,
  outputRoot: string
): ReplayResult {
  assertIsolatedOutput(episodes, outputRoot);

  const byHash = new Map<string, FrozenEpisode>();
  for (const episode of episodes) {
    byHash.set(episode.episodeHash, episode);
  }

  const rng = createSeededRng(manifest.seed);
  const orderedHashes = [...manifest.episodeHashes].filter((h) => !manifest.exclusions.includes(h));
  const actions: ReplayAction[] = [];

  for (const hash of orderedHashes) {
    const episode = byHash.get(hash);
    if (episode === undefined) {
      throw new DomainValidationError(`manifest references missing episode: ${hash}`);
    }
    const eligible = policy.eligibleFor(episode);
    const selected = policy.select(episode, rng);
    if (!eligible.includes(selected)) {
      throw new DomainValidationError(
        `policy selected ${selected} outside the eligible set for ${hash}`
      );
    }
    const propensity = policy.propensityFor(episode, selected);
    const propensities = eligible.map((modelId) => ({
      modelId,
      propensity: policy.propensityFor(episode, modelId),
    }));
    actions.push({ episodeHash: hash, modelId: selected, propensity, eligible, propensities });
  }

  const rerunHash = `rr_${stableStringify({ actions, manifestHash: manifestHash(manifest) })}`;
  return {
    manifestHash: manifestHash(manifest),
    rerunHash: hash32(rerunHash),
    actions,
    policyVersion: policy.policyVersion,
    seed: manifest.seed,
  };
}

export function assertIsolatedOutput(
  episodes: readonly FrozenEpisode[],
  outputRoot: string
): void {
  const normalizedOutput = outputRoot.replace(/\/+$/, "");
  for (const episode of episodes) {
    const workspace = episode.originalWorkspace.replace(/\/+$/, "");
    if (normalizedOutput === workspace || normalizedOutput.startsWith(`${workspace}/`)) {
      throw new DomainValidationError(
        `replay output ${outputRoot} overlaps original workspace ${episode.originalWorkspace}`
      );
    }
  }
}
