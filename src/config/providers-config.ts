import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runtimeRoot } from "../privacy/state-layout.js";
import { DomainValidationError } from "../domain/errors.js";
import { isRecord } from "../domain/record.js";
import { writeFileAtomic } from "../persist/atomic-file.js";
import { withExclusiveFileLock } from "../persist/file-lock.js";
import { parseModelRef } from "./model-ref.js";

export const PROVIDERS_CONFIG_VERSION = 1 as const;
export const PROVIDERS_CONFIG_FILE = "providers.json";

export interface CustomProviderModel {
  readonly id: string;
  readonly name?: string;
  readonly contextWindow?: number;
  readonly maxTokens?: number;
  readonly inputCostPerMTok?: number;
  readonly outputCostPerMTok?: number;
  /** Reasoning-capable model: thinking levels map to provider reasoning params. */
  readonly reasoning?: boolean | undefined;
  /**
   * OpenAI-completions compat overrides (e.g. supportsReasoningEffort,
   * thinkingFormat). Passed through to pi-ai verbatim; required for
   * endpoints with mandatory reasoning such as stealth/ox-alpha.
   */
  readonly compat?: Record<string, unknown> | undefined;
}

export interface CustomProviderConfig {
  readonly id: string;
  readonly name?: string;
  readonly baseUrl: string;
  readonly envVar?: string;
  readonly models: readonly CustomProviderModel[];
}

export interface ProvidersConfig {
  readonly version: typeof PROVIDERS_CONFIG_VERSION;
  readonly enabled: readonly string[];
  readonly primary?: string;
  readonly fast?: string;
  readonly customProviders: readonly CustomProviderConfig[];
}

export function providersConfigPath(stateRoot: string): string {
  return join(runtimeRoot(stateRoot), PROVIDERS_CONFIG_FILE);
}

export function emptyProvidersConfig(): ProvidersConfig {
  return { version: PROVIDERS_CONFIG_VERSION, enabled: [], customProviders: [] };
}

export async function loadProvidersConfig(stateRoot: string): Promise<ProvidersConfig> {
  const raw = await readFile(providersConfigPath(stateRoot), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  if (raw === "") return emptyProvidersConfig();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new DomainValidationError(`invalid providers.json at ${providersConfigPath(stateRoot)}`);
  }
  return parseProvidersConfig(parsed);
}

export async function saveProvidersConfig(stateRoot: string, config: ProvidersConfig): Promise<ProvidersConfig> {
  // Whole-config saves replace the previous value; they do not merge a caller's stale snapshot.
  return withExclusiveFileLock(`${providersConfigPath(stateRoot)}.lock`, () => saveProvidersConfigLockHeld(stateRoot, config));
}

async function saveProvidersConfigLockHeld(stateRoot: string, config: ProvidersConfig): Promise<ProvidersConfig> {
  const validated = parseProvidersConfig(config);
  await writeFileAtomic(
    providersConfigPath(stateRoot),
    `${JSON.stringify(validated, null, 2)}\n`
  );
  return validated;
}

async function updateProvidersConfig(
  stateRoot: string,
  transform: (current: ProvidersConfig) => ProvidersConfig
): Promise<ProvidersConfig> {
  return withExclusiveFileLock(`${providersConfigPath(stateRoot)}.lock`, async () => {
    const current = await loadProvidersConfig(stateRoot);
    const next = transform(current);
    return next === current ? current : saveProvidersConfigLockHeld(stateRoot, next);
  });
}

export async function enableModel(stateRoot: string, catalogId: string): Promise<ProvidersConfig> {
  const id = parseModelRef(catalogId);
  const formatted = `${id.providerId}/${id.modelId}`;
  return updateProvidersConfig(stateRoot, (current) => {
    if (current.enabled.includes(formatted)) return current;
    return { ...current, enabled: [...current.enabled, formatted] };
  });
}

export async function disableModel(stateRoot: string, catalogId: string): Promise<ProvidersConfig> {
  const id = parseModelRef(catalogId);
  const formatted = `${id.providerId}/${id.modelId}`;
  return updateProvidersConfig(stateRoot, (current) => ({
    version: current.version,
    enabled: current.enabled.filter((item) => item !== formatted),
    customProviders: current.customProviders,
    ...(current.primary !== undefined && current.primary !== formatted ? { primary: current.primary } : {}),
    ...(current.fast !== undefined && current.fast !== formatted ? { fast: current.fast } : {})
  }));
}

export async function setDefaultModels(
  stateRoot: string,
  input: { readonly primary: string; readonly fast?: string }
): Promise<ProvidersConfig> {
  const primary = `${parseModelRef(input.primary).providerId}/${parseModelRef(input.primary).modelId}`;
  const fast =
    input.fast === undefined
      ? undefined
      : `${parseModelRef(input.fast).providerId}/${parseModelRef(input.fast).modelId}`;
  return updateProvidersConfig(stateRoot, (current) => {
    const enabled = [...current.enabled];
    for (const id of [primary, ...(fast !== undefined ? [fast] : [])]) {
      if (!enabled.includes(id)) enabled.push(id);
    }
    return {
      ...current,
      enabled,
      primary,
      ...(fast !== undefined ? { fast } : current.fast !== undefined ? { fast: current.fast } : {})
    };
  });
}

