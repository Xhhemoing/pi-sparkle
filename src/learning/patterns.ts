import type { EpisodeSignature, EpisodeSignatureKind } from "./signatures.js";
import { findNegativeControlMarker } from "./attribution.js";

export interface Pattern {
  readonly key: string;
  readonly kind: EpisodeSignatureKind;
  readonly count: number;
  readonly avgSimilarity: number;
  readonly negativeControl: boolean;
  readonly boundary: string;
}

export interface PatternDetectorOptions {
  readonly minCount?: number;
  readonly minSimilarity?: number;
}

const DEFAULT_MIN_COUNT = 2;
const DEFAULT_MIN_SIM = 0.6;

export function detectRepeatedPatterns(
  signatures: readonly EpisodeSignature[],
  options: PatternDetectorOptions = {}
): Pattern[] {
  const minCount = options.minCount ?? DEFAULT_MIN_COUNT;
  const minSim = options.minSimilarity ?? DEFAULT_MIN_SIM;

  const byKind = new Map<EpisodeSignatureKind, EpisodeSignature[]>();
  for (const sig of signatures) {
    const arr = byKind.get(sig.kind) ?? [];
    arr.push(sig);
    byKind.set(sig.kind, arr);
  }

  const patterns: Pattern[] = [];

  byKind.forEach((sigs, kind) => {
    if (sigs.length < minCount) return;

    const clusters = clusterSignatures(sigs, minSim);
    clusters.forEach((cluster, idx) => {
      if (cluster.length >= minCount) {
        patterns.push({
          key: `${kind}:cluster-${idx}`,
          kind,
          count: cluster.length,
          avgSimilarity: averageSimilarity(cluster),
          // Negative controls come from the signatures' own features, never
          // from the cluster key: a uniform benign-cause marker (read-only
          // noise, missing instrumentation, gate block, unrelated failure)
          // demotes the pattern so it cannot surface as an improvement.
          negativeControl: findNegativeControlMarker(cluster) !== undefined,
          boundary: kind,
        });
      }
    });
  });

  return patterns;
}

function clusterSignatures(
  sigs: EpisodeSignature[],
  threshold: number
): EpisodeSignature[][] {
  const clusters: EpisodeSignature[][] = [];
  const used = new Set<number>();

  for (let i = 0; i < sigs.length; i++) {
    if (used.has(i)) continue;
    const cluster: EpisodeSignature[] = [sigs[i]!];
    used.add(i);

    for (let j = i + 1; j < sigs.length; j++) {
      if (used.has(j)) continue;
      const sim = computeFeatureSim(sigs[i]!, sigs[j]!);
      if (sim >= threshold) {
        cluster.push(sigs[j]!);
        used.add(j);
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

function computeFeatureSim(a: EpisodeSignature, b: EpisodeSignature): number {
  const keySet = new Set<string>();
  Object.keys(a.features).forEach((k) => keySet.add(k));
  Object.keys(b.features).forEach((k) => keySet.add(k));
  const keys: string[] = [];
  keySet.forEach((k) => keys.push(k));
  let matches = 0;
  for (const k of keys) {
    if (a.features[k] === b.features[k]) matches++;
  }
  return keys.length > 0 ? matches / keys.length : 0;
}

function averageSimilarity(cluster: EpisodeSignature[]): number {
  if (cluster.length < 2) return 1.0;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < cluster.length; i++) {
    for (let j = i + 1; j < cluster.length; j++) {
      sum += computeFeatureSim(cluster[i]!, cluster[j]!);
      n++;
    }
  }
  return n > 0 ? sum / n : 1.0;
}
