import { DomainValidationError } from "../domain/errors.js";

export type PrivacyClass = "local" | "cloud-approved" | "cloud-general";
export const PRIVACY_ORDER: readonly PrivacyClass[] = ["local", "cloud-approved", "cloud-general"] as const;

/** Providers that never leave the machine. Everything else is cloud-general. */
const LOCAL_PROVIDER_IDS = new Set(["ollama", "lmstudio", "llamacpp", "llama.cpp", "local"]);

/**
 * Infer a catalog privacy class from a provider id. Listed models must
 * carry a declared class so live eligibility is not silently undeclared.
 * Unknown / remote providers are `cloud-general`, not `cloud-approved`.
 */
export function inferPrivacyClass(providerId: string): PrivacyClass {
  const normalized = providerId.trim().toLowerCase();
  if (LOCAL_PROVIDER_IDS.has(normalized) || normalized.startsWith("local-")) {
    return "local";
  }
  return "cloud-general";
}

export type ProviderPolicy = "approved" | "forbidden";

export interface ModelDescriptor {
  readonly modelId: string;
  readonly providerId: string;
  readonly version: string;
  readonly contextWindow?: number | undefined;
  readonly maxOutputTokens?: number | undefined;
  /** Explicitly declared capabilities only — anything else is unsupported. */
  readonly capabilities: readonly string[];
  readonly privacyClass?: PrivacyClass | undefined;
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

/**
 * Pure descriptor validation. There is no module-level model registry:
 * live routing and library R0 both receive explicit `models[]` so tests and
 * production share exactly one catalog source (routing final plan F1).
 */
export function validateModelDescriptor(desc: ModelDescriptor): ModelDescriptor {
  if (desc.modelId.trim() === "") {
    throw new DomainValidationError("model descriptor requires a modelId");
  }
  if (desc.version.trim() === "") {
    throw new DomainValidationError(`model ${desc.modelId} must declare version`);
  }
  if (
    (desc.contextWindow !== undefined && desc.contextWindow <= 0) ||
    (desc.maxOutputTokens !== undefined && desc.maxOutputTokens <= 0)
  ) {
    throw new DomainValidationError(`model ${desc.modelId} has non-positive token limits`);
  }
  return desc;
}

/** Only explicitly declared capabilities count — an unknown name is never "supported". */
export function hasCapability(model: ModelDescriptor, capability: string): boolean {
  return model.capabilities.includes(capability);
}

export function privacyRank(model: ModelDescriptor): number {
  if (model.privacyClass === undefined) return Number.POSITIVE_INFINITY;
  return PRIVACY_ORDER.indexOf(model.privacyClass);
}

/**
 * A model satisfies a required privacy class when it is at least as strict.
 * `local` can serve `cloud-approved` needs; `cloud-general` cannot serve `local`.
 * Undeclared privacy fails closed for everything stricter than the most
 * permissive class — never pretend an unknown provider status can serve
 * local or approved-cloud-only data.
 */
export function satisfiesPrivacy(model: ModelDescriptor, required: PrivacyClass): boolean {
  if (model.privacyClass === undefined) {
    return required === "cloud-general";
  }
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
