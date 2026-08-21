import { readFile } from "node:fs/promises";
import { DomainValidationError } from "../domain/errors.js";
import { hash32 } from "../domain/hash.js";
import { isIsoTimestamp, parseIsoTimestamp, type IsoTimestamp } from "../domain/timestamp.js";
import type { TaskFamily } from "../task/taxonomy.js";

/**
 * Frozen public-scene prior for R0 ranking. Leaderboard rows are imported
 * offline into a snapshot; live routing never fetches the network.
 *
 * Quality is min-max normalized per source inside the snapshot, then blended
 * by family. Missing coverage fails closed to the caller’s cheapest-eligible
 * path. Public scores never count as local observations for R1.
 */

export const PUBLIC_PRIOR_SCHEMA_VERSION = 1 as const;

export type PublicPriorUnit = "pass_rate" | "elo";

export type PublicPriorSourceId =
  | "aider-polyglot"
  | "swe-bench-verified-mini"
  | "terminal-bench-2.1-fixed-harness"
  | "arena-coding";

export interface PublicPriorScore {
  readonly sourceId: PublicPriorSourceId;
  readonly modelAliases: readonly string[];
  readonly raw: number;
  readonly unit: PublicPriorUnit;
  readonly fetchedAt: IsoTimestamp;
  readonly sourceUrl: string;
}

export interface PublicPriorAliasMapEntry {
  readonly canonicalId: string;
  readonly alias: string;
}

export interface PublicPriorSnapshot {
  readonly schemaVersion: typeof PUBLIC_PRIOR_SCHEMA_VERSION;
  readonly snapshotId: string;
  readonly createdAt: IsoTimestamp;
  /** After per-source min-max, keep models at or above this blended quality. */
  readonly qualityBar: number;
  readonly scores: readonly PublicPriorScore[];
  /** Explicit canonical catalog id → snapshot alias. No substring matching. */
  readonly aliasMap?: readonly PublicPriorAliasMapEntry[] | undefined;
}

export interface CatalogCost {
  readonly id: string;
  readonly estimatedCostUsd: number;
}

export interface PublicPriorPick {
  readonly modelId: string;
  readonly quality: number;
  readonly reason: string;
}

const SOURCE_IDS: readonly PublicPriorSourceId[] = [
  "aider-polyglot",
  "swe-bench-verified-mini",
  "terminal-bench-2.1-fixed-harness",
  "arena-coding"
];

/**
 * Which public sources feed which local task family, and how much.
 * High-risk deploy is intentionally absent: public benches do not measure
 * production/secret work, so R0 keeps the primary/whitelist path.
 */
export const FAMILY_SOURCE_WEIGHTS: Readonly<
  Record<Exclude<TaskFamily, "deploy" | "unknown">, Readonly<Partial<Record<PublicPriorSourceId, number>>>>
