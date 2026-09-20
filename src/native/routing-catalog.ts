import { DomainValidationError } from "../domain/errors.js";
import { catalogModel, type CatalogModel } from "../routing/catalog-model.js";
import type { ModelRouterConfig } from "../supervisor/model-router.js";
import { defaultCliModelRouterConfig } from "../cli/model-catalog.js";
import { tryParseModelRef } from "../config/model-ref.js";

/**
 * Bridge the host Pi session's model registry onto the same live-catalog
 * shape the CLI routing path uses (`ModelRouterConfig`), so delegated tasks
 * can route through `assignTasks` with the identical R0-equivalent static
 * policy, learned-policy application, and cost-calibration semantics.
 *
 * Deliberately conservative:
 * - models without host pricing stay unpriced (zero rates) with a small
 *   positive `estimatedCostUsd` floor, mirroring `routableFromListed`'s
 *   unpriced treatment — costs are never invented;
 * - the preferred host model is the primary (HIGH complexity, judge/router
 *   roles, high-risk approved); every other eligible model is a generalist
 *   (MEDIUM, actor/critic) exactly like the fast tier in the CLI catalog;
 * - an empty eligible set fails closed: a run that cannot route should not
 *   start.
 */

export interface NativeCatalogModelInput {
  /** "provider/model" catalog ref, as the host registry spells ids. */
  readonly ref: string;
  /** Marks the host's preferred model (the primary row). Exactly one. */
  readonly preferred?: boolean | undefined;
  readonly contextWindow?: number | undefined;
  readonly maxOutputTokens?: number | undefined;
  readonly capabilities?: readonly string[] | undefined;
}

export interface NativeRoutingCatalog {
  /** The built live-catalog config for `assignTasks`. */
  readonly config: ModelRouterConfig;
  /** The primary (preferred) catalog id. */
  readonly primary: string;
  /** The fast/secondary id when a second model is eligible. */
  readonly fast: string;
}

function fail(message: string): never {
  throw new DomainValidationError(message);
}

export function buildNativeRoutingCatalog(
  models: readonly NativeCatalogModelInput[],
  config: { readonly primary?: string; readonly fast?: string }
): NativeRoutingCatalog {
  if (!Array.isArray(models) || models.length === 0) {
    fail("native routing catalog requires at least one eligible host model");
  }
  const preferredRef = config.primary ?? models.find((model) => model.preferred)?.ref;
  if (preferredRef === undefined) {
    fail("native routing catalog requires a primary (preferred) model ref");
  }
  if (tryParseModelRef(preferredRef) === undefined) {
    fail(`native routing catalog model refs must be provider/model: ${preferredRef}`);
  }

  const seen = new Set<string>();
  const rows: CatalogModel[] = models.map((entry) => {
    if (tryParseModelRef(entry.ref) === undefined) {
      fail(`native routing catalog model refs must be provider/model: ${entry.ref}`);
    }
    if (seen.has(entry.ref)) fail(`duplicate native catalog model ref: ${entry.ref}`);
    seen.add(entry.ref);
    const primary = entry.ref === preferredRef;
    return catalogModel({
      id: entry.ref,
      version: "host",
      providerId: entry.ref.slice(0, entry.ref.indexOf("/")),
      roles: primary ? ["actor", "critic", "judge", "router"] : ["actor", "critic"],
      maxComplexity: primary ? "HIGH" : "MEDIUM",
      estimatedCostUsd: 0.01,
      estimatedDurationMs: primary ? 4_000 : 1_500,
      inputCostPerMTok: 0,
      outputCostPerMTok: 0,
      ...(entry.contextWindow !== undefined ? { contextWindow: entry.contextWindow } : {}),
      ...(entry.maxOutputTokens !== undefined ? { maxOutputTokens: entry.maxOutputTokens } : {}),
      capabilities: entry.capabilities ?? ["tool-use"],
      approvedForHighRisk: primary
    });
  });

  const fastRef = config.fast ?? models.find((model) => !model.preferred && model.ref !== preferredRef)?.ref ?? preferredRef;

  const base = defaultCliModelRouterConfig();
  // Mirrors `buildLiveCatalogConfig`: the primary is aliased as `premium`
  // (and the secondary as `cheap`) so flowchart/assignment policies that
  // reference the aliases can resolve against the host models too.
  const rowsWithAliases = [...rows];
  const primaryRow = rows.find((row) => row.id === preferredRef);
  if (primaryRow !== undefined && !rowsWithAliases.some((row) => row.id === "premium")) {
    rowsWithAliases.push({ ...primaryRow, id: "premium" });
  }
  const fastRow = rows.find((row) => row.id === fastRef);
  if (fastRow !== undefined && fastRef !== preferredRef && !rowsWithAliases.some((row) => row.id === "cheap")) {
    rowsWithAliases.push({ ...fastRow, id: "cheap" });
  }
  return {
    config: {
      ...base,
      models: rowsWithAliases,
      policyVersion: "router-v1-native"
    },
    primary: preferredRef,
    fast: fastRef
  };
}
