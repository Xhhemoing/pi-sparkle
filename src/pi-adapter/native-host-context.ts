import type { Api, AssistantMessageEventStream, Model, MutableModels } from "@earendil-works/pi-ai";
import { formatModelRef } from "../config/model-ref.js";
import { DomainValidationError } from "../domain/errors.js";
import { captureThinkingBudgets, type SparkleThinkingBudgets } from "./thinking-budgets.js";
import type { SparkleThinkingLevel } from "./pi-executor.js";

/** Host-only configuration. Dispatch retains request-time host authentication. */
export interface NativeHostContextInput {
  readonly effectiveSystemPrompt: string;
  readonly approvedResourcePayload?: string | undefined;
  readonly thinkingLevel: SparkleThinkingLevel;
  readonly thinkingBudgets?: SparkleThinkingBudgets | undefined;
  readonly models: readonly Model<Api>[];
  readonly defaultModel: Model<Api>;
  readonly streamSimple: (...args: Parameters<MutableModels["streamSimple"]>) =>
    Pick<AssistantMessageEventStream, keyof AssistantMessageEventStream>;
}
export interface CapturedNativeHostContext {
  readonly effectiveSystemPrompt: string;
  readonly approvedResourcePayload: string | undefined;
  readonly thinkingLevel: SparkleThinkingLevel;
  readonly thinkingBudgets?: SparkleThinkingBudgets | undefined;
  readonly defaultModel: Model<Api>;
  readonly models: MutableModels;
  readonly supportedModelIds: readonly string[];
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
    const credentialFree: Record<PropertyKey, unknown> = {};
    for (const key of Reflect.ownKeys(model)) {
      if (key === "headers") continue;
      const descriptor = Object.getOwnPropertyDescriptor(model, key);
      if (descriptor?.enumerable === true) credentialFree[key] = Reflect.get(model, key);
    }
    return deepFreeze(structuredClone(credentialFree)) as unknown as Model<Api>;
  } catch {
    throw new DomainValidationError(
      `native executor model must be structured-cloneable: ${model.provider}/${model.id}`
    );
  }
}

/** Reuse host model objects and host stream dispatch; credentials never cross this bridge. */
export function captureNativeHostContext(input: NativeHostContextInput): CapturedNativeHostContext {
  const thinkingBudgets = captureThinkingBudgets(input);
  if (typeof input.effectiveSystemPrompt !== "string") {
    throw new DomainValidationError("native executor requires an explicit effective host system prompt");
  }
  if (!["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(input.thinkingLevel)) {
    throw new DomainValidationError("native executor requires an explicit valid host thinking level");
  }
  if (input.models.length === 0) {
    throw new DomainValidationError("native executor requires at least one eligible host model");
  }
  const byRef = new Map<string, Model<Api>>();
  const hostByRef = new Map<string, Model<Api>>();
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
    hostByRef.set(ref, model);
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
    streamSimple: (selected: Model<Api>, context: Parameters<MutableModels["streamSimple"]>[1], options: Parameters<MutableModels["streamSimple"]>[2]) => {
      const ref = `${selected.provider}/${selected.id}`;
      const hostModel = hostByRef.get(ref);
      if (hostModel === undefined) {
        throw new DomainValidationError(`native executor dispatch model is outside the host snapshot: ${ref}`);
      }
      if (`${hostModel.provider}/${hostModel.id}` !== ref) {
        throw new DomainValidationError(`native executor host model identity drifted after snapshot: ${ref}`);
      }
      return input.streamSimple(hostModel, context, options);
    }
  } as MutableModels;
  return Object.freeze({ effectiveSystemPrompt: input.effectiveSystemPrompt, thinkingLevel: input.thinkingLevel,
    ...(thinkingBudgets === undefined ? {} : { thinkingBudgets }),
    approvedResourcePayload: input.approvedResourcePayload, defaultModel, models,
    supportedModelIds: Object.freeze([...byRef.keys()]) });
}
