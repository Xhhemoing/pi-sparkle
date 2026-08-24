/* eslint-disable @typescript-eslint/no-explicit-any --
 * Pi's public API is generic over schema/detail types; the adapter boundary
 * is where that generality is absorbed. */
import {
  Agent,
  type AgentEvent,
  type AgentTool,
  type ThinkingLevel
} from "@earendil-works/pi-agent-core";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type Api,
  type AssistantMessageEventStream,
  type Context,
  type FauxProviderHandle,
  type Model,
  type MutableModels,
  type SimpleStreamOptions
} from "@earendil-works/pi-ai";
import type { AgentExecutionRequest, AgentExecutor, ExecutionEvent } from "../execution/contract.js";
import type { ModelRef } from "../config/model-ref.js";
import { tryParseModelRef } from "../config/model-ref.js";
import { hash32 } from "../domain/hash.js";
import { createInvocationId, createMessageId } from "../domain/ids.js";
import { nowIso } from "../domain/timestamp.js";
import { SUPERVISOR } from "../protocol/v1.js";
import { hashInvocationResponse, recordInvocation } from "../telemetry/model-invocation.js";
import type { ModelInvocation } from "../telemetry/model-invocation.js";
import { createClusterTools } from "./cluster-tools.js";

/**
 * Thinking levels this runtime accepts, owned here rather than re-exported from
 * Pi so callers never depend on a Pi type (ADR-001). Assignability to Pi's own
 * ThinkingLevel is checked where the Agent is built; a narrowed Pi union fails
 * there, at the boundary, rather than in callers.
 */
export type SparkleThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export interface PiExecutorOptions {
  providerId: string;
  modelId: string;
  systemPrompt?: string;
  thinkingLevel?: SparkleThinkingLevel;
  tools?: AgentTool<any>[];
  apiKey?: string;
  /** Injected Models collection. Tests and the configured factory pass this. */
  models?: MutableModels;
  /** cheap/premium (and similar) aliases to a concrete provider/model pair. */
  aliases?: Readonly<Record<string, ModelRef>>;
  /** Provider-pinned model version, recorded with each invocation when known. */
  modelVersion?: string;
  /**
   * Optional sink receiving one validated invocation record per execute()
   * call: frozen configuration snapshot, response hash, usage, and latency.
   * The response body itself is never persisted — only its hash.
   */
  onInvocation?: (invocation: ModelInvocation) => void;
}

export function translatePiEvent(event: AgentEvent): ExecutionEvent | undefined {
  switch (event.type) {
    case "message_update": {
      if (event.assistantMessageEvent.type === "text_delta") {
        return { type: "TEXT_DELTA", text: event.assistantMessageEvent.delta };
      }
      return undefined;
    }
    case "tool_execution_start":
      return { type: "TOOL_STARTED", toolCallId: event.toolCallId, toolName: event.toolName };
    case "tool_execution_end":
      return {
        type: "TOOL_FINISHED",
        toolCallId: event.toolCallId,
        isError: event.isError,
        summary: event.isError ? `tool error: ${event.toolName}` : `tool finished: ${event.toolName}`
      };
    case "turn_end": {
      // Usage flows on the assistant message; without it cost telemetry is
      // blind (tokensIn/tokensOut stay undefined and cost gates cannot run).
      const message = event.message as { role?: string; usage?: { input?: number; output?: number } };
      const usage = message.role === "assistant" ? message.usage : undefined;
      const rawInput = typeof usage?.input === "number" ? usage.input : undefined;
      const rawOutput = typeof usage?.output === "number" ? usage.output : undefined;
      // All-zero usage is what error payloads and stub providers report;
      // recording it would fabricate cost data ("undefined, never zero").
      const allZero = rawInput === 0 && (rawOutput === undefined || rawOutput === 0);
      const inputTokens = allZero ? undefined : rawInput;
      const outputTokens = allZero ? undefined : rawOutput;
      if (inputTokens === undefined && outputTokens === undefined) {
        return { type: "TURN_FINISHED" };
      }
      return {
        type: "TURN_FINISHED",
        usage: {
          ...(inputTokens !== undefined ? { inputTokens } : {}),
          ...(outputTokens !== undefined ? { outputTokens } : {})
        }
      };
    }
    default:
      return undefined;
  }
}

export class PiAgentExecutor implements AgentExecutor {
  private readonly models: MutableModels;
  private readonly faux?: FauxProviderHandle;

  constructor(private readonly options: PiExecutorOptions) {
    if (options.models !== undefined) {
      this.models = options.models;
      return;
    }
    this.models = createModels();
    if (options.providerId === "faux") {
      this.faux = fauxProvider();
      this.models.setProvider(this.faux.provider);
      this.faux.setResponses([fauxAssistantMessage("Faux response: task acknowledged.")]);
    }
  }

