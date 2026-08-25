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
  Type,
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
import { DomainValidationError } from "../domain/errors.js";
import { hash32 } from "../domain/hash.js";
import {
  createInvocationId,
  createMessageId,
  isArtifactId,
  isEvidenceId,
  type ArtifactId,
  type EvidenceId
} from "../domain/ids.js";
import { nowIso } from "../domain/timestamp.js";
import { SUPERVISOR, type TaskOutcome, type VerificationKind } from "../protocol/v1.js";
import { hashInvocationResponse, recordInvocation } from "../telemetry/model-invocation.js";
import type { InvocationCallOutcome, ModelInvocation } from "../telemetry/model-invocation.js";
import { createClusterTools } from "./cluster-tools.js";
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

/**
 * The tool through which a child states its own verdict. Named for the
 * transcript: the `TOOL_STARTED`/`TOOL_FINISHED` pair under this name is what
 * produced the `TASK_RESULT` between them.
 */
export const REPORT_TASK_RESULT_TOOL = "sparkle_report_task_result";

/**
 * Verdicts a child may state, for the task as a whole and for any one
 * criterion. UNOBSERVED is deliberately absent from both: it is already what
 * silence means — {@link PiAgentExecutor.finish} synthesizes it for a child
 * that reports nothing, and omitting a criterion from the list says the same
 * thing about that criterion. Protocol v1 can carry a per-criterion UNOBSERVED
 * because a future verifier might want to be explicit about what it skipped;
 * a child talking about its own work has no use for the distinction.
 */
const REPORTABLE_VERDICTS: readonly VerificationKind[] = ["PASSED", "FAILED"];

/**
 * Outcomes a child may claim. CANCELLED is excluded: cancellation is the
 * parent's fact, observed here through the abort signal, so a child asserting
 * it would replace an observation with a claim.
 */
const REPORTABLE_OUTCOMES: readonly TaskOutcome[] = ["SUCCESS", "PARTIAL", "FAILURE"];

function textResult(text: string): { content: Array<{ type: "text"; text: string }>; details: Record<string, never> } {
  return { content: [{ type: "text", text }], details: {} };
}

function describe(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function idList<T extends string>(
  field: string,
  value: unknown,
  isValid: (candidate: unknown) => candidate is T,
  prefix: string
): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new DomainValidationError(`${field} must be an array of ${prefix} ids`);
  return value.map((candidate: unknown) => {
    // A malformed reference is refused rather than dropped: silently shrinking
    // the list would leave the verdict citing less than the child believes it
    // cited, and a FAILED verdict with no surviving reference is not scored.
    if (!isValid(candidate)) {
      throw new DomainValidationError(`${field} entry ${describe(candidate)} is not a ${prefix} id`);
    }
    return candidate;
  });
}

/**
 * Per-criterion outcomes, refused as a whole rather than trimmed.
 *
 * The same rule as {@link idList}, one level up: a malformed entry means the
 * child's statement is not the statement it thinks it is making, and a
 * criterion list quietly missing its one FAILED entry is worse than no list.
 * Omitting `criteria` says nothing about individual criteria; an empty array
 * would be a second way to say that, so it is refused instead.
 *
 * Ids are not checked against the task's acceptance criteria: the executor's
 * request carries the prompt, not the `TASK_REQUEST`, so there is nothing here
 * to check against. The tracking layer ignores an id nobody asked for.
 */
