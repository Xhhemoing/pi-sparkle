import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runtimeRoot } from "../privacy/state-layout.js";
import type { ModelRouterConfig } from "../supervisor/model-router.js";
import { isInvocation, type ModelInvocation } from "../telemetry/model-invocation.js";
import { catalogModel, type CatalogModel } from "./catalog-model.js";

export interface CalibratedRates {
  readonly inputCostPerMTok: number;
  readonly outputCostPerMTok: number;
  readonly latencyMsPer1K: number;
  readonly estimatedCostUsd: number;
  readonly estimatedDurationMs: number;
  readonly samples: number;
}

const SMOOTH = 0.3;
export const INVOCATIONS_LOG = "invocations.jsonl";

/**
 * Exponential-smooth catalog token/latency rates from invocations of the same
 * model version. Missing usage is skipped — never treated as zero.
 */
export function calibrateCatalogRates(
  model: CatalogModel,
  invocations: readonly ModelInvocation[]
): CalibratedRates {
  let inputCost = model.inputCostPerMTok;
  let outputCost = model.outputCostPerMTok;
  let latency = model.latencyMsPer1K;
  let estimatedCostUsd = model.estimatedCostUsd;
  let estimatedDurationMs = model.estimatedDurationMs;
  let samples = 0;
  for (const inv of invocations) {
    if (inv.config.model !== model.id) continue;
    if (inv.config.modelVersion !== model.version) continue;
    if (inv.tokensIn === undefined || inv.tokensOut === undefined) continue;
    if (inv.tokensOut <= 0) continue;
    const impliedLatency = (inv.latencyMs / inv.tokensOut) * 1000;
    const impliedCost =
      (inv.tokensIn / 1_000_000) * model.inputCostPerMTok +
      (inv.tokensOut / 1_000_000) * model.outputCostPerMTok;
    latency = latency * (1 - SMOOTH) + impliedLatency * SMOOTH;
    estimatedCostUsd = estimatedCostUsd * (1 - SMOOTH) + impliedCost * SMOOTH;
    estimatedDurationMs = estimatedDurationMs * (1 - SMOOTH) + inv.latencyMs * SMOOTH;
    samples += 1;
  }
  return {
    inputCostPerMTok: inputCost,
    outputCostPerMTok: outputCost,
    latencyMsPer1K: latency,
    estimatedCostUsd,
    estimatedDurationMs,
    samples
  };
}

/** Prefer calibrated cost/latency when samples exist; catalog values stay if not. */
export function withCalibratedRates(model: CatalogModel, rates: CalibratedRates): CatalogModel {
  if (rates.samples === 0) return model;
  return {
    ...model,
    latencyMsPer1K: rates.latencyMsPer1K,
    estimatedCostUsd: rates.estimatedCostUsd,
    estimatedDurationMs: rates.estimatedDurationMs
  };
}

export function calibrateCatalogConfig(
  catalog: ModelRouterConfig,
  invocations: readonly ModelInvocation[]
): ModelRouterConfig {
  let changed = false;
  const models = catalog.models.map((input) => {
    const model = catalogModel(input);
    const next = withCalibratedRates(model, calibrateCatalogRates(model, invocations));
    if (next !== model) changed = true;
    return next;
  });
  return {
    policyVersion: changed ? `${catalog.policyVersion}+calibrated` : catalog.policyVersion,
    models,
    ...(catalog.defaultThreshold !== undefined ? { defaultThreshold: catalog.defaultThreshold } : {})
  };
}

/** Missing log → empty. Malformed or invalid rows are skipped, not zero-filled. */
export async function loadInvocationsFromStateRoot(stateRoot: string): Promise<ModelInvocation[]> {
  let raw: string;
  try {
    raw = await readFile(join(runtimeRoot(stateRoot), INVOCATIONS_LOG), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const out: ModelInvocation[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (isInvocation(parsed)) out.push(parsed);
  }
  return out;
}

export async function calibrateCatalogFromState(
  catalog: ModelRouterConfig,
  stateRoot: string
): Promise<ModelRouterConfig> {
  return calibrateCatalogConfig(catalog, await loadInvocationsFromStateRoot(stateRoot));
}
