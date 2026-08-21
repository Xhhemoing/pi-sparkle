import { DomainValidationError } from "../domain/errors.js";
import { catalogModel, type CatalogModel } from "./catalog-model.js";
import type { ModelRouterConfig } from "../supervisor/model-router.js";

export const DEFAULT_FAST_MODEL_ID = "cheap";
export const DEFAULT_PRIMARY_MODEL_ID = "premium";

export interface PrimaryCatalogInput {
  readonly primaryModelId: string;
  readonly fastModelId?: string;
  readonly policyVersion?: string;
}

export function cheapCatalogModel(): CatalogModel {
  return catalogModel({
    id: DEFAULT_FAST_MODEL_ID,
    version: "cheap-v1",
    providerId: "fake",
    roles: ["actor", "critic"],
    maxComplexity: "MEDIUM",
    estimatedCostUsd: 0.1,
    estimatedDurationMs: 1_000,
    inputCostPerMTok: 0.1,
    outputCostPerMTok: 0.3,
    approvedForHighRisk: false
  });
}

export function premiumCatalogModel(): CatalogModel {
  return catalogModel({
    id: DEFAULT_PRIMARY_MODEL_ID,
    version: "premium-v1",
    providerId: "fake",
    roles: ["actor", "critic", "judge", "router"],
    maxComplexity: "HIGH",
    estimatedCostUsd: 0.5,
    estimatedDurationMs: 4_000,
    inputCostPerMTok: 1,
    outputCostPerMTok: 3,
    approvedForHighRisk: true,
    capabilities: ["tool-use"]
  });
}

export function catalogFromPrimary(input: PrimaryCatalogInput): ModelRouterConfig {
  const primaryId = input.primaryModelId.trim();
  if (primaryId === "") {
    throw new DomainValidationError("primaryModelId must be non-empty");
  }
  const fastId = (input.fastModelId ?? inferFastId(primaryId)).trim();
  if (fastId === "") {
    throw new DomainValidationError("fastModelId must be non-empty");
  }

  const primary = modelFor(primaryId, "primary");
  if (fastId === primaryId) {
    return {
      policyVersion: input.policyVersion ?? "router-v1-primary",
      models: [primary]
    };
  }
  const fast = modelFor(fastId, "fast");
  return {
    policyVersion: input.policyVersion ?? "router-v1-primary",
    models: [fast, primary]
  };
}

export function inferFastId(primaryModelId: string): string {
  if (primaryModelId === DEFAULT_PRIMARY_MODEL_ID) return DEFAULT_FAST_MODEL_ID;
  if (primaryModelId === DEFAULT_FAST_MODEL_ID) return DEFAULT_FAST_MODEL_ID;
  return primaryModelId;
}

function modelFor(id: string, tier: "fast" | "primary"): CatalogModel {
  if (id === DEFAULT_FAST_MODEL_ID) return cheapCatalogModel();
  if (id === DEFAULT_PRIMARY_MODEL_ID) return premiumCatalogModel();
  if (tier === "fast") {
    return catalogModel({
      id,
      version: `${id}-v1`,
      providerId: "user",
      roles: ["actor", "critic"],
      maxComplexity: "MEDIUM",
      estimatedCostUsd: 0.15,
      estimatedDurationMs: 1_500,
      approvedForHighRisk: false
    });
  }
  return catalogModel({
    id,
    version: `${id}-v1`,
    providerId: "user",
    roles: ["actor", "critic", "judge", "router"],
    maxComplexity: "HIGH",
    estimatedCostUsd: 1,
    estimatedDurationMs: 6_000,
    approvedForHighRisk: true,
    capabilities: ["tool-use"]
  });
}
