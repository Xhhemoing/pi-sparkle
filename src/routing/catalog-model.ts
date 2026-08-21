import { DomainValidationError } from "../domain/errors.js";
import type { FlowchartNodeRole, TaskComplexity } from "../domain/flowchart.js";
import type { ModelDescriptor, PrivacyClass, ProviderPolicy } from "./capability-registry.js";

/**
 * Single catalog type for live ModelRouter and library R0.
 * Version is mandatory — an id must not impersonate a version.
 */
export interface CatalogModel {
  readonly id: string;
  readonly version: string;
  readonly providerId: string;
  readonly roles: readonly FlowchartNodeRole[];
  readonly maxComplexity: TaskComplexity;
  readonly capabilities: readonly string[];
  readonly privacyClass?: PrivacyClass | undefined;
  readonly providerPolicy: ProviderPolicy;
  readonly contextWindow?: number | undefined;
  readonly maxOutputTokens?: number | undefined;
  readonly inputCostPerMTok: number;
  readonly outputCostPerMTok: number;
  readonly latencyMsPer1K: number;
  readonly estimatedCostUsd: number;
  readonly estimatedDurationMs: number;
  readonly approvedForHighRisk?: boolean | undefined;
}

export type CatalogModelInput = Partial<CatalogModel> &
  Pick<CatalogModel, "id" | "roles" | "maxComplexity" | "estimatedCostUsd" | "estimatedDurationMs">;

export function catalogModel(input: CatalogModelInput): CatalogModel {
  const version = input.version?.trim();
  if (version === undefined || version === "") {
    throw new DomainValidationError(`model ${input.id} must declare version`);
  }
  return {
    id: input.id,
    version,
    providerId: input.providerId ?? "catalog",
    roles: input.roles,
    maxComplexity: input.maxComplexity,
    capabilities: input.capabilities ?? ["tool-use"],
    providerPolicy: input.providerPolicy ?? "approved",
    inputCostPerMTok: input.inputCostPerMTok ?? 1,
    outputCostPerMTok: input.outputCostPerMTok ?? 3,
    latencyMsPer1K: input.latencyMsPer1K ?? 80,
    estimatedCostUsd: input.estimatedCostUsd,
    estimatedDurationMs: input.estimatedDurationMs,
    ...(input.privacyClass !== undefined ? { privacyClass: input.privacyClass } : {}),
    ...(input.contextWindow !== undefined ? { contextWindow: input.contextWindow } : {}),
    ...(input.maxOutputTokens !== undefined ? { maxOutputTokens: input.maxOutputTokens } : {}),
    ...(input.approvedForHighRisk !== undefined ? { approvedForHighRisk: input.approvedForHighRisk } : {})
  };
}

export function toModelDescriptor(model: CatalogModel): ModelDescriptor {
  return {
    modelId: model.id,
    providerId: model.providerId,
    version: model.version,
    capabilities: model.capabilities,
    providerPolicy: model.providerPolicy,
    inputCostPerMTok: model.inputCostPerMTok,
    outputCostPerMTok: model.outputCostPerMTok,
    latencyMsPer1K: model.latencyMsPer1K,
    ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxOutputTokens !== undefined ? { maxOutputTokens: model.maxOutputTokens } : {}),
    ...(model.privacyClass !== undefined ? { privacyClass: model.privacyClass } : {}),
    ...(model.approvedForHighRisk !== undefined ? { approvedForHighRisk: model.approvedForHighRisk } : {})
  };
}

/** Deterministic live policy: selected arm = 1, every other eligible arm = 0. */
export function oneHotDistribution(
  eligible: readonly string[],
  selected: string
): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const id of eligible) {
    out[id] = id === selected ? 1 : 0;
  }
  return out;
}
