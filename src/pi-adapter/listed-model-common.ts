import type { Api, Model } from "@earendil-works/pi-ai";
import { formatModelRef } from "../config/model-ref.js";
import type { CustomProviderConfig } from "../config/providers-config.js";

export interface SparkleListedModel {
  readonly catalogId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly name: string;
  readonly version: string;
  readonly contextWindow: number;
  readonly maxOutputTokens: number;
  readonly inputCostPerMTok: number;
  readonly outputCostPerMTok: number;
  readonly capabilities: readonly string[];
}

export function listedModelsFromCustom(provider: CustomProviderConfig): SparkleListedModel[] {
  return provider.models.map((model) => ({
    catalogId: formatModelRef(provider.id, model.id),
    providerId: provider.id,
    modelId: model.id,
    name: model.name ?? model.id,
    version: model.id,
    contextWindow: model.contextWindow ?? 8192,
    maxOutputTokens: model.maxTokens ?? 4096,
    inputCostPerMTok: model.inputCostPerMTok ?? 0,
    outputCostPerMTok: model.outputCostPerMTok ?? 0,
    capabilities: ["tool-use"]
  }));
}

export function fromPiModel(model: Model<Api>): SparkleListedModel {
  const capabilities = ["tool-use"];
  if (model.input.includes("image")) capabilities.push("vision");
  if (model.reasoning) capabilities.push("reasoning");
  return {
    catalogId: formatModelRef(String(model.provider), model.id),
    providerId: String(model.provider),
    modelId: model.id,
    name: model.name,
    version: model.id,
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxTokens,
    inputCostPerMTok: model.cost.input,
    outputCostPerMTok: model.cost.output,
    capabilities
  };
}
