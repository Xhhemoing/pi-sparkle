import { DomainValidationError } from "../domain/errors.js";
import type { Flowchart } from "../domain/flowchart.js";
import { createModelRouter, type ModelRouter, type ModelRouterConfig } from "../supervisor/model-router.js";

/**
 * Default CLI ModelRouter catalog. Matches the M2.5 fake-proof models so the
 * CLI cannot invent ids that the library tests never route.
 */
export function defaultCliModelRouterConfig(): ModelRouterConfig {
  return {
    policyVersion: "router-v1",
    models: [
      {
        id: "cheap",
        roles: ["actor", "critic"],
        maxComplexity: "MEDIUM",
        estimatedCostUsd: 0.1,
        estimatedDurationMs: 1_000
      },
      {
        id: "premium",
        roles: ["actor", "critic", "judge", "router"],
        maxComplexity: "HIGH",
        estimatedCostUsd: 0.5,
        estimatedDurationMs: 4_000
      }
    ]
  };
}

export function cliCatalogModelIds(): readonly string[] {
  return defaultCliModelRouterConfig().models.map((model) => model.id);
}

export function createCliModelRouter(): ModelRouter {
  return createModelRouter(defaultCliModelRouterConfig());
}

/** Fail closed when a flowchart names models the CLI catalog does not serve. */
export function assertFlowchartModelsInCatalog(flowchart: Flowchart): void {
  const catalog = new Set(cliCatalogModelIds());
  for (const node of flowchart.nodes) {
    for (const model of node.modelPolicy.allowedModels) {
      if (!catalog.has(model)) {
        throw new DomainValidationError(
          `flowchart node ${node.id} modelPolicy references unavailable model "${model}"; CLI catalog: ${cliCatalogModelIds().join(", ")}`
        );
      }
    }
  }
}
