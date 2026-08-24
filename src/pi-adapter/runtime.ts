import { createProvider, envApiKeyAuth, type Model, type MutableModels } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { CustomProviderConfig } from "../config/providers-config.js";
import { loadProvidersConfig } from "../config/providers-config.js";
import type { ModelRef } from "../config/model-ref.js";
import type { ModelInvocation } from "../telemetry/model-invocation.js";
import { authStorePath, FileCredentialStore } from "./file-credential-store.js";
import { PiAgentExecutor } from "./pi-executor.js";
import type { RetryOptions } from "./provider-retry.js";

export interface PiRuntime {
  readonly models: MutableModels;
  readonly credentials: FileCredentialStore;
}

export async function createPiRuntime(input: {
  readonly stateRoot: string;
  readonly customProviders?: readonly CustomProviderConfig[];
}): Promise<PiRuntime> {
  const { builtinModels } = await import("@earendil-works/pi-ai/providers/all");
  const credentials = new FileCredentialStore(authStorePath(input.stateRoot));
  const models = builtinModels({ credentials });
  for (const custom of input.customProviders ?? []) {
    models.setProvider(buildCustomProvider(custom));
  }
  return { models, credentials };
}

export async function createConfiguredPiExecutor(input: {
  readonly stateRoot: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly thinkingLevel?: ThinkingLevel;
  readonly apiKey?: string;
  readonly aliases?: Readonly<Record<string, ModelRef>>;
  readonly customProviders?: readonly CustomProviderConfig[];
  readonly systemPrompt?: string;
  /** Overrides the executor's default bounded 429/5xx retry. */
  readonly retry?: RetryOptions;
  readonly onInvocation?: (invocation: ModelInvocation) => void;
}): Promise<PiAgentExecutor> {
  // Omitted customProviders means "load the state root's providers.json";
  // callers may still pass an explicit list (tests, embedded setups).
  const customProviders =
    input.customProviders ??
    (await loadProvidersConfig(input.stateRoot)).customProviders;
  const { models } = await createPiRuntime({
    stateRoot: input.stateRoot,
    customProviders
  });
  return new PiAgentExecutor({
    providerId: input.providerId,
    modelId: input.modelId,
    models,
    ...(input.thinkingLevel !== undefined ? { thinkingLevel: input.thinkingLevel } : {}),
    ...(input.apiKey !== undefined ? { apiKey: input.apiKey } : {}),
    ...(input.aliases !== undefined ? { aliases: input.aliases } : {}),
    ...(input.systemPrompt !== undefined ? { systemPrompt: input.systemPrompt } : {}),
    ...(input.retry !== undefined ? { retry: input.retry } : {}),
    ...(input.onInvocation !== undefined ? { onInvocation: input.onInvocation } : {})
  });
}

function buildCustomProvider(config: CustomProviderConfig) {
  const models: Model<"openai-completions">[] = config.models.map((model) => ({
    id: model.id,
    name: model.name ?? model.id,
    api: "openai-completions",
    provider: config.id,
    baseUrl: config.baseUrl,
    reasoning: model.reasoning ?? false,
    input: ["text"],
    cost: {
      input: model.inputCostPerMTok ?? 0,
      output: model.outputCostPerMTok ?? 0,
      cacheRead: 0,
      cacheWrite: 0
    },
    contextWindow: model.contextWindow ?? 8192,
    maxTokens: model.maxTokens ?? 4096,
    compat: {
      supportsDeveloperRole: false,
      ...(model.compat !== undefined ? (model.compat as Record<string, never>) : {})
    }
  }));
  const envVar = config.envVar;
  return createProvider({
    id: config.id,
    ...(config.name !== undefined ? { name: config.name } : {}),
    baseUrl: config.baseUrl,
    auth: {
      apiKey:
        envVar !== undefined && envVar.trim() !== ""
          ? envApiKeyAuth(`${config.name ?? config.id} API key`, [envVar])
          : {
              name: `${config.name ?? config.id} (local)`,
              resolve: async () => ({ auth: {}, source: `${config.id} (no key)` })
            }
    },
    models,
    api: openAICompletionsApi()
  });
}
