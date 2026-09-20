import { createModels, type Api, type Model, type Provider, type ProviderHeaders } from "@earendil-works/pi-ai";
import { PiAgentExecutor } from "./pi-executor.js";
import { createWorktreeCodingTools } from "./worktree-coding-tools.js";
import { createRecallTool, type ObservationProjector } from "./observation-tools.js";

export interface NativeExecutorInput {
  readonly projectRoot: string;
  readonly model: Model<Api>;
  readonly provider: Provider;
  readonly resolveAuth: () => Promise<
    { ok: true; apiKey?: string; headers?: ProviderHeaders; baseUrl?: string; env?: Record<string, string> }
    | { ok: false; error: string }
  >;
  /** Opt-in context efficiency: wrap read results through the observation projector. */
  readonly observationProjector?: ObservationProjector | undefined;
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
  const readTools = createWorktreeCodingTools({ worktreeRoot: input.projectRoot, maxReadBytes: 32_000 })
    .filter((tool) => tool.name === "sparkle_read_file");
  const projector = input.observationProjector;
  const wrappedRead = projector === undefined ? readTools : readTools.map((tool) => ({
    ...tool,
    description: `${tool.description} Large results are archived after the first two sends and replaced with a recallable placeholder.`,
    execute: async (toolCallId: string, params: unknown) => {
      const result = await tool.execute(toolCallId, params);
      const text = result.content.find((block) => block.type === "text")?.text;
      if (text === undefined) return result;
      const projected = await projector.project({ sourceId: toolCallId, text });
      return { ...result, content: [{ type: "text" as const, text: projected.text }] };
    }
  }));
  return new PiAgentExecutor({
    providerId: input.model.provider, modelId: input.model.id, models,
    systemPrompt: "You are a read-only project assistant. Inspect files and report findings with paths. Do not claim independent verification. Use sparkle_report_task_result to report the task outcome.",
    tools: projector === undefined
      ? wrappedRead
      : [...wrappedRead, createRecallTool(projector)]
  });
}