export function parseProvidersConfig(value: unknown): ProvidersConfig {
  if (!isRecord(value)) {
    throw new DomainValidationError("providers.json must be an object");
  }
  if (value.version !== PROVIDERS_CONFIG_VERSION) {
    throw new DomainValidationError("providers.json version must be 1");
  }
  if (!Array.isArray(value.enabled) || !value.enabled.every((id) => typeof id === "string")) {
    throw new DomainValidationError("providers.json enabled must be an array of catalog ids");
  }
  const enabled = value.enabled.map((id) => {
    const ref = parseModelRef(id);
    return `${ref.providerId}/${ref.modelId}`;
  });
  const customProviders = parseCustomProviders(value.customProviders);
  const primary = parseOptionalModelRef(value.primary, "primary");
  const fast = parseOptionalModelRef(value.fast, "fast");
  return {
    version: PROVIDERS_CONFIG_VERSION,
    enabled,
    customProviders,
    ...(primary !== undefined ? { primary } : {}),
    ...(fast !== undefined ? { fast } : {})
  };
}

function parseOptionalModelRef(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new DomainValidationError(`providers.json ${field} must be a catalog id string`);
  }
  const ref = parseModelRef(value);
  return `${ref.providerId}/${ref.modelId}`;
}

function parseCustomProviders(value: unknown): readonly CustomProviderConfig[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new DomainValidationError("providers.json customProviders must be an array");
  }
  const providerIds = new Set<string>();
  return value.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.id !== "string" || entry.id.trim() === "") {
      throw new DomainValidationError(`customProviders[${index}].id must be a non-empty string`);
    }
    if (entry.id.includes("/")) {
      throw new DomainValidationError(`customProviders[${index}].id must not contain '/'`);
    }
    const providerId = entry.id.trim();
    if (providerIds.has(providerId)) {
      throw new DomainValidationError(`duplicate provider id at customProviders[${index}]: ${providerId}`);
    }
    providerIds.add(providerId);
    for (const field of ["name", "envVar"]) {
      if (entry[field] !== undefined && typeof entry[field] !== "string") {
        throw new DomainValidationError(`customProviders[${index}].${field} must be a string`);
      }
    }
    if (typeof entry.baseUrl !== "string" || entry.baseUrl.trim() === "") {
      throw new DomainValidationError(`customProviders[${index}].baseUrl must be a non-empty string`);
    }
    if (!Array.isArray(entry.models) || entry.models.length === 0) {
      throw new DomainValidationError(`customProviders[${index}].models must be a non-empty array`);
    }
    const modelIds = new Set<string>();
    const models = entry.models.map((model, modelIndex) => {
      const path = `customProviders[${index}].models[${modelIndex}]`;
      if (!isRecord(model) || typeof model.id !== "string" || model.id.trim() === "") {
        throw new DomainValidationError(`${path}.id must be a non-empty string`);
      }
      const modelId = model.id.trim();
      if (modelIds.has(modelId)) {
        throw new DomainValidationError(`duplicate model id at ${path}: ${modelId}`);
      }
      modelIds.add(modelId);
      if (model.name !== undefined && typeof model.name !== "string") {
        throw new DomainValidationError(`${path}.name must be a string`);
      }
      for (const field of ["contextWindow", "maxTokens"]) {
        const limit = model[field];
        if (limit !== undefined && (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit <= 0)) {
          throw new DomainValidationError(`${path}.${field} must be a positive safe integer`);
        }
      }
      for (const field of ["inputCostPerMTok", "outputCostPerMTok"]) {
        const cost = model[field];
        if (cost !== undefined && (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0)) {
          throw new DomainValidationError(`${path}.${field} must be a finite non-negative number`);
        }
      }
      if (model.reasoning !== undefined && typeof model.reasoning !== "boolean") {
        throw new DomainValidationError(`${path}.reasoning must be a boolean`);
      }
      if (model.compat !== undefined && !isRecord(model.compat)) {
        throw new DomainValidationError(`${path}.compat must be an object`);
      }
      return {
        id: modelId,
        ...(typeof model.name === "string" ? { name: model.name } : {}),
        ...(typeof model.contextWindow === "number" ? { contextWindow: model.contextWindow } : {}),
        ...(typeof model.maxTokens === "number" ? { maxTokens: model.maxTokens } : {}),
        ...(typeof model.inputCostPerMTok === "number" ? { inputCostPerMTok: model.inputCostPerMTok } : {}),
        ...(typeof model.outputCostPerMTok === "number" ? { outputCostPerMTok: model.outputCostPerMTok } : {}),
        ...(typeof model.reasoning === "boolean" ? { reasoning: model.reasoning } : {}),
        ...(isRecord(model.compat) ? { compat: model.compat } : {})
      };
    });
    return {
      id: providerId,
      baseUrl: entry.baseUrl.trim(),
      models,
      ...(typeof entry.name === "string" ? { name: entry.name } : {}),
      ...(typeof entry.envVar === "string" ? { envVar: entry.envVar } : {})
    };
  });
}