  private resolveIdentity(request: AgentExecutionRequest): ModelRef {
    const rawModel = request.modelId ?? this.options.modelId;
    const alias = this.options.aliases?.[rawModel];
    if (alias !== undefined) return alias;
    const parsed = tryParseModelRef(rawModel);
    if (parsed !== undefined) {
      // Model ids may contain slashes themselves (e.g. openrouter
      // "stealth/ox-alpha"). A "prefix/model" string is treated as a catalog
      // ref only when its prefix matches the authoritative provider;
      // otherwise the executor's own provider wins and the string stays whole.
      const explicitProvider = request.providerId ?? this.options.providerId;
      if (explicitProvider === undefined) return parsed;
      if (parsed.providerId === explicitProvider) {
        return { providerId: explicitProvider, modelId: parsed.modelId };
      }
      return { providerId: explicitProvider, modelId: rawModel };
    }
    return {
      providerId: request.providerId ?? this.options.providerId,
      modelId: rawModel
    };
  }

  private resolveModel(request: AgentExecutionRequest): { identity: ModelRef; model: Model<Api> } | undefined {
    const identity = this.resolveIdentity(request);
    if (this.faux !== undefined && identity.providerId === "faux") {
      const model = this.faux.getModel();
      return model === undefined ? undefined : { identity, model };
    }
    const model = this.models.getModel(identity.providerId, identity.modelId);
    return model === undefined ? undefined : { identity, model };
  }

  async *execute(request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    const resolved = this.resolveModel(request);
    if (resolved === undefined) {
      yield { type: "EXECUTION_FINISHED", outcome: "FAILURE" };
      return;
    }
    const { identity, model } = resolved;

    const startedAtMs = Date.now();
    const collected: ExecutionEvent[] = [];
    const clusterTools = request.cluster !== undefined ? createClusterTools(request.cluster) : [];
    const thinkingLevel: ThinkingLevel = this.options.thinkingLevel ?? "off";
    const agent = new Agent({
      initialState: {
        systemPrompt: this.options.systemPrompt ?? "",
        model,
        thinkingLevel,
        tools: [...(this.options.tools ?? []), ...clusterTools]
      },
      streamFn: (streamModel: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream =>
        this.models.streamSimple(streamModel, context, {
          ...options,
          ...(this.options.apiKey !== undefined && streamModel.provider === this.options.providerId
            ? { apiKey: this.options.apiKey }
            : {})
        })
    });

    let runFailed = false;
    const onAbort = () => agent.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      agent.subscribe((event) => {
        const translated = translatePiEvent(event);
        if (translated !== undefined) collected.push(translated);
      });
      await agent.prompt(`Working directory: ${request.workingDirectory}\n\n${request.prompt}`);
      await agent.waitForIdle();
    } catch {
      runFailed = !signal.aborted;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }

    if (this.options.onInvocation !== undefined) {
      this.options.onInvocation(recordInvocation(this.buildInvocation(request, identity, collected, startedAtMs)));
    }

    for (const event of collected) yield event;
    const outcome = signal.aborted
      ? "CANCELLED"
      : runFailed || agent.state.errorMessage !== undefined
        ? "FAILURE"
        : "SUCCESS";
    if (!collected.some((event) => event.type === "MESSAGE" && event.message.type === "TASK_RESULT")) {
      yield {
        type: "MESSAGE",
        message: {
          protocolVersion: 1,
          id: createMessageId(),
          occurredAt: nowIso(),
          runId: request.runId,
          taskId: request.taskId,
          from: request.agentInstanceId,
          to: SUPERVISOR,
          type: "TASK_RESULT",
          outcome,
          summary: "pi agent finished",
          artifactIds: [],
          evidenceIds: [],
          verification: { kind: "UNOBSERVED", evidenceIds: [] }
        }
      };
    }
    yield { type: "EXECUTION_FINISHED", outcome };
  }

  /**
   * Build the reference-only invocation record: frozen configuration hash,
   * response-body hash, provider usage when available (undefined, not zero,
   * when unavailable), and wall-clock latency. No prompt or response body is
   * retained.
   */
  private buildInvocation(
    request: AgentExecutionRequest,
    identity: ModelRef,
    collected: readonly ExecutionEvent[],
    startedAtMs: number
  ): ModelInvocation {
    let responseText = "";
    let tokensIn: number | undefined;
    let tokensOut: number | undefined;
    for (const event of collected) {
      if (event.type === "TEXT_DELTA") {
        responseText += event.text;
      } else if (event.type === "TURN_FINISHED" && event.usage !== undefined) {
        if (event.usage.inputTokens !== undefined) {
          tokensIn = (tokensIn ?? 0) + event.usage.inputTokens;
        }
        if (event.usage.outputTokens !== undefined) {
          tokensOut = (tokensOut ?? 0) + event.usage.outputTokens;
        }
      }
    }
    const toolNames = (this.options.tools ?? []).map((tool) => tool.name).sort();
    const parameterHash = hash32(
      `${identity.providerId}|${identity.modelId}|${this.options.thinkingLevel ?? "off"}|${toolNames.join(",")}|${this.options.systemPrompt ?? ""}`
    );
    return {
      id: createInvocationId(),
      taskId: request.taskId,
      runId: request.runId,
      agentInstanceId: request.agentInstanceId,
      config: {
        provider: identity.providerId,
        model: identity.modelId,
        modelVersion: this.options.modelVersion,
        parameterHash,
      },
      responseHash: hashInvocationResponse(responseText),
      tokensIn,
      tokensOut,
      latencyMs: Date.now() - startedAtMs,
      occurredAt: nowIso(),
    };
  }
}