> = {
  edit: {
    "aider-polyglot": 0.45,
    "swe-bench-verified-mini": 0.4,
    "terminal-bench-2.1-fixed-harness": 0.15
  },
  refactor: {
    "aider-polyglot": 0.45,
    "swe-bench-verified-mini": 0.4,
    "terminal-bench-2.1-fixed-harness": 0.15
  },
  test: {
    "aider-polyglot": 0.5,
    "swe-bench-verified-mini": 0.5
  },
  review: {
    "aider-polyglot": 0.35,
    "swe-bench-verified-mini": 0.35,
    "arena-coding": 0.3
  },
  plan: {
    "swe-bench-verified-mini": 0.5,
    "arena-coding": 0.5
  },
  research: {
    "arena-coding": 0.6,
    "swe-bench-verified-mini": 0.4
  }
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSourceId(value: unknown): value is PublicPriorSourceId {
  return typeof value === "string" && (SOURCE_IDS as readonly string[]).includes(value);
}

export function validatePublicPriorSnapshot(snapshot: PublicPriorSnapshot): void {
  if (snapshot.schemaVersion !== PUBLIC_PRIOR_SCHEMA_VERSION) {
    throw new DomainValidationError(`unsupported public prior schema: ${snapshot.schemaVersion}`);
  }
  if (snapshot.snapshotId.trim() === "") {
    throw new DomainValidationError("public prior snapshotId is required");
  }
  if (!isIsoTimestamp(snapshot.createdAt)) {
    throw new DomainValidationError("public prior createdAt must be an ISO timestamp");
  }
  if (!Number.isFinite(snapshot.qualityBar) || snapshot.qualityBar < 0 || snapshot.qualityBar > 1) {
    throw new DomainValidationError("public prior qualityBar must be in [0, 1]");
  }
  if (snapshot.scores.length === 0) {
    throw new DomainValidationError("public prior snapshot has no scores");
  }
  for (const score of snapshot.scores) {
    if (!isSourceId(score.sourceId)) {
      throw new DomainValidationError(`unknown public prior source: ${String(score.sourceId)}`);
    }
    if (score.modelAliases.length === 0 || score.modelAliases.some((alias) => alias.trim() === "")) {
      throw new DomainValidationError("public prior score requires non-empty modelAliases");
    }
    if (!Number.isFinite(score.raw)) {
      throw new DomainValidationError("public prior raw score must be finite");
    }
    if (score.unit === "pass_rate" && (score.raw < 0 || score.raw > 1)) {
      throw new DomainValidationError("pass_rate must be in [0, 1]");
    }
    if (score.unit === "elo" && score.raw < 0) {
      throw new DomainValidationError("elo must be non-negative");
    }
    if (!isIsoTimestamp(score.fetchedAt) || score.sourceUrl.trim() === "") {
      throw new DomainValidationError("public prior score requires fetchedAt and sourceUrl");
    }
  }
}

export function parsePublicPriorSnapshot(raw: unknown): PublicPriorSnapshot {
  if (!isRecord(raw)) throw new DomainValidationError("public prior snapshot must be an object");
  if (raw.schemaVersion !== PUBLIC_PRIOR_SCHEMA_VERSION) {
    throw new DomainValidationError(`unsupported public prior schema: ${String(raw.schemaVersion)}`);
  }
  if (typeof raw.snapshotId !== "string") {
    throw new DomainValidationError("public prior snapshotId is required");
  }
  if (typeof raw.qualityBar !== "number") {
    throw new DomainValidationError("public prior qualityBar must be in [0, 1]");
  }
  if (!Array.isArray(raw.scores)) {
    throw new DomainValidationError("public prior snapshot has no scores");
  }
  const scores: PublicPriorScore[] = raw.scores.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new DomainValidationError(`public prior score ${index} must be an object`);
    }
    if (!isSourceId(entry.sourceId)) {
      throw new DomainValidationError(`unknown public prior source: ${String(entry.sourceId)}`);
    }
    if (!Array.isArray(entry.modelAliases) || entry.modelAliases.some((alias) => typeof alias !== "string")) {
      throw new DomainValidationError("public prior score requires non-empty modelAliases");
    }
    if (entry.unit !== "pass_rate" && entry.unit !== "elo") {
      throw new DomainValidationError("public prior unit must be pass_rate or elo");
    }
    if (typeof entry.raw !== "number" || typeof entry.sourceUrl !== "string") {
      throw new DomainValidationError("public prior score requires raw and sourceUrl");
    }
    return {
      sourceId: entry.sourceId,
      modelAliases: entry.modelAliases,
      raw: entry.raw,
      unit: entry.unit,
      fetchedAt: parseIsoTimestamp(entry.fetchedAt),
      sourceUrl: entry.sourceUrl
    };
  });
  const snapshot: PublicPriorSnapshot = {
    schemaVersion: PUBLIC_PRIOR_SCHEMA_VERSION,
    snapshotId: raw.snapshotId,
    createdAt: parseIsoTimestamp(raw.createdAt),
    qualityBar: raw.qualityBar,
    scores,
    ...(Array.isArray(raw.aliasMap)
      ? {
          aliasMap: raw.aliasMap.map((entry, index) => {
            if (!isRecord(entry) || typeof entry.canonicalId !== "string" || typeof entry.alias !== "string") {
              throw new DomainValidationError(`public prior aliasMap ${index} requires canonicalId and alias`);
            }
            return { canonicalId: entry.canonicalId, alias: entry.alias };
          })
        }
      : {})
  };
  validatePublicPriorSnapshot(snapshot);
  return snapshot;
}

export function publicPriorHash(snapshot: PublicPriorSnapshot): string {
  validatePublicPriorSnapshot(snapshot);
  return hash32(
    JSON.stringify({
      schemaVersion: snapshot.schemaVersion,
      snapshotId: snapshot.snapshotId,
      createdAt: snapshot.createdAt,
      qualityBar: snapshot.qualityBar,
      scores: snapshot.scores.map((score) => ({
        sourceId: score.sourceId,
        modelAliases: [...score.modelAliases].sort(),
        raw: score.raw,
        unit: score.unit,
        fetchedAt: score.fetchedAt,
        sourceUrl: score.sourceUrl
      })),
      aliasMap: [...(snapshot.aliasMap ?? [])]
        .map((row) => ({ canonicalId: row.canonicalId, alias: row.alias }))
        .sort((left, right) => left.canonicalId.localeCompare(right.canonicalId))
    })
  );
}

function resolveAlias(modelId: string, snapshot: PublicPriorSnapshot): string {
  const mapped = snapshot.aliasMap?.find((row) => row.canonicalId === modelId)?.alias;
  return mapped ?? modelId;
}

