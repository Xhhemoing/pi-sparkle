import { getBuiltinModel, getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import type { CustomProviderConfig } from "../config/providers-config.js";
import { fromPiModel, listedModelsFromCustom, type SparkleListedModel } from "./listed-model-common.js";

export { listedModelsFromCustom };
export type { SparkleListedModel };

export function describeSparkleModel(providerId: string, modelId: string): SparkleListedModel | undefined {
  try {
    const model = getBuiltinModel(providerId as never, modelId as never);
    return fromPiModel(model);
  } catch {
    return undefined;
  }
}

export function listSparkleModels(providerId?: string): SparkleListedModel[] {
  if (providerId !== undefined) {
    try {
      return getBuiltinModels(providerId as never).map(fromPiModel);
    } catch {
      return [];
    }
  }
  const out: SparkleListedModel[] = [];
  for (const provider of getBuiltinProviders()) {
    out.push(...getBuiltinModels(provider).map(fromPiModel));
  }
  return out;
}

export function listSparkleProviders(): string[] {
  return [...getBuiltinProviders()];
}

export function resolveListedModel(
  providerId: string,
  modelId: string,
  customProviders: readonly CustomProviderConfig[] = []
): SparkleListedModel | undefined {
  const builtin = describeSparkleModel(providerId, modelId);
  if (builtin !== undefined) return builtin;
  const custom = customProviders.find((item) => item.id === providerId);
  if (custom === undefined) return undefined;
  return listedModelsFromCustom(custom).find((item) => item.modelId === modelId);
}
