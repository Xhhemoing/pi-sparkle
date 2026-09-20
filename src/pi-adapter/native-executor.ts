import { createModels, type Api, type Model, type Provider, type ProviderHeaders } from "@earendil-works/pi-ai";
import { PiAgentExecutor } from "./pi-executor.js";
import { createWorktreeCodingTools } from "./worktree-coding-tools.js";

export interface NativeExecutorInput {
  readonly projectRoot: string;
  readonly model: Model<Api>;
  readonly provider: Provider;
  readonly resolveAuth: () => Promise<
    { ok: true; apiKey?: string; headers?: ProviderHeaders; baseUrl?: string; env?: Record<string, string> }
    | { ok: false; error: string }
  >;
}

/** Reuse the host's effective provider; resolve auth at request time, never persist it. */
export function createNativeExecutor(input: NativeExecutorInput): PiAgentExecutor {
  const models = createModels();
  const provider = input.provider;
  models.setProvider({
    id: provider.id, name: provider.name,
    getModels: () => [input.model],
    auth: { apiKey: {
      name: "Pi session auth",
      resolve: async () => {
        const auth = await input.resolveAuth();
        if (!auth.ok) throw new Error("Pi session authentication unavailable");
        return { auth: {
          ...(auth.apiKey !== undefined ? { apiKey: auth.apiKey } : {}),
          ...(auth.headers !== undefined ? { headers: auth.headers } : {}),
          ...(auth.baseUrl !== undefined ? { baseUrl: auth.baseUrl } : {})
        }, ...(auth.env !== undefined ? { env: auth.env } : {}) };
      }
    } },
    stream: (model, context, options) => provider.stream(model, context, options),
    streamSimple: (model, context, options) => provider.streamSimple(model, context, options)
  });
  return new PiAgentExecutor({
    providerId: input.model.provider, modelId: input.model.id, models,
    systemPrompt: "You are a read-only project assistant. Inspect files and report findings with paths. Do not claim independent verification. Use sparkle_report_task_result to report the task outcome.",
    tools: createWorktreeCodingTools({ worktreeRoot: input.projectRoot, maxReadBytes: 32_000 })
      .filter((tool) => tool.name === "sparkle_read_file")
  });
}