function aliasesMatch(modelId: string, aliases: readonly string[], snapshot: PublicPriorSnapshot): boolean {
  const needle = resolveAlias(modelId, snapshot).trim().toLowerCase();
  return aliases.some((alias) => alias.trim().toLowerCase() === needle);
}

/** Min-max normalize one source across models that appear in the catalog. */
export function normalizeSource(
  snapshot: PublicPriorSnapshot,
  sourceId: PublicPriorSourceId,
  catalogIds: readonly string[]
): Map<string, number> {
  const rows = snapshot.scores.filter((score) => score.sourceId === sourceId);
  const matched: { modelId: string; raw: number; unit: PublicPriorUnit }[] = [];
  for (const modelId of catalogIds) {
    const row = rows.find((score) => aliasesMatch(modelId, score.modelAliases, snapshot));
    if (row === undefined) continue;
    matched.push({ modelId, raw: row.raw, unit: row.unit });
  }
  const out = new Map<string, number>();
  if (matched.length === 0) return out;
  if (matched.length < 3) {
    for (const row of matched) {
      if (row.unit === "pass_rate") out.set(row.modelId, row.raw);
      // elo with <3 catalog hits is not a [0,1] quality — skip the source
    }
    return out;
  }
  const values = matched.map((row) => row.raw);
  const min = Math.min(...values);
  const max = Math.max(...values);
  for (const row of matched) {
    const quality = max === min ? 0.5 : (row.raw - min) / (max - min);
    out.set(row.modelId, quality);
  }
  return out;
}

export function blendedQuality(
  snapshot: PublicPriorSnapshot,
  family: TaskFamily,
  catalogIds: readonly string[]
): Map<string, number> {
  if (family === "deploy" || family === "unknown") return new Map();
  const weights = FAMILY_SOURCE_WEIGHTS[family];
  const blended = new Map<string, { sum: number; weight: number }>();
  for (const [sourceId, weight] of Object.entries(weights) as [PublicPriorSourceId, number][]) {
    if (weight <= 0) continue;
    const normalized = normalizeSource(snapshot, sourceId, catalogIds);
    for (const [modelId, quality] of normalized) {
      const acc = blended.get(modelId) ?? { sum: 0, weight: 0 };
      acc.sum += quality * weight;
      acc.weight += weight;
      blended.set(modelId, acc);
    }
  }
  const out = new Map<string, number>();
  for (const [modelId, acc] of blended) {
    if (acc.weight > 0) out.set(modelId, acc.sum / acc.weight);
  }
  return out;
}

/**
 * Among catalog models, pick the cheapest whose blended scene quality clears
 * the snapshot bar. If none clear, pick the highest quality. If the family
 * has no coverage, return undefined so R0 can keep cheapest-eligible.
 */
export function pickFromPublicPrior(
  snapshot: PublicPriorSnapshot,
  family: TaskFamily,
  catalog: readonly CatalogCost[]
): PublicPriorPick | undefined {
  validatePublicPriorSnapshot(snapshot);
  const catalogIds = catalog.map((model) => model.id);
  const quality = blendedQuality(snapshot, family, catalogIds);
  if (quality.size === 0) return undefined;

  const covered = catalog.filter((model) => quality.has(model.id));
  if (covered.length === 0) return undefined;

  const aboveBar = covered.filter((model) => (quality.get(model.id) ?? 0) >= snapshot.qualityBar);
  const pool = aboveBar.length > 0 ? aboveBar : covered;
  const chosen =
    aboveBar.length > 0
      ? [...pool].sort((left, right) => {
          const cost = left.estimatedCostUsd - right.estimatedCostUsd;
          if (cost !== 0) return cost;
          return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
        })[0]
      : [...pool].sort((left, right) => {
          const q = (quality.get(right.id) ?? 0) - (quality.get(left.id) ?? 0);
          if (q !== 0) return q;
          const cost = left.estimatedCostUsd - right.estimatedCostUsd;
          if (cost !== 0) return cost;
          return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
        })[0];
  if (chosen === undefined) return undefined;
  const score = quality.get(chosen.id) ?? 0;
  const via = aboveBar.length > 0 ? "cheapest above quality bar" : "highest quality (none cleared bar)";
  return {
    modelId: chosen.id,
    quality: score,
    reason: `public prior ${family}: ${via} quality=${score.toFixed(3)} snapshot=${snapshot.snapshotId}`
  };
}

/** Load a frozen snapshot from disk. Never fetches leaderboards. */
export async function loadPublicPriorFile(path: string): Promise<PublicPriorSnapshot> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new DomainValidationError(`public prior file is unreadable: ${path}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new DomainValidationError("public prior file is not JSON");
  }
  return parsePublicPriorSnapshot(raw);
}
