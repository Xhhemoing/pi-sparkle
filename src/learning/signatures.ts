import type { EpisodeId } from "../domain/ids.js";
import type { IsoTimestamp } from "../domain/timestamp.js";
import { hash32 } from "../domain/hash.js";
import { nowIso } from "../domain/timestamp.js";

export type EpisodeSignatureKind =
  | "contract"
  | "context"
  | "plan"
  | "route"
  | "execution"
  | "tool"
  | "review"
  | "delivery";

export interface EpisodeSignature {
  readonly episodeId: EpisodeId;
  readonly kind: EpisodeSignatureKind;
  readonly hash: string;
  readonly features: Record<string, number | string | boolean>;
  readonly createdAt: IsoTimestamp;
}

export interface ComparableEpisodePair {
  readonly a: EpisodeSignature;
  readonly b: EpisodeSignature;
  readonly similarity: number;
}

export function createSignature(
  episodeId: EpisodeId,
  kind: EpisodeSignatureKind,
  features: Record<string, number | string | boolean>
): EpisodeSignature {
  const hash = hash32(JSON.stringify({ kind, features }));
  return {
    episodeId,
    kind,
    hash,
    features,
    createdAt: nowIso(),
  };
}

export function compareSignatures(
  a: EpisodeSignature,
  b: EpisodeSignature
): number {
  if (a.kind !== b.kind) return 0;
  if (a.hash === b.hash) return 1.0;

  const keysA = Object.keys(a.features);
  const keysB = Object.keys(b.features);
  const keySet = new Set<string>();
  for (const k of keysA) keySet.add(k);
  for (const k of keysB) keySet.add(k);
  const allKeys: string[] = [];
  keySet.forEach((k) => allKeys.push(k));

  let matches = 0;
  for (const k of allKeys) {
    if (a.features[k] === b.features[k]) matches++;
  }

  return allKeys.length > 0 ? matches / allKeys.length : 0;
}
