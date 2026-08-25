import { DomainValidationError } from "../domain/errors.js";
import type { Flowchart } from "../domain/flowchart.js";
import { loadProvidersConfig } from "../config/providers-config.js";
import { parseModelRef, tryParseModelRef } from "../config/model-ref.js";
import type { SparkleListedModel } from "../pi-adapter/listed-model.js";
import { catalogModel, type CatalogModel } from "../routing/catalog-model.js";
import {
  catalogFromPrimary,
  cheapCatalogModel,
  DEFAULT_FAST_MODEL_ID,
  DEFAULT_PRIMARY_MODEL_ID,
  inferFastId,
  premiumCatalogModel
} from "../routing/primary-catalog.js";
import { calibrateCatalogFromState } from "../routing/cost-calibration.js";
import { createModelRouter, type ModelRouter, type ModelRouterConfig } from "../supervisor/model-router.js";

export function defaultCliModelRouterConfig(): ModelRouterConfig {
  return {
    policyVersion: "router-v1",
    models: [cheapCatalogModel(), premiumCatalogModel()]
  };
}

export function cliCatalogModelIds(): readonly string[] {
  return defaultCliModelRouterConfig().models.map((model) => model.id);
}

export function createCliModelRouter(): ModelRouter {
  return createModelRouter(defaultCliModelRouterConfig());
}

export async function buildLiveCatalogConfig(
  stateRoot: string,
  overrides: { readonly primaryModelId?: string; readonly fastModelId?: string } = {}
): Promise<ModelRouterConfig> {
  const config = await loadProvidersConfig(stateRoot);
  const primaryId = (overrides.primaryModelId ?? config.primary ?? DEFAULT_PRIMARY_MODEL_ID).trim();
  const fastId = (overrides.fastModelId ?? config.fast ?? inferFastId(primaryId)).trim();
  const enabled: string[] = [];
  const seen = new Set<string>();
  for (const id of [...config.enabled, primaryId, fastId]) {
    if (tryParseModelRef(id) === undefined || seen.has(id)) continue;
    seen.add(id);
    enabled.push(id);
  }
  if (enabled.length === 0) {
    return catalogFromPrimary({ primaryModelId: primaryId, fastModelId: fastId });
  }

  const models: CatalogModel[] = [];
  const byId = new Map<string, CatalogModel>();
  const { resolveListedModel } = await import("../pi-adapter/listed-model.js");
  for (const id of enabled) {
    const ref = parseModelRef(id);
    const listed = resolveListedModel(ref.providerId, ref.modelId, config.customProviders);
    if (listed === undefined) {
      throw new DomainValidationError(`unknown model "${id}"`);
    }
    const row = routableFromListed(listed, id === primaryId);
    models.push(row);
    byId.set(row.id, row);
  }
  const fastRow = byId.get(fastId) ?? models[0];
  const primaryRow = byId.get(primaryId) ?? models[models.length - 1];
  if (fastRow !== undefined && !byId.has(DEFAULT_FAST_MODEL_ID)) {
    models.push({ ...fastRow, id: DEFAULT_FAST_MODEL_ID });
  }
  // Both aliases are emitted even when primary and fast are the same model:
  // that is what the pi executor builds from a lone primary, so suppressing
  // `premium` here would refuse flowcharts the executor can actually run.
  if (primaryRow !== undefined && !byId.has(DEFAULT_PRIMARY_MODEL_ID)) {
    models.push({ ...primaryRow, id: DEFAULT_PRIMARY_MODEL_ID });
  }
  return { policyVersion: "router-v1-live", models };
}

export async function createCalibratedCliModelRouter(stateRoot: string): Promise<ModelRouter> {
  return createModelRouter(await calibrateCatalogFromState(await buildLiveCatalogConfig(stateRoot), stateRoot));
}

export function assertFlowchartModelsInCatalog(
  flowchart: Flowchart,
  catalogIds: readonly string[] = cliCatalogModelIds()
): void {
  const catalog = new Set(catalogIds);
  for (const node of flowchart.nodes) {
    for (const model of node.modelPolicy.allowedModels) {
      if (!catalog.has(model)) {
        throw new DomainValidationError(
          `flowchart node ${node.id} modelPolicy references unavailable model "${model}"; CLI catalog: ${catalogIds.join(", ")}`
        );
      }
    }
  }
}

function routableFromListed(listed: SparkleListedModel, primary: boolean): CatalogModel {
  const estimatedCostUsd = listed.inputCostPerMTok * 0.001 + listed.outputCostPerMTok * 0.0005;
  return catalogModel({
    id: listed.catalogId,
    version: listed.version,
    providerId: listed.providerId,
    roles: primary ? ["actor", "critic", "judge", "router"] : ["actor", "critic"],
    maxComplexity: primary ? "HIGH" : "MEDIUM",
    estimatedCostUsd: estimatedCostUsd > 0 ? estimatedCostUsd : 0.01,
    estimatedDurationMs: primary ? 4_000 : 1_500,
    inputCostPerMTok: listed.inputCostPerMTok,
    outputCostPerMTok: listed.outputCostPerMTok,
    contextWindow: listed.contextWindow,
    maxOutputTokens: listed.maxOutputTokens,
    capabilities: listed.capabilities,
    approvedForHighRisk: primary
  });
}