function criterionList(
  value: unknown
): Array<{ id: string; kind: VerificationKind; evidenceIds: EvidenceId[] }> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new DomainValidationError("criteria must be an array");
  if (value.length === 0) {
    throw new DomainValidationError(
      "criteria must not be empty; omit it to say nothing about individual criteria"
    );
  }
  const seen = new Set<string>();
  return value.map((candidate: unknown, index: number) => {
    const entry = candidate as { id?: unknown; verification?: unknown; evidenceIds?: unknown };
    const id = typeof entry?.id === "string" ? entry.id.trim() : "";
    if (id === "") {
      throw new DomainValidationError(`criteria[${index}].id must be a non-empty string`);
    }
    if (seen.has(id)) {
      throw new DomainValidationError(`criteria[${index}] repeats criterion ${describe(id)}`);
    }
    seen.add(id);
    const kind = REPORTABLE_VERDICTS.find((verdict) => verdict === entry.verification);
    if (kind === undefined) {
      throw new DomainValidationError(
        `criteria[${index}].verification must be one of ${REPORTABLE_VERDICTS.join(", ")}, got ${describe(entry.verification)}`
      );
    }
    const evidenceIds = idList(`criteria[${index}].evidenceIds`, entry.evidenceIds, isEvidenceId, "evd_");
    // Same reason the whole-task rule exists: an unreferenced FAILED criterion
    // would block a run while naming nothing an operator could look at.
    if (kind === "FAILED" && evidenceIds.length === 0) {
      throw new DomainValidationError(
        `criteria[${index}] reports FAILED and must cite at least one evidenceId`
      );
    }
    return { id, kind, evidenceIds };
  });
}

/**
 * A child's own verdict channel, built per attempt from the leased request.
 *
 * Before this tool existed the adapter had no path to a `MESSAGE` at all —
 * `translatePiEvent` maps pi's stream to text/tool/turn events only — so
 * `finish` always synthesized `verification: { kind: "UNOBSERVED" }`, and
 * `assessChildObservation` refuses UNOBSERVED. The tracking gate consequently
 * had no live producer: its only scorable inputs came from the two fake
 * executors. One tool call is the smallest thing that makes a real pi child's
 * verdict a real observation.
 *
 * Message identity is stamped from the request, never taken from the model:
 * the child coordinator refuses a message whose `from`/`runId`/`taskId` do not
 * match the lease, and a child that could name them could impersonate a peer.
 * The model supplies the verdict, its prose, and its references — nothing else.
 *
 * Exactly one verdict per attempt. A second call is refused at this boundary
 * instead of being emitted, because the transcript rejects a duplicate
 * terminal as a protocol violation and that would turn a model's slip into a
 * failed task. The refusal text names the verdict already on the record. That
 * is also why per-criterion outcomes ride the same call rather than arriving
 * one at a time: the verifier speaks once, and the schema lets it say more in
 * that one statement instead of more often.
 */
