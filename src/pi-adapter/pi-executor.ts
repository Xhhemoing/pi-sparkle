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
  contentText,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type Api,
  type AssistantMessageEventStream,
  type Context,
  type FauxProviderHandle,
  type Model,
  type SimpleStreamOptions
} from "@earendil-works/pi-ai";
import type { AgentExecutionRequest, AgentExecutor, ExecutionEvent } from "../execution/contract.js";
import { hash32 } from "../domain/hash.js";
import { createInvocationId } from "../domain/ids.js";
import { nowIso } from "../domain/timestamp.js";
import { hashInvocationResponse, recordInvocation } from "../telemetry/model-invocation.js";
import type { ModelInvocation } from "../telemetry/model-invocation.js";

export interface PiExecutorOptions {
  providerId: string;
  modelId: string;
  systemPrompt?: string;
  thinkingLevel?: ThinkingLevel;
  tools?: AgentTool<any>[];
  apiKey?: string;
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
        summary: contentText(event.result.content) ?? "(no text content)"
      };
    case "turn_end":
      return { type: "TURN_FINISHED" };
    default:
      return undefined;
  }
}

export class PiAgentExecutor implements AgentExecutor {
  private readonly models = createModels();
  private readonly faux?: FauxProviderHandle;

  constructor(private readonly options: PiExecutorOptions) {
    if (options.providerId === "faux") {
      this.faux = fauxProvider();
      this.models.setProvider(this.faux.provider);
      this.faux.setResponses([fauxAssistantMessage("Faux response: task acknowledged.")]);
    }
  }

  private resolveModel(): Model<Api> | undefined {
    if (this.options.providerId === "faux") {
      return this.faux?.getModel();
    }
    return this.models.getModel(this.options.providerId, this.options.modelId);
  }

  async *execute(request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    const model = this.resolveModel();
    if (model === undefined) {
      yield { type: "EXECUTION_FINISHED", outcome: "FAILURE" };
      return;
    }

    const startedAtMs = Date.now();
    const collected: ExecutionEvent[] = [];
    const agent = new Agent({
      initialState: {
        systemPrompt: this.options.systemPrompt ?? "",
        model,
        thinkingLevel: this.options.thinkingLevel ?? "off",
        tools: this.options.tools ?? []
      },
      streamFn: (streamModel: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream =>
        this.models.streamSimple(streamModel, context, options),
      ...(this.options.apiKey !== undefined ? { getApiKey: () => this.options.apiKey } : {})
    });

    let runFailed = false;
    const onAbort = () => agent.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      agent.subscribe((event) => {
        const translated = translatePiEvent(event);
        if (translated !== undefined) collected.push(translated);
      });
      await agent.prompt(request.prompt);
      await agent.waitForIdle();
    } catch {
      runFailed = !signal.aborted;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }

    if (this.options.onInvocation !== undefined) {
      this.options.onInvocation(recordInvocation(this.buildInvocation(request, collected, startedAtMs)));
    }

    for (const event of collected) yield event;
    if (signal.aborted) {
      yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
    } else if (runFailed || agent.state.errorMessage !== undefined) {
      yield { type: "EXECUTION_FINISHED", outcome: "FAILURE" };
    } else {
      yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
    }
  }

  /**
   * Build the reference-only invocation record: frozen configuration hash,
   * response-body hash, provider usage when available (undefined, not zero,
   * when unavailable), and wall-clock latency. No prompt or response body is
   * retained.
   */
  private buildInvocation(
    request: AgentExecutionRequest,
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
      `${this.options.providerId}|${this.options.modelId}|${this.options.thinkingLevel ?? "off"}|${toolNames.join(",")}|${this.options.systemPrompt ?? ""}`
    );
    return {
      id: createInvocationId(),
      taskId: request.taskId,
      runId: request.runId,
      agentInstanceId: request.agentInstanceId,
      config: {
        provider: this.options.providerId,
        model: this.options.modelId,
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
