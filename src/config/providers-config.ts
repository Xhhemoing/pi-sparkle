import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { runtimeRoot } from "../privacy/state-layout.js";
import { DomainValidationError } from "../domain/errors.js";
import { isRecord } from "../domain/record.js";
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
  const validated = parseProvidersConfig(config);
  await writeAtomicJson(providersConfigPath(stateRoot), validated);
  return validated;
}

export async function enableModel(stateRoot: string, catalogId: string): Promise<ProvidersConfig> {
  const id = parseModelRef(catalogId);
  const formatted = `${id.providerId}/${id.modelId}`;
  const current = await loadProvidersConfig(stateRoot);
  if (current.enabled.includes(formatted)) return current;
  return saveProvidersConfig(stateRoot, { ...current, enabled: [...current.enabled, formatted] });
}

export async function disableModel(stateRoot: string, catalogId: string): Promise<ProvidersConfig> {
  const id = parseModelRef(catalogId);
  const formatted = `${id.providerId}/${id.modelId}`;
  const current = await loadProvidersConfig(stateRoot);
  const enabled = current.enabled.filter((item) => item !== formatted);
  const next: ProvidersConfig = {
    version: current.version,
    enabled,
    customProviders: current.customProviders,
    ...(current.primary !== undefined && current.primary !== formatted ? { primary: current.primary } : {}),
    ...(current.fast !== undefined && current.fast !== formatted ? { fast: current.fast } : {})
  };
  return saveProvidersConfig(stateRoot, next);
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
  const current = await loadProvidersConfig(stateRoot);
  const enabled = [...current.enabled];
  for (const id of [primary, ...(fast !== undefined ? [fast] : [])]) {
    if (!enabled.includes(id)) enabled.push(id);
  }
  return saveProvidersConfig(stateRoot, {
    ...current,
    enabled,
    primary,
    ...(fast !== undefined ? { fast } : current.fast !== undefined ? { fast: current.fast } : {})
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
  const primary =
    value.primary === undefined ? undefined : `${parseModelRef(String(value.primary)).providerId}/${parseModelRef(String(value.primary)).modelId}`;
  const fast =
    value.fast === undefined ? undefined : `${parseModelRef(String(value.fast)).providerId}/${parseModelRef(String(value.fast)).modelId}`;
  return {
    version: PROVIDERS_CONFIG_VERSION,
    enabled,
    customProviders,
    ...(primary !== undefined ? { primary } : {}),
    ...(fast !== undefined ? { fast } : {})
  };
}

function parseCustomProviders(value: unknown): readonly CustomProviderConfig[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new DomainValidationError("providers.json customProviders must be an array");
  }
  return value.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.id !== "string" || entry.id.trim() === "") {
      throw new DomainValidationError(`customProviders[${index}].id must be a non-empty string`);
    }
    if (entry.id.includes("/")) {
      throw new DomainValidationError(`customProviders[${index}].id must not contain '/'`);
    }
    if (typeof entry.baseUrl !== "string" || entry.baseUrl.trim() === "") {
      throw new DomainValidationError(`customProviders[${index}].baseUrl must be a non-empty string`);
    }
    if (!Array.isArray(entry.models) || entry.models.length === 0) {
      throw new DomainValidationError(`customProviders[${index}].models must be a non-empty array`);
    }
    const models = entry.models.map((model, modelIndex) => {
      if (!isRecord(model) || typeof model.id !== "string" || model.id.trim() === "") {
        throw new DomainValidationError(`customProviders[${index}].models[${modelIndex}].id must be a non-empty string`);
      }
      return {
        id: model.id.trim(),
        ...(typeof model.name === "string" ? { name: model.name } : {}),
        ...(typeof model.contextWindow === "number" ? { contextWindow: model.contextWindow } : {}),
        ...(typeof model.maxTokens === "number" ? { maxTokens: model.maxTokens } : {}),
        ...(typeof model.inputCostPerMTok === "number" ? { inputCostPerMTok: model.inputCostPerMTok } : {}),
        ...(typeof model.outputCostPerMTok === "number" ? { outputCostPerMTok: model.outputCostPerMTok } : {})
      };
    });
    return {
      id: entry.id.trim(),
      baseUrl: entry.baseUrl.trim(),
      models,
      ...(typeof entry.name === "string" ? { name: entry.name } : {}),
      ...(typeof entry.envVar === "string" ? { envVar: entry.envVar } : {})
    };
  });
}

async function writeAtomicJson(path: string, value: unknown): Promise<void> {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  const handle = await open(tempPath, "w");
  try {
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tempPath, path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "EEXIST" && code !== "EACCES") throw error;
    await unlink(path);
    await rename(tempPath, path);
  }
}
