import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ModelInvocation } from "../telemetry/model-invocation.js";
import { loadInvocationsFromStateRoot } from "./cost-calibration.js";

export const CATALOG_OBSERVED_RELATIVE = "routing/catalog-observed.json";

export interface ObservedVersionStats {
  readonly modelVersion: string;
  readonly p50TokensIn: number | undefined;
  readonly p50TokensOut: number | undefined;
  readonly p50LatencyMs: number | undefined;
  readonly sampleCount: number;
  readonly tokensInSamples: number;
  readonly tokensOutSamples: number;
  readonly latencySamples: number;
}

export interface CatalogObservedSnapshot {
  readonly versions: Readonly<Record<string, ObservedVersionStats>>;
}

interface VersionBuckets {
  tokensIn: number[];
  tokensOut: number[];
  latencyMs: number[];
}

export function catalogObservedPath(stateRoot: string): string {
  return join(stateRoot, "routing", "catalog-observed.json");
}

export function emptyObservedStats(modelVersion: string): ObservedVersionStats {
  return {
    modelVersion,
    p50TokensIn: undefined,
    p50TokensOut: undefined,
    p50LatencyMs: undefined,
    sampleCount: 0,
    tokensInSamples: 0,
    tokensOutSamples: 0,
    latencySamples: 0
  };
}

/**
 * Independent p50 snapshot by pinned modelVersion. Missing token usage is
 * skipped, never treated as zero. Unpinned invocations are skipped — no
 * invented version string. Does not rewrite catalog estimatedCostUsd.
 */
export function aggregateCatalogObserved(
  invocations: readonly ModelInvocation[]
): CatalogObservedSnapshot {
  const buckets = new Map<string, VersionBuckets>();
  for (const inv of invocations) {
    const version = inv.config.modelVersion;
    if (version === undefined) continue;
    let bucket = buckets.get(version);
    if (bucket === undefined) {
      bucket = { tokensIn: [], tokensOut: [], latencyMs: [] };
      buckets.set(version, bucket);
    }
    if (inv.tokensIn !== undefined) bucket.tokensIn.push(inv.tokensIn);
    if (inv.tokensOut !== undefined) bucket.tokensOut.push(inv.tokensOut);
    bucket.latencyMs.push(inv.latencyMs);
  }
  const versions: Record<string, ObservedVersionStats> = {};
  for (const [modelVersion, bucket] of buckets) {
    versions[modelVersion] = {
      modelVersion,
      p50TokensIn: percentile50(bucket.tokensIn),
      p50TokensOut: percentile50(bucket.tokensOut),
      p50LatencyMs: percentile50(bucket.latencyMs),
      sampleCount: bucket.latencyMs.length,
      tokensInSamples: bucket.tokensIn.length,
      tokensOutSamples: bucket.tokensOut.length,
      latencySamples: bucket.latencyMs.length
    };
  }
  return { versions };
}

export function observedStatsForVersion(
  snapshot: CatalogObservedSnapshot,
  modelVersion: string
): ObservedVersionStats {
  return snapshot.versions[modelVersion] ?? emptyObservedStats(modelVersion);
}

export async function persistCatalogObserved(
  stateRoot: string,
  snapshot: CatalogObservedSnapshot
): Promise<string> {
  const path = catalogObservedPath(stateRoot);
  await mkdir(dirname(path), { recursive: true });
  const body = {
    versions: Object.fromEntries(
      Object.entries(snapshot.versions).map(([version, stats]) => [version, serializeStats(stats)])
    )
  };
  await writeFile(path, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  return path;
}

export async function loadCatalogObservedSnapshot(stateRoot: string): Promise<CatalogObservedSnapshot> {
  let raw: string;
  try {
    raw = await readFile(catalogObservedPath(stateRoot), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { versions: {} };
    throw error;
  }
  return parseSnapshot(JSON.parse(raw) as unknown);
}

export async function buildCatalogObservedFromStateRoot(
  stateRoot: string
): Promise<CatalogObservedSnapshot> {
  return aggregateCatalogObserved(await loadInvocationsFromStateRoot(stateRoot));
}

function percentile50(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = values.slice().sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function serializeStats(stats: ObservedVersionStats): Record<string, unknown> {
  const row: Record<string, unknown> = {
    modelVersion: stats.modelVersion,
    sampleCount: stats.sampleCount,
    tokensInSamples: stats.tokensInSamples,
    tokensOutSamples: stats.tokensOutSamples,
    latencySamples: stats.latencySamples
  };
  if (stats.p50TokensIn !== undefined) row.p50TokensIn = stats.p50TokensIn;
  if (stats.p50TokensOut !== undefined) row.p50TokensOut = stats.p50TokensOut;
  if (stats.p50LatencyMs !== undefined) row.p50LatencyMs = stats.p50LatencyMs;
  return row;
}

function parseSnapshot(value: unknown): CatalogObservedSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { versions: {} };
  }
  const rawVersions = (value as { versions?: unknown }).versions;
  if (typeof rawVersions !== "object" || rawVersions === null || Array.isArray(rawVersions)) {
    return { versions: {} };
  }
  const versions: Record<string, ObservedVersionStats> = {};
  for (const [modelVersion, row] of Object.entries(rawVersions as Record<string, unknown>)) {
    versions[modelVersion] = parseStats(modelVersion, row);
  }
  return { versions };
}

function parseStats(modelVersion: string, row: unknown): ObservedVersionStats {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    return emptyObservedStats(modelVersion);
  }
  const record = row as Record<string, unknown>;
  const version =
    typeof record.modelVersion === "string" && record.modelVersion !== ""
      ? record.modelVersion
      : modelVersion;
  return {
    modelVersion: version,
    p50TokensIn: optionalNumber(record.p50TokensIn),
    p50TokensOut: optionalNumber(record.p50TokensOut),
    p50LatencyMs: optionalNumber(record.p50LatencyMs),
    sampleCount: finiteCount(record.sampleCount),
    tokensInSamples: finiteCount(record.tokensInSamples),
    tokensOutSamples: finiteCount(record.tokensOutSamples),
    latencySamples: finiteCount(record.latencySamples)
  };
}

/** Absent / null stay undefined. Present 0 is kept — never coerce missing to 0. */
function optionalNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function finiteCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return value;
}