export function createTaskResultTool(
  request: AgentExecutionRequest,
  emit: (event: ExecutionEvent) => void
): AgentTool<any> {
  let reported: VerificationKind | undefined;
  return {
    name: REPORT_TASK_RESULT_TOOL,
    label: "Sparkle Report Task Result",
    description:
      "Report this task's verdict, once, after you have checked the work. " +
      "verification: PASSED or FAILED. summary: one line describing what you did. " +
      "outcome (optional): SUCCESS, PARTIAL, or FAILURE. " +
      "evidenceIds / artifactIds (optional): evd_ / art_ references the verdict rests on; " +
      "a FAILED verdict must cite at least one evidenceId. " +
      "criteria (optional): one entry per acceptance criterion you actually checked, " +
      "each { id, verification: PASSED or FAILED, evidenceIds }; a FAILED criterion must cite " +
      "at least one evidenceId, and reporting one blocks the run for review even if the task " +
      "as a whole passed. Leave a criterion out if you did not check it — do not guess. " +
      "Not calling this leaves the verdict unobserved, and an unobserved verdict is not scored.",
    parameters: Type.Object({
      verification: Type.String(),
      summary: Type.String(),
      outcome: Type.Optional(Type.String()),
      evidenceIds: Type.Optional(Type.Array(Type.String())),
      artifactIds: Type.Optional(Type.Array(Type.String())),
      criteria: Type.Optional(
        Type.Array(
          Type.Object({
            id: Type.String(),
            verification: Type.String(),
            evidenceIds: Type.Optional(Type.Array(Type.String()))
          })
        )
      )
    }),
    execute: async (_toolCallId: string, params: unknown) => {
      const record = params as {
        verification?: unknown;
        summary?: unknown;
        outcome?: unknown;
        evidenceIds?: unknown;
        artifactIds?: unknown;
        criteria?: unknown;
      };
      if (reported !== undefined) {
        throw new DomainValidationError(
          `this task already reported ${reported}; a task carries exactly one verdict`
        );
      }
      const kind = REPORTABLE_VERDICTS.find((candidate) => candidate === record.verification);
      if (kind === undefined) {
        throw new DomainValidationError(
          `verification must be one of ${REPORTABLE_VERDICTS.join(", ")}, got ${describe(record.verification)}`
        );
      }
      const summary = typeof record.summary === "string" ? record.summary.trim() : "";
      if (summary === "") {
        throw new DomainValidationError("summary must be a non-empty string");
      }
      const outcome =
        record.outcome === undefined
          ? kind === "PASSED"
            ? "SUCCESS"
            : "FAILURE"
          : REPORTABLE_OUTCOMES.find((candidate) => candidate === record.outcome);
      if (outcome === undefined) {
        throw new DomainValidationError(
          `outcome must be one of ${REPORTABLE_OUTCOMES.join(", ")}, got ${describe(record.outcome)}`
        );
      }
      const evidenceIds: EvidenceId[] = idList("evidenceIds", record.evidenceIds, isEvidenceId, "evd_");
      const artifactIds: ArtifactId[] = idList("artifactIds", record.artifactIds, isArtifactId, "art_");
      // An unreferenced FAILED verdict does not gate: `assessChildObservation`
      // discards an assessment whose FAIL dimensions carry no evidence refs, so
      // the verdict would vanish between here and the gate. Refusing says why.
      if (kind === "FAILED" && evidenceIds.length === 0) {
        throw new DomainValidationError("a FAILED verdict must cite at least one evidenceId");
      }
      const criteria = criterionList(record.criteria);
      emit({
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
          summary,
          artifactIds,
          evidenceIds,
          verification: {
            kind,
            evidenceIds: [...evidenceIds],
            ...(criteria !== undefined ? { criteria } : {})
          }
        }
      });
      reported = kind;
      return textResult(`recorded ${kind} for ${request.taskId}`);
    }
  };
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
   * Run the agent once. Failures are reported, not thrown: the agent loop
   * folds stream errors into `state.errorMessage` and only surfaces an error
   * object when the prompt call itself rejects, so both are captured.
   */
  private async runAttempt(
    model: Model<Api>,
    request: AgentExecutionRequest,
    signal: AbortSignal
  ): Promise<AttemptRun> {
    const events: ExecutionEvent[] = [];
    const clusterTools = request.cluster !== undefined ? createClusterTools(request.cluster) : [];
    // Built per attempt, like the cluster tools: a verdict reported by an
    // attempt that then failed must not survive into the retried transcript,
    // and `runWithRetry` only surfaces the last attempt's events.
    const reportTaskResult = createTaskResultTool(request, (event) => events.push(event));
    const thinkingLevel: ThinkingLevel = this.options.thinkingLevel ?? "off";
    const agent = new Agent({
      initialState: {
        systemPrompt: this.options.systemPrompt ?? "",
        model,
        thinkingLevel,
        tools: [...(this.options.tools ?? []), ...clusterTools, reportTaskResult]
      },
      streamFn: (streamModel: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream =>
        this.models.streamSimple(streamModel, context, {
          ...options,
          ...(this.options.apiKey !== undefined && streamModel.provider === this.options.providerId
            ? { apiKey: this.options.apiKey }
            : {})
        })
    });

    let thrown: unknown;
    let runFailed = false;
    const onAbort = () => agent.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    // An abort that landed while the Agent was being built reaches no
    // listener: `addEventListener` on an already-aborted signal never fires.
    // Nothing can run between the registration above and this check, so the
    // two paths are exclusive and `abort()` happens exactly once.
    if (signal.aborted) agent.abort();
    try {
      agent.subscribe((event) => {
        const translated = translatePiEvent(event);
        if (translated !== undefined) events.push(translated);
      });
      await agent.prompt(`Working directory: ${request.workingDirectory}\n\n${request.prompt}`);
      await agent.waitForIdle();
    } catch (error) {
      thrown = error;
      runFailed = !signal.aborted;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
    const errorMessage = agent.state.errorMessage;
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
   * events are surfaced.
   */
  private async runWithRetry(
    model: Model<Api>,
    request: AgentExecutionRequest,
    signal: AbortSignal
  ): Promise<RetriedRun> {
    const options = this.options.retry;
    const policy = resolveRetryPolicy(options);
    const sleep = options?.sleep ?? sleepWithAbort;
    const random = options?.random ?? Math.random;
    let latest: RetriedRun = { attempt: 1, events: [], failure: undefined };
    for (let attempt = 1; ; attempt += 1) {
      // Cancellation is checked before *every* attempt, not only after a
      // backoff sleep: a signal that flipped anywhere in the loop body must
      // not buy the provider one more call.
      if (signal.aborted) {
        return latest;
      }
      const run = await this.runAttempt(model, request, signal);
      if (!run.failed || signal.aborted) {
        return { attempt, events: run.events, failure: undefined };
      }
      const failure = classifyProviderFailure(run.error, run.errorMessage);
      latest = { attempt, events: run.events, failure };
      const decision = decideRetry(failure, attempt, policy, random);
      if (!decision.retry) {
        return latest;
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
        return latest;
      }
    }
  }

  async *execute(request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    const startedAtMs = Date.now();

    // Cancellation that happened before the executor was reached — a parent
    // aborting while this child waited in a queue. No Agent is constructed and
    // no stream is opened: the provider must not be paid for a dead run.
    if (signal.aborted) {
      this.reportInvocation(request, this.resolveIdentity(request), [], startedAtMs, 1, "cancelled");
      yield* this.finish(request, [], "CANCELLED");
      return;
    }

    const resolved = this.resolveModel(request);
    if (resolved === undefined) {
      yield { type: "EXECUTION_FINISHED", outcome: "FAILURE" };
      return;
    }
    const { identity, model } = resolved;

    const { attempt, events: collected, failure } = await this.runWithRetry(model, request, signal);
    const callOutcome: InvocationCallOutcome = signal.aborted
      ? "cancelled"
      : failure === undefined
        ? "ok"
        : callOutcomeForFailure(failure);

    this.reportInvocation(request, identity, collected, startedAtMs, attempt, callOutcome);

    const outcome = signal.aborted ? "CANCELLED" : failure !== undefined ? "FAILURE" : "SUCCESS";
    yield* this.finish(request, collected, outcome);
  }

  private reportInvocation(
    request: AgentExecutionRequest,
    identity: ModelRef,
    collected: readonly ExecutionEvent[],
    startedAtMs: number,
    attempt: number,
    callOutcome: InvocationCallOutcome
  ): void {
    if (this.options.onInvocation === undefined) return;
    this.options.onInvocation(
      recordInvocation(
        this.buildInvocation(request, identity, collected, startedAtMs, attempt, callOutcome)
      )
    );
  }

  /**
   * Replay the collected transcript and close it out: a synthesized
   * TASK_RESULT when the agent produced none, then EXECUTION_FINISHED.
   *
   * A child that called {@link REPORT_TASK_RESULT_TOOL} already put its own
   * terminal in the transcript, and that verdict stands — the adapter must not
   * overwrite an observation with UNOBSERVED, nor append a second terminal.
   * Only a silent child is synthesized for, which is why UNOBSERVED still
   * means exactly what it meant before the tool existed: nobody looked.
   */
  private *finish(
    request: AgentExecutionRequest,
    collected: readonly ExecutionEvent[],
    outcome: "SUCCESS" | "FAILURE" | "CANCELLED"
  ): Generator<ExecutionEvent> {
    for (const event of collected) yield event;
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
