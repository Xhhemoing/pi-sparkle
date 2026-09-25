import type { Api, Model, MutableModels } from "@earendil-works/pi-ai";
import { formatModelRef } from "../config/model-ref.js";
import { DomainValidationError } from "../domain/errors.js";
import type { AgentExecutor } from "../execution/contract.js";
import { PiAgentExecutor } from "./pi-executor.js";
import { createWorktreeCodingTools } from "./worktree-coding-tools.js";
import { createRecallTool, type ObservationProjector } from "./observation-tools.js";

export interface NativeExecutorInput {
  readonly projectRoot: string;
  /** Exact eligible host-registry snapshot used to build the routing catalog. */
  readonly models: readonly Model<Api>[];
  /** Default requested model; must be a member of models. */
  readonly defaultModel: Model<Api>;
  /** Host registry dispatch. It owns provider lookup and request-time auth. */
  readonly streamSimple: MutableModels["streamSimple"];
  /** Opt-in context efficiency: wrap read results through the observation projector. */
  readonly observationProjector?: ObservationProjector | undefined;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null) return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested, seen);
  }
  return Object.freeze(value);
}

function immutableModelSnapshot(model: Model<Api>): Model<Api> {
  try {
    return deepFreeze(structuredClone(model));
  } catch {
    throw new DomainValidationError(
      `native executor model must be structured-cloneable: ${model.provider}/${model.id}`
    );
  }
}

/** Reuse host model objects and host stream dispatch; credentials never cross this bridge. */
export function createNativeExecutor(input: NativeExecutorInput): AgentExecutor {
  if (input.models.length === 0) {
    throw new DomainValidationError("native executor requires at least one eligible host model");
  }
  const byRef = new Map<string, Model<Api>>();
  for (const model of input.models) {
    let ref: string;
    try {
      ref = formatModelRef(model.provider, model.id);
    } catch {
      throw new DomainValidationError(
        `native executor model refs must use a canonical provider without slash and trimmed model id: ${model.provider}/${model.id}`
      );
    }
    if (model.provider !== model.provider.trim() || model.id !== model.id.trim()) {
      throw new DomainValidationError(`native executor model refs must be canonical provider/model: ${ref}`);
    }
    if (byRef.has(ref)) throw new DomainValidationError(`duplicate native executor model ref: ${ref}`);
    byRef.set(ref, immutableModelSnapshot(model));
  }
  if (
    input.defaultModel.provider !== input.defaultModel.provider.trim() ||
    input.defaultModel.id !== input.defaultModel.id.trim()
  ) {
    throw new DomainValidationError(
      "native executor default model components must be canonical without surrounding whitespace"
    );
  }
  let defaultRef: string;
  try {
    defaultRef = formatModelRef(input.defaultModel.provider, input.defaultModel.id);
  } catch {
    throw new DomainValidationError("native executor default model must use a canonical provider/model ref");
  }
  const defaultModel = byRef.get(defaultRef);
  if (defaultModel === undefined) {
    throw new DomainValidationError(`native executor default model must be eligible: ${defaultRef}`);
  }
  const models = {
    getModel: (providerId: string, modelId: string) => byRef.get(`${providerId}/${modelId}`),
    streamSimple: input.streamSimple
  } as MutableModels;
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
        const projected = await projector.project({
          sourceId: toolCallId,
          text,
          toolParams: params,
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
    systemPrompt: "You are a read-only project assistant. Inspect files and report findings with paths. Do not claim independent verification. Use sparkle_report_task_result to report the task outcome.",
    tools: projector === undefined
      ? wrappedRead
      : [...wrappedRead, createRecallTool(projector)]
  });
  const supportedModelIds = Object.freeze([...byRef.keys()]);
  return {
    supportedModelIds,
    execute: (request, signal) => delegate.execute(request, signal),
    steerText: (text, agentInstanceId) => delegate.steerText(text, agentInstanceId)
  };
}
