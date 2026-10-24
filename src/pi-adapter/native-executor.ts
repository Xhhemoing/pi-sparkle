import { captureNativeHostContext } from "./native-host-context.js";
import type { Api, AssistantMessageEventStream, Model, MutableModels } from "@earendil-works/pi-ai";
import type { AgentExecutor } from "../execution/contract.js";
import { PiAgentExecutor, type SparkleThinkingLevel } from "./pi-executor.js";
import { createWorktreeCodingTools } from "./worktree-coding-tools.js";
import { createRecallTool, type ObservationProjector } from "./observation-tools.js";

export interface NativeExecutorInput {
  readonly projectRoot: string;
  /** Exact effective host prompt; an explicitly empty prompt is valid. */
  readonly effectiveSystemPrompt: string;
  /** Prepared host-approved resource text, reused by every attempt. */
  readonly approvedResourcePayload?: string | undefined;
  /** Host selection sampled when delegation is admitted. */
  readonly thinkingLevel: SparkleThinkingLevel;
  /** Exact eligible host-registry snapshot used to build the routing catalog. */
  readonly models: readonly Model<Api>[];
  /** Default requested model; must be a member of models. */
  readonly defaultModel: Model<Api>;
  /** Host registry dispatch. It owns provider lookup and request-time auth. */
  // The host and app may load different supported Pi versions. Their stream
  // classes have distinct private identities, but this boundary only relies
  // on the public API and returns the original host-owned stream unchanged.
  readonly streamSimple: (...args: Parameters<MutableModels["streamSimple"]>) =>
    Pick<AssistantMessageEventStream, keyof AssistantMessageEventStream>;
  /** Opt-in context efficiency: wrap read results through the observation projector. */
  readonly observationProjector?: ObservationProjector | undefined;
}

export function createNativeExecutor(input: NativeExecutorInput): AgentExecutor {
  const { models, defaultModel, supportedModelIds } = captureNativeHostContext(input);
  const readTools = createWorktreeCodingTools({ worktreeRoot: input.projectRoot, maxReadBytes: 32_000 })
    .filter((tool) => tool.name === "sparkle_read_file");
  const projector = input.observationProjector;
  const wrappedRead = projector === undefined ? readTools : readTools.map((tool) => ({
    ...tool,
    description: `${tool.description} Large results are archived after the first two sends and replaced with a recallable placeholder.`,
    execute: async (toolCallId: string, params: unknown) => {
      try {
        const result = await tool.execute(toolCallId, params);
        const text = result.content.find((block) => block.type === "text")?.text;
        if (text === undefined) return result;
        const resolvedReadPath = typeof result.details === "object" && result.details !== null
          && "resolvedPath" in result.details && typeof result.details.resolvedPath === "string"
          ? result.details.resolvedPath
          : undefined;
        const projected = await projector.project({
          sourceId: toolCallId,
          text,
          toolParams: params,
          ...(resolvedReadPath !== undefined ? { resolvedReadPath } : {}),
          projectability: {
            resultKind: "observation",
            isError: false,
            mutatesState: false,
            securityCritical: false,
            toolKind: "read",
            toolPolicyProjectable: true
          }
        });
        return { ...result, content: [{ type: "text" as const, text: projected.text }] };
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        await projector.project({
          sourceId: toolCallId,
          text,
          isError: true,
          toolParams: params,
          projectability: {
            resultKind: "error",
            isError: true,
            mutatesState: false,
            securityCritical: false,
            toolKind: "read",
            toolPolicyProjectable: false
          }
        });
        throw error;
      }
    }
  }));
  const delegate = new PiAgentExecutor({
    providerId: defaultModel.provider, modelId: defaultModel.id, models,
    systemPrompt: input.effectiveSystemPrompt,
    thinkingLevel: input.thinkingLevel,
    approvedResourcePayload: input.approvedResourcePayload,
    tools: projector === undefined
      ? wrappedRead
      : [...wrappedRead, createRecallTool(projector)]
  });

  return {
    supportedModelIds,
    execute: (request, signal) => delegate.execute({
      ...request,
      // Worker scope remains explicit without changing the inherited host prompt.
      prompt: "You are a read-only project assistant. Inspect files and report findings with paths. Do not claim independent verification. Use sparkle_report_task_result to report the task outcome.\n\n" + request.prompt
    }, signal),
    steerText: (text, agentInstanceId) => delegate.steerText(text, agentInstanceId)
  };
}
