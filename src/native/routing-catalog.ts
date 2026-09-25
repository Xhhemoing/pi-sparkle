import { DomainValidationError } from "../domain/errors.js";
import { catalogModel, type CatalogModel } from "../routing/catalog-model.js";
import type { ModelRouterConfig } from "../supervisor/model-router.js";
import { defaultCliModelRouterConfig } from "../cli/model-catalog.js";
import { formatModelRef, tryParseModelRef } from "../config/model-ref.js";

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
  /** Policy aliases resolved before assignment; never catalog rows or events. */
  readonly aliases: Readonly<Record<string, string>>;
}

function fail(message: string): never {
  throw new DomainValidationError(message);
}

function requireCanonicalRef(value: string, label: string): void {
  const parsed = tryParseModelRef(value);
  if (parsed === undefined) {
    fail(`${label} must be canonical provider/model: ${value}`);
  }
  let formatted: string;
  try {
    formatted = formatModelRef(parsed.providerId, parsed.modelId);
  } catch {
    fail(`${label} must be canonical provider/model: ${value}`);
  }
  if (
    parsed.providerId !== parsed.providerId.trim() ||
    parsed.modelId !== parsed.modelId.trim() ||
    formatted !== value
  ) {
    fail(`${label} must be canonical provider/model without component whitespace: ${value}`);
  }
}

export function buildNativeRoutingCatalog(
  models: readonly NativeCatalogModelInput[],
  config: { readonly primary?: string; readonly fast?: string }
): NativeRoutingCatalog {
  if (!Array.isArray(models) || models.length === 0) {
    fail("native routing catalog requires at least one eligible host model");
  }
  const preferredEntries = models.filter((model) => model.preferred === true);
  if (preferredEntries.length > 1) fail("native routing catalog has multiple preferred models");
  const declaredPreferred = preferredEntries[0]?.ref;
  if (config.primary !== undefined && declaredPreferred !== undefined && config.primary !== declaredPreferred) {
    fail(`native routing catalog primary conflicts with preferred model: ${config.primary} != ${declaredPreferred}`);
  }
  const preferredRef = config.primary ?? declaredPreferred;
  if (preferredRef === undefined) {
    fail("native routing catalog requires a primary (preferred) model ref");
  }
  requireCanonicalRef(preferredRef, "native routing catalog primary");

  const seen = new Set<string>();
  // Equal estimated costs otherwise break the preferred-model tie by catalog
  // order. Put the explicit primary first so a tied assignment stays on the
  // model the single-model native executor can resolve.
  const ordered = [...models].sort((left, right) => Number(right.ref === preferredRef) - Number(left.ref === preferredRef));
  const rows: CatalogModel[] = ordered.map((entry) => {
    requireCanonicalRef(entry.ref, "native routing catalog model ref");
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
  if (!seen.has(preferredRef)) {
    fail(`native routing catalog primary must be an eligible model: ${preferredRef}`);
  }

  const fastRef = config.fast ?? models.find((model) => !model.preferred && model.ref !== preferredRef)?.ref ?? preferredRef;
  requireCanonicalRef(fastRef, "native routing catalog fast model");
  if (!seen.has(fastRef)) {
    fail(`native routing catalog fast model must be an eligible model: ${fastRef}`);
  }

  const base = defaultCliModelRouterConfig();
  return {
    config: {
      ...base,
      models: rows,
      policyVersion: "router-v1-native"
    },
    primary: preferredRef,
    fast: fastRef,
    aliases: { cheap: fastRef, premium: preferredRef }
  };
}
