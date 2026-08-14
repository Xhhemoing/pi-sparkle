import { DomainValidationError } from "../domain/errors.js";

export type PrivacyClass = "local" | "cloud-approved" | "cloud-general";
export const PRIVACY_ORDER: readonly PrivacyClass[] = ["local", "cloud-approved", "cloud-general"] as const;

export type ProviderPolicy = "approved" | "forbidden";

export interface ModelDescriptor {
  readonly modelId: string;
  readonly providerId: string;
  readonly version: string;
  readonly contextWindow: number;
  readonly maxOutputTokens: number;
  /** Explicitly declared capabilities only — anything else is unsupported. */
  readonly capabilities: readonly string[];
  readonly privacyClass: PrivacyClass;
  readonly providerPolicy: ProviderPolicy;
  /** USD per million input tokens. */
  readonly inputCostPerMTok: number;
  /** USD per million output tokens. */
  readonly outputCostPerMTok: number;
  /** Deterministic latency estimate in ms per 1k output tokens. */
  readonly latencyMsPer1K: number;
  /** High-risk tasks may only route to models explicitly approved for them. */
  readonly approvedForHighRisk?: boolean | undefined;
}

let models = new Map<string, ModelDescriptor>();

export function registerModel(desc: ModelDescriptor): void {
  if (models.has(desc.modelId)) {
    throw new DomainValidationError(`model already registered: ${desc.modelId}`);
  }
  if (desc.contextWindow <= 0 || desc.maxOutputTokens <= 0) {
    throw new DomainValidationError(`model ${desc.modelId} has non-positive token limits`);
  }
  models = new Map(models);
  models.set(desc.modelId, desc);
}

export function getModel(modelId: string): ModelDescriptor | undefined {
  return models.get(modelId);
}

export function listModels(): ModelDescriptor[] {
  return Array.from(models.values());
}

export function resetModelRegistry(): void {
  models = new Map();
}

/** Only explicitly declared capabilities count — an unknown name is never "supported". */
export function hasCapability(model: ModelDescriptor, capability: string): boolean {
  return model.capabilities.includes(capability);
}

export function privacyRank(model: ModelDescriptor): number {
  return PRIVACY_ORDER.indexOf(model.privacyClass);
}

/**
 * A model satisfies a required privacy class when it is at least as strict.
 * `local` can serve `cloud-approved` needs; `cloud-general` cannot serve `local`.
 */
export function satisfiesPrivacy(model: ModelDescriptor, required: PrivacyClass): boolean {
  return privacyRank(model) <= PRIVACY_ORDER.indexOf(required);
}

/** Estimated USD cost for a request with the given token sizes. */
export function estimateCostUsd(
  model: ModelDescriptor,
  contextTokens: number,
  outputTokens: number
): number {
  return (
    (contextTokens / 1_000_000) * model.inputCostPerMTok +
    (outputTokens / 1_000_000) * model.outputCostPerMTok
  );
}

/** Deterministic latency estimate in ms for the requested output size. */
export function estimateLatencyMs(model: ModelDescriptor, outputTokens: number): number {
  return (outputTokens / 1000) * model.latencyMsPer1K;
}
