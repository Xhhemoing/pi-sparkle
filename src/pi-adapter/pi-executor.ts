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
import type { InvocationCallOutcome, ModelInvocation } from "../telemetry/model-invocation.js";
import { createClusterTools } from "./cluster-tools.js";
import { AsyncEventQueue, SparkleKernel } from "./kernel.js";
import {
  callOutcomeForFailure,
  classifyProviderFailure,
  decideRetry,
  resolveRetryPolicy,
  sleepWithAbort,
  type ProviderFailure,
  type RetryOptions
} from "./provider-retry.js";

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
   * Bounded retry for transient provider failures (429, retryable 5xx).
   * Defaults to three attempts with capped exponential backoff; a provider's
   * Retry-After or remedy_hint overrides the computed wait. Auth rejections
   * (401/403) are never retried.
   */
  retry?: RetryOptions;
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
      if (event.assistantMessageEvent.type === "thinking_delta") {
        // Only the size crosses the adapter boundary: the reasoning text stops
        // here so no downstream consumer can persist it.
        return { type: "THINKING_DELTA", bytes: Buffer.byteLength(event.assistantMessageEvent.delta, "utf8") };
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
      const rawInput = usageCount(usage?.input);
      const rawOutput = usageCount(usage?.output);
      // All-zero usage is what error payloads and stub providers report;
      // recording it would fabricate cost data ("undefined, never zero").
      const reported = [rawInput, rawOutput].filter((value): value is number => value !== undefined);
      const allZero = reported.length > 0 && reported.every((value) => value === 0);
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

/**
 * Provider usage is only believable as a non-negative integer. Anything else
 * (fractional, negative, NaN) is dropped rather than recorded, so the
 * invocation validator never has to reject a whole record over one bad count.
 */
function usageCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/** One agent run: the events it produced and how it ended. */
interface AttemptRun {
  readonly events: readonly ExecutionEvent[];
  readonly failed: boolean;
  readonly error: unknown;
  readonly errorMessage: string | undefined;
}

interface RetriedRun {
  /** 1-based number of the attempt whose events are returned. */
  readonly attempt: number;
  readonly events: readonly ExecutionEvent[];
  readonly failure: ProviderFailure | undefined;
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

  /**
   * Run the agent once, yielding each translated event as the agent emits it
   * rather than after the run settles: a supervisor watching a long turn needs
   * the tokens while they are still worth watching. The run itself is started
   * but not awaited; the queue below is what makes it observable in flight.
   *
   * Failures are reported, not thrown: the agent loop folds stream errors into
   * `state.errorMessage` and only surfaces an error object when the prompt call
   * itself rejects, so both are captured in the returned `AttemptRun`.
   */
  private async *runAttempt(
    model: Model<Api>,
    request: AgentExecutionRequest,
    signal: AbortSignal
  ): AsyncGenerator<ExecutionEvent, AttemptRun> {
    const events: ExecutionEvent[] = [];
    const clusterTools = request.cluster !== undefined ? createClusterTools(request.cluster) : [];
    const thinkingLevel: ThinkingLevel = this.options.thinkingLevel ?? "off";
    const kernel = SparkleKernel.fromFactory(
      () =>
        new Agent({
          initialState: {
            systemPrompt: this.options.systemPrompt ?? "",
            model,
            thinkingLevel,
            tools: [...(this.options.tools ?? []), ...clusterTools]
          },
          streamFn: (
            streamModel: Model<Api>,
            context: Context,
            options?: SimpleStreamOptions
          ): AssistantMessageEventStream =>
            this.models.streamSimple(streamModel, context, {
              ...options,
              ...(this.options.apiKey !== undefined && streamModel.provider === this.options.providerId
                ? { apiKey: this.options.apiKey }
                : {})
            })
        })
    );

    const queue = new AsyncEventQueue<ExecutionEvent>();
    let thrown: unknown;
    let runFailed = false;
    const onAbort = () => kernel.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    const unsubscribe = kernel.subscribe((event) => {
      // The kernel hands events back opaquely so its callers stay Pi-free;
      // inside the adapter this is where the Pi shape is re-attached.
      const translated = translatePiEvent(event as AgentEvent);
      if (translated !== undefined) queue.push(translated);
    });
    const running = (async () => {
      try {
        await kernel.prompt(`Working directory: ${request.workingDirectory}\n\n${request.prompt}`);
        await kernel.waitForIdle();
      } catch (error) {
        thrown = error;
        runFailed = !signal.aborted;
      } finally {
        // Closes the stream the caller is draining; nothing else ends it.
        queue.close();
      }
    })();

    let drained = false;
    try {
      for await (const event of queue) {
        events.push(event);
        yield event;
      }
      drained = true;
    } finally {
      signal.removeEventListener("abort", onAbort);
      unsubscribe();
      // The caller walked away mid-run: stop the agent rather than leave it
      // streaming into a queue no one reads.
      if (!drained) kernel.abort();
    }
    await running;
    const errorMessage = kernel.errorMessage;
    return {
      events,
      failed: runFailed || errorMessage !== undefined,
      error: thrown,
      errorMessage
    };
  }

  /**
   * Drive `runAttempt` until it succeeds, the failure is terminal, or the
   * attempt budget runs out. Each attempt uses a fresh agent so a failed turn
   * never leaks into the retried transcript, and only the last attempt's
   * events are reported as that run's transcript. Events already streamed from
   * an abandoned attempt cannot be recalled — a live consumer saw them — but
   * they are excluded from the invocation record, which describes the call the
   * run actually ended on.
   */
  private async *runWithRetry(
    model: Model<Api>,
    request: AgentExecutionRequest,
    signal: AbortSignal
  ): AsyncGenerator<ExecutionEvent, RetriedRun> {
    const options = this.options.retry;
    const policy = resolveRetryPolicy(options);
    const sleep = options?.sleep ?? sleepWithAbort;
    const random = options?.random ?? Math.random;
    for (let attempt = 1; ; attempt += 1) {
      const run = yield* this.runAttempt(model, request, signal);
      if (!run.failed || signal.aborted) {
        return { attempt, events: run.events, failure: undefined };
      }
      const failure = classifyProviderFailure(run.error, run.errorMessage);
      const decision = decideRetry(failure, attempt, policy, random);
      if (!decision.retry) {
        return { attempt, events: run.events, failure };
      }
      options?.onRetry?.({
        attempt,
        nextAttempt: attempt + 1,
        delayMs: decision.delayMs,
        reason: decision.reason,
        failure
      });
      await sleep(decision.delayMs, signal);
      if (signal.aborted) {
        return { attempt, events: run.events, failure };
      }
    }
  }

  async *execute(request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    const resolved = this.resolveModel(request);
    if (resolved === undefined) {
      yield { type: "EXECUTION_FINISHED", outcome: "FAILURE" };
      return;
    }
    const { identity, model } = resolved;

    const startedAtMs = Date.now();
    // Delegation forwards every attempt's events to the consumer as they
    // arrive and hands back the run summary once the retry loop is done.
    const { attempt, events: collected, failure } = yield* this.runWithRetry(model, request, signal);
    const callOutcome: InvocationCallOutcome = signal.aborted
      ? "cancelled"
      : failure === undefined
        ? "ok"
        : callOutcomeForFailure(failure);

    if (this.options.onInvocation !== undefined) {
      this.options.onInvocation(
        recordInvocation(
          this.buildInvocation(request, identity, collected, startedAtMs, attempt, callOutcome)
        )
      );
    }

    const outcome = signal.aborted ? "CANCELLED" : failure !== undefined ? "FAILURE" : "SUCCESS";
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
   * when unavailable), attempt number, terminal call outcome, and wall-clock
   * latency. No prompt or response body is retained.
   */
  private buildInvocation(
    request: AgentExecutionRequest,
    identity: ModelRef,
    collected: readonly ExecutionEvent[],
    startedAtMs: number,
    attempt: number,
    callOutcome: InvocationCallOutcome
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
    // A failed, timed-out, or cancelled call has no trustworthy usage: error
    // payloads carry a zeroed usage block, and a partial stream reports only
    // what arrived before the failure. Cost aggregates must see undefined.
    const usageIsTrustworthy = callOutcome === "ok";
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
      tokensIn: usageIsTrustworthy ? tokensIn : undefined,
      tokensOut: usageIsTrustworthy ? tokensOut : undefined,
      latencyMs: Date.now() - startedAtMs,
      occurredAt: nowIso(),
      attempt,
      callOutcome,
    };
  }
}
