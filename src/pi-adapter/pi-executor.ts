/* eslint-disable @typescript-eslint/no-explicit-any --
 * Pi's public API is generic over schema/detail types; the adapter boundary
 * is where that generality is absorbed. */
import {
  type AgentEvent,
  type AgentTool,
  type ThinkingLevel
} from "@earendil-works/pi-agent-core";
import {
  calculateCost,
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
import { ExecutionCostObservation, type ExecutionCostReport } from "./execution-cost.js";
export type { ExecutionCostReport } from "./execution-cost.js";
import type { ModelRef } from "../config/model-ref.js";
import { tryParseModelRef } from "../config/model-ref.js";
import { DomainValidationError } from "../domain/errors.js";
import { hash32 } from "../domain/hash.js";
import {
  createInvocationId,
  createMessageId,
  isArtifactId,
  isEvidenceId,
  type AgentInstanceId,
  type ArtifactId,
  type EvidenceId,
  type TaskId
} from "../domain/ids.js";
import { nowIso } from "../domain/timestamp.js";
import { SUPERVISOR, type TaskOutcome, type VerificationKind } from "../protocol/v1.js";
import { hashInvocationResponse, recordInvocation } from "../telemetry/model-invocation.js";
import type { InvocationCallOutcome, ModelInvocation } from "../telemetry/model-invocation.js";
import { createClusterTools } from "./cluster-tools.js";
import {
  CostGate,
  catalogPrices,
  type CostGateDisarmedReason,
  type CostGateLedger,
  type CostGatePricingObservation
} from "./cost-gate.js";
import { AsyncEventQueue } from "./kernel.js";
import { createControlledCodingSession, type ControlledCodingSession } from "./coding-session.js";
import {
  callOutcomeForFailure,
  classifyProviderFailure,
  decideRetry,
  resolveRetryPolicy,
  sleepWithAbort,
  taskFailureForProvider,
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
  /** Private prepared host-approved resource text; not model-controlled parameters. */
  approvedResourcePayload?: string | undefined;
  thinkingLevel?: SparkleThinkingLevel;
  /**
   * Opt in to completing after a valid task report, once its whole turn settles.
   * Default off. Executions with accepted steering retain normal continuation.
   */
  stopAfterTaskResult?: boolean;
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
   * Fallback model chain to try when the primary model fails after the retry
   * cap. Each entry is `{ providerId, modelId }`; the executor walks the list
   * in order. Only used when the primary exhausted its attempts on a
   * retryable-class failure.
   */
  fallbackModels?: readonly ModelRef[];
  /**
   * Optional sink receiving one validated invocation record per execute()
   * call: frozen configuration snapshot, response hash, usage, and latency.
   * The response body itself is never persisted — only its hash.
   */
  onInvocation?: (invocation: ModelInvocation) => void;
  /**
   * Default USD ceiling per execute() call, used when the request does not
   * carry its own. See {@link AgentExecutionRequest.maxCostUsd}.
   */
  maxCostUsd?: number;
  /** Opt-in: require a priced model, complete prior dispatch usage and remaining reference allowance before every dispatch. */
  strictReferenceBudget?: true;
  /** Internal host admission closure, captured at construction; never supplied by task JSON. */
  referenceBudgetAdmission?: () => void;
  /**
   * Optional sink for what the spend ceiling did. Fires when a requested
   * ceiling could not be enforced and when one stopped a run.
   */
  onCostGate?: (event: CostGateEvent) => void;
  /** Once after real execute settlement, including failure/cancellation/iterator return. */
  onExecutionCost?: (report: ExecutionCostReport) => void;
}

// Only the real execute finalizer registers these process-local report objects.
// Serialized data cannot recreate a callback's identity or assert strict policy.
const issuedCostReports = new WeakMap<object, {
  readonly sink: (report: ExecutionCostReport) => void;
  readonly strict: boolean;
}>();
type ExecutorCostPolicy = { readonly strictReferenceBudget: true | undefined;
  readonly onExecutionCost: PiExecutorOptions["onExecutionCost"]; readonly referenceBudgetAdmission: PiExecutorOptions["referenceBudgetAdmission"]; };
const executorCostBindings = new WeakMap<object, () => ExecutorCostPolicy>();
/** Process-local constructor identity, checked before Native starts any owned execution. */
export function isPiExecutorCostBoundTo(value: unknown, sink: (report: ExecutionCostReport) => void, admission?: () => void): value is PiAgentExecutor {
  if (value === null || typeof value !== "object") return false;
  const options = executorCostBindings.get(value)?.();
  return options !== undefined && options.strictReferenceBudget === true && options.onExecutionCost === sink &&
    (admission === undefined || options.referenceBudgetAdmission === admission);
}
export function isPiExecutionCostReportFor(value: unknown, sink: (report: ExecutionCostReport) => void,
  options?: { readonly requireStrict?: true }): value is ExecutionCostReport {
  if (value === null || typeof value !== "object") return false;
  const issued = issuedCostReports.get(value);
  return issued !== undefined && issued.sink === sink && (options?.requireStrict !== true || issued.strict);
}

/** What the spend ceiling did on one execution. */
export type CostGateEvent =
  | {
      readonly kind: "disarmed";
      readonly taskId: TaskId;
      readonly maxCostUsd: number;
      readonly reason: CostGateDisarmedReason;
    }
  | {
      readonly kind: "stopped";
      readonly taskId: TaskId;
      readonly maxCostUsd: number;
      readonly ledger: CostGateLedger;
    };

export function translatePiEvent(event: AgentEvent): ExecutionEvent | undefined {
  switch (event.type) {
    case "message_update": {
      if (event.assistantMessageEvent.type === "text_delta") {
        return { type: "TEXT_DELTA", text: event.assistantMessageEvent.delta };
      }
      if (event.assistantMessageEvent.type === "thinking_delta") {
        // Only the size crosses the adapter boundary: reasoning text stops
        // here so no downstream consumer can persist it.
        return {
          type: "THINKING_DELTA",
          bytes: Buffer.byteLength(event.assistantMessageEvent.delta, "utf8")
        };
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
    case "turn_end":
      return translateTurnFinished(event.message);
    default:
      return undefined;
  }
}

/** Account from raw SDK usage without changing the public TURN_FINISHED shape. */
function recordPiTurnCost(gate: CostGate, rawUsage: unknown, model: Model<Api>): CostGatePricingObservation | undefined {
  const raw = rawUsage !== null && typeof rawUsage === "object"
    ? rawUsage as Record<string, unknown>
    : {};
  const counts = [raw.input, raw.output, raw.cacheRead, raw.cacheWrite].map((value) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined
  );
  const [input, output, cacheRead, cacheWrite] = counts;
  const completeCounts = counts.every((value) => value !== undefined) &&
    Number.isSafeInteger(counts.reduce<number>((sum, value) => sum + (value ?? 0), 0));
  if (!counts.some((value) => value !== undefined && value > 0)) {
    gate.recordTurn(undefined);
    return;
  }
  const validRetention = raw.cacheWrite1h === undefined ||
    (typeof raw.cacheWrite1h === "number" && Number.isSafeInteger(raw.cacheWrite1h) &&
      raw.cacheWrite1h >= 0 && cacheWrite !== undefined && raw.cacheWrite1h <= cacheWrite);
  const tiers = model.cost.tiers ?? [];
  const validRates = [model.cost, ...tiers].every((rates) =>
    [rates.input, rates.output, rates.cacheRead, rates.cacheWrite].every(validBudgetAmount)
  ) && tiers.every((tier) => Number.isSafeInteger(tier.inputTokensAbove) && tier.inputTokensAbove >= 0);
  const prices = catalogPrices(model.cost);
  let catalogParts: number[] | undefined;
  let shortWritesPriced = false;
  let referenceUsd = prices !== undefined && tiers.length === 0
    ? ((input ?? 0) / 1_000_000) * prices.inputUsdPerMTok +
      ((output ?? 0) / 1_000_000) * prices.outputUsdPerMTok
    : undefined;
  if (completeCounts && validRates) {
    // Use the pinned SDK's full calculation: cache contributes to tier
    // selection, and 1h writes have a distinct rate. Raw cost cannot lower
    // this catalog reference, even when its own parts add up internally.
    const reference = calculateCost(model, {
      input: input!, output: output!, cacheRead: cacheRead!, cacheWrite: cacheWrite!,
      ...(validRetention && raw.cacheWrite1h !== undefined ? { cacheWrite1h: raw.cacheWrite1h as number } : {}),
      totalTokens: input! + output! + cacheRead! + cacheWrite!,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    });
    const shortWrites = cacheWrite! - (validRetention && typeof raw.cacheWrite1h === "number" ? raw.cacheWrite1h : 0);
    // A positive combined write cost can come solely from the 1h writes.
    // Omit retention on the same counts so the SDK checks the same tier's
    // short-write price, without changing the reference amount above.
    shortWritesPriced = shortWrites === 0 || calculateCost(model, {
      input: input!, output: output!, cacheRead: cacheRead!, cacheWrite: cacheWrite!,
      totalTokens: input! + output! + cacheRead! + cacheWrite!,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    }).cacheWrite > 0;
    catalogParts = [reference.input, reference.output, reference.cacheRead,
      validRetention ? reference.cacheWrite : 0];
    const amount = catalogParts.reduce((sum, part) => sum + part, 0);
    referenceUsd = prices !== undefined && catalogParts.every(validBudgetAmount) && validBudgetAmount(amount)
      ? amount : undefined;
  }
  const rawCost = raw.cost !== null && typeof raw.cost === "object"
    ? raw.cost as Record<string, unknown>
    : {};
  const amounts = [rawCost.input, rawCost.output, rawCost.cacheRead, rawCost.cacheWrite, rawCost.total];
  const validAmounts = amounts.every(validBudgetAmount);
  const parts = amounts as number[];
  const total = parts[4];
  const sum = parts.slice(0, 4).reduce((value, amount) => value + amount, 0);
  const validCost = completeCounts && validRetention && validAmounts && Number.isFinite(sum) &&
    sameBudgetAmount(sum, total!) && counts.every((count, index) => count !== 0 || parts[index] === 0);
  const hasCache = (cacheRead ?? 0) > 0 || (cacheWrite ?? 0) > 0;
  // Zero cache prices are also custom-provider placeholders. They cannot
  // prove a free cache, even if the raw SDK cost repeats those zero rates.
  const completeCatalog = prices !== undefined && completeCounts && validRates && validRetention &&
    referenceUsd !== undefined && catalogParts !== undefined && shortWritesPriced &&
    (!(cacheRead! > 0) || catalogParts[2]! > 0) && (!(cacheWrite! > 0) || catalogParts[3]! > 0);
  const matchesCatalog = validCost && catalogParts !== undefined &&
    catalogParts.every((part, index) => sameBudgetAmount(part, parts[index]!));
  // Older/faux input-output-only callers carry no cost or an all-zero
  // placeholder; their valid catalog reference remains the legacy fallback.
  const legacyCost = !hasCache && (raw.cost === undefined || (validCost && total === 0));
  const pricing: CostGatePricingObservation = {
    referenceUsd: prices !== undefined && validCost
      ? Math.max(referenceUsd ?? 0, total!) : referenceUsd,
    // A higher raw amount can conservatively stop the budget, but its
    // unexplained difference is not a complete same-catalog price or bill.
    complete: completeCatalog && (matchesCatalog || legacyCost)
  };
  gate.recordTurn({
    ...(input !== undefined ? { inputTokens: input } : {}),
    ...(output !== undefined ? { outputTokens: output } : {})
  }, pricing);
  return pricing;
}

function validBudgetAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function sameBudgetAmount(left: number, right: number): boolean {
  return Math.abs(left - right) <= Number.EPSILON * Math.max(1, left, right) * 8;
}
/** Normalize one assistant response for the public turn event. */
function translateTurnFinished(rawMessage: unknown): Extract<ExecutionEvent, { type: "TURN_FINISHED" }> {
  // Usage flows on the assistant message; without it cost telemetry is
  // blind (tokensIn/tokensOut stay undefined and cost gates cannot run).
  const message = rawMessage as {
    role?: string;
    usage?: { input?: number; output?: number; cacheRead?: number };
  };
  const usage = message.role === "assistant" ? message.usage : undefined;
  const rawInput = usageCount(usage?.input);
  const rawOutput = usageCount(usage?.output);
  const rawCacheRead = usageCount(usage?.cacheRead);
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
      ...(outputTokens !== undefined ? { outputTokens } : {}),
      // Cache reads ride along so the invocation can record cacheHit —
      // F6 paired blocks treat an undetected cache hit as contamination.
      ...(rawCacheRead !== undefined && rawCacheRead > 0
        ? { cacheReadTokens: rawCacheRead }
        : {})
    }
  };
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
  /** Leading agent events already yielded before a task verdict was buffered. */
  readonly streamedCount: number;
  readonly failed: boolean;
  readonly error: unknown;
  readonly errorMessage: string | undefined;
}

interface RetriedRun {
  /** 1-based number of the attempt whose events are returned. */
  readonly attempt: number;
  readonly events: readonly ExecutionEvent[];
  readonly streamedCount: number;
  readonly failure: ProviderFailure | undefined;
}

export class PiAgentExecutor implements AgentExecutor {
  private readonly nativeCostPolicy: ExecutorCostPolicy | undefined;
  private readonly models: MutableModels;
  private readonly faux?: FauxProviderHandle;
  /**
   * Kernels for attempts currently in flight, keyed by agent instance. One
   * executor can serve concurrent child tasks; steering refuses ambiguity.
   */
  private readonly liveKernels = new Map<AgentInstanceId, ControlledCodingSession>();
  /**
   * Steer texts accepted during each in-flight execution, keyed by agent
   * instance. Scoped to the whole execution rather than one attempt because
   * {@link runWithRetry} builds a fresh Agent per attempt: a steer consumed
   * into the context of an attempt that a 429 or 5xx then retries dies with
   * that discarded context. The run's `STEER_INJECTED` record is written once
   * this executor accepts the text, so dropping it would leave the log
   * permanently claiming the run was told something no surviving model call
   * ever saw — the state `execution/contract.ts` calls worse than a refusal.
   */
  private readonly acceptedSteers = new Map<AgentInstanceId, string[]>();

  constructor(private readonly options: PiExecutorOptions) {
    this.nativeCostPolicy = options.referenceBudgetAdmission === undefined ? undefined : {
      strictReferenceBudget: options.strictReferenceBudget, onExecutionCost: options.onExecutionCost,
      referenceBudgetAdmission: options.referenceBudgetAdmission
    };
    executorCostBindings.set(this, () => {
      const policy = this.nativeCostPolicy ?? options;
      return { strictReferenceBudget: policy.strictReferenceBudget, onExecutionCost: policy.onExecutionCost,
        referenceBudgetAdmission: policy.referenceBudgetAdmission };
    });
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
   * Run one fresh Pi agent attempt. Agent events are yielded live until the
   * child reports a task verdict. That verdict and the events after it stay
   * buffered so a failed attempt's verdict cannot leak into a retry, while
   * tool-start events remain observable in time for steering.
   *
   * `replay` carries steers this execution already accepted under an earlier,
   * now-discarded attempt; see {@link acceptedSteers}.
   */
  private async *runAttempt(
    model: Model<Api>,
    request: AgentExecutionRequest,
    gate: CostGate,
    signal: AbortSignal,
    replay: readonly string[],
    costs: ExecutionCostObservation
  ): AsyncGenerator<ExecutionEvent, AttemptRun> {
    const events: ExecutionEvent[] = [];
    const queue = new AsyncEventQueue<ExecutionEvent>();
    let streamPrefixOpen = true;
    let taskResultReported = false;
    let streamedCount = 0;
    const clusterTools = request.cluster !== undefined ? createClusterTools(request.cluster) : [];
    // Built per attempt: a verdict from an attempt that is retried must not
    // survive into the final transcript.
    const reportTaskResult = createTaskResultTool(request, (event) => {
      streamPrefixOpen = false;
      taskResultReported = true;
      events.push(event);
    });
    const thinkingLevel: ThinkingLevel = this.options.thinkingLevel ?? "off";
    costs.openingSession();
    const kernel = await createControlledCodingSession({
      cwd: request.workingDirectory,
      systemPrompt: this.options.systemPrompt ?? "",
      approvedResourcePayload: this.options.approvedResourcePayload,
      model,
      thinkingLevel,
      tools: [...(this.options.tools ?? []), ...clusterTools, reportTaskResult],
      streamFn: (
        streamModel: Model<Api>,
        context: Context,
        options?: SimpleStreamOptions
      ): AssistantMessageEventStream => {
        signal.throwIfAborted();
        this.nativeCostPolicy?.referenceBudgetAdmission?.();
        const refusal = costs.dispatchRefusal(catalogPrices(streamModel.cost) !== undefined);
        if (refusal !== undefined) throw new DomainValidationError(`strict reference budget refused dispatch: ${refusal}`);
        costs.dispatched();
        return this.models.streamSimple(streamModel, context, {
          ...options,
          // Sparkle owns bounded provider retry/fallback; custom transports
          // receive the same explicit no-inner-retry intent as the SDK config.
          maxRetries: 0,
          ...(this.options.apiKey !== undefined && streamModel.provider === this.options.providerId
            ? { apiKey: this.options.apiKey }
            : {})
        });
      },
      ...(gate.armed || this.options.strictReferenceBudget === true || this.options.stopAfterTaskResult === true ? {
        shouldStopAfterTurn: () => {
          // Always observe spend, even when a valid report also completes the run.
          // Pi invokes finishTurn after tool settlement, before turn_end; usage
          // has already been accounted for by the assistant message_end listener.
          const costStop = costs.requestStop(gate, catalogPrices(model.cost) !== undefined);
          // The stop hook precedes Pi's steering poll. Keep the normal loop for
          // the whole execution once any steer was accepted, including retries,
          // so completion never silently drops a queued or replayed correction.
          const hasAcceptedSteering = replay.length > 0 ||
            (this.acceptedSteers.get(request.agentInstanceId)?.length ?? 0) > 0;
          return costStop || (this.options.stopAfterTaskResult === true && taskResultReported && !hasAcceptedSteering);
        }
      } : {})
    });

    this.liveKernels.set(request.agentInstanceId, kernel);
    let thrown: unknown;
    let runFailed = false;
    const onAbort = () => kernel.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    // addEventListener does not fire for a signal that was already aborted.
    if (signal.aborted) kernel.abort();
    let replayPending = replay.length > 0;
    const unsubscribe = kernel.subscribe((event) => {
      const piEvent = event as AgentEvent;
      // finishTurn precedes turn_end in Pi 1.x. Count each response at its
      // message_end, including failed/aborted usage, before consulting the cap.
      // Tool-result messages and the later turn_end must not count it twice.
      if (piEvent.type === "message_end" && piEvent.message.role === "assistant") {
        costs.recordReference(recordPiTurnCost(gate, piEvent.message.usage, model));
      }
      const translated = translatePiEvent(piEvent);
      if (translated === undefined) return;
      if (translated.type === "TURN_FINISHED" && piEvent.type === "turn_end") {
        const failedTurn = piEvent.message.role === "assistant" &&
          (piEvent.message.stopReason === "error" || piEvent.message.stopReason === "aborted");
        // Failed turns and host budget/cancel stops close SDK admission. Keep
        // the real stop reason rather than masking it with a late steer error.
        if (replayPending && !failedTurn && !gate.stopRequested && costs.strictDispatchRefusal === undefined && !signal.aborted) {
          replayPending = false;
          // Queued after this attempt's first turn, not folded into its
          // opening prompt: the loop polls its steering queue once a turn
          // ends, so a re-delivered steer lands exactly where a live one
          // would have. Delivering it before the prompt would instead make
          // it part of the first request, which is not what "picked up after
          // its current turn" promised the operator.
          for (const text of replay) kernel.steerText(text);
        }
      }
      events.push(translated);
      if (streamPrefixOpen) {
        streamedCount += 1;
        queue.push(translated);
      }
    });
    const running = (async () => {
      try {
        signal.throwIfAborted();
        await kernel.prompt(`Working directory: ${request.workingDirectory}\n\n${request.prompt}`);
        await kernel.waitForIdle();
      } catch (error) {
        thrown = error;
        runFailed = !signal.aborted;
      } finally {
        queue.close();
      }
    })();

    let drained = false;
    try {
      for await (const event of queue) {
        yield event;
      }
      drained = true;
    } finally {
      if (!drained) kernel.abort();
      // Async-generator return skips code after finally. Keep the live owner
      // and event subscription until the real prompt/tool/transport settles.
      await running;
      await kernel.waitForIdle();
      signal.removeEventListener("abort", onAbort);
      unsubscribe();
      if (this.liveKernels.get(request.agentInstanceId) === kernel) {
        this.liveKernels.delete(request.agentInstanceId);
      }
      kernel.dispose();
      costs.settledSession();
    }
    const errorMessage = kernel.errorMessage;
    return {
      events,
      streamedCount,
      failed: runFailed || errorMessage !== undefined,
      error: thrown,
      errorMessage
    };
  }

  /** Yield the portion of a final attempt that was not already streamed live. */
  private *remainingAttemptEvents(run: Pick<AttemptRun, "events" | "streamedCount">): Generator<ExecutionEvent> {
    for (let index = run.streamedCount; index < run.events.length; index += 1) {
      const event = run.events[index];
      if (event !== undefined) yield event;
    }
  }

  /**
   * Drive attempts until one succeeds, retry is refused, cancellation wins, or
   * the cost gate stops another provider call.
   *
   * This is also the scope of {@link acceptedSteers}: the log opens here and
   * is discarded here, so every attempt after the first starts from whatever
   * the operator has told this execution so far.
   */
  private async *runWithRetry(
    model: Model<Api>,
    request: AgentExecutionRequest,
    gate: CostGate,
    signal: AbortSignal,
    costs: ExecutionCostObservation
  ): AsyncGenerator<ExecutionEvent, RetriedRun> {
    const options = this.options.retry;
    const policy = resolveRetryPolicy(options);
    const sleep = options?.sleep ?? sleepWithAbort;
    const random = options?.random ?? Math.random;
    let latest: RetriedRun = { attempt: 1, events: [], streamedCount: 0, failure: undefined };
    const steers: string[] = [];
    this.acceptedSteers.set(request.agentInstanceId, steers);
    try {
      for (let attempt = 1; ; attempt += 1) {
        if (signal.aborted) return latest;
        // Snapshotted before the attempt starts, so a steer accepted live
        // during it is delivered once by the kernel rather than twice.
        const run = yield* this.runAttempt(model, request, gate, signal, [...steers], costs);
        if (!run.failed || signal.aborted) {
          return { attempt, events: run.events, streamedCount: run.streamedCount, failure: undefined };
        }
        const failure = classifyProviderFailure(run.error, run.errorMessage);
        latest = { attempt, events: run.events, streamedCount: run.streamedCount, failure };
        if (costs.dispatchRefusal(catalogPrices(model.cost) !== undefined) !== undefined) return latest;
        const decision = decideRetry(failure, attempt, policy, random);
        if (!decision.retry || costs.requestStop(gate, catalogPrices(model.cost) !== undefined)) {
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
    } finally {
      if (this.acceptedSteers.get(request.agentInstanceId) === steers) {
        this.acceptedSteers.delete(request.agentInstanceId);
      }
    }
  }

  /**
   * Queue user-authored text into an attempt this executor is running.
   *
   * With `agentInstanceId` the text goes to that instance's attempt and
   * nowhere else. One executor serves concurrent runs, so between two attempts
   * of a retried execution its kernel is gone from {@link liveKernels} while a
   * sibling run's kernel is not: without a target the sole-live rule would
   * hand the sibling an instruction nobody aimed at it, and record the steer
   * against both the wrong execution's {@link acceptedSteers} and the aiming
   * run's log. A target that is not live is therefore refused loudly, the same
   * answer the untargeted call gives when nothing at all is live.
   *
   * Without one it targets the sole live attempt, refusing blank text, no
   * active attempt, and ambiguous concurrent attempts.
   *
   * Accepted text is also kept for the rest of the execution so a retry
   * re-delivers it; see {@link acceptedSteers}.
   */
  steerText(text: string, agentInstanceId?: AgentInstanceId): void {
    if (text.trim() === "") {
      throw new DomainValidationError("steer text must be a non-empty string");
    }
    if (agentInstanceId !== undefined) {
      const targeted = this.liveKernels.get(agentInstanceId);
      if (targeted === undefined) {
        throw new DomainValidationError(
          `cannot steer: no agent run is in flight for ${agentInstanceId}`
        );
      }
      this.deliver(agentInstanceId, targeted, text);
      return;
    }
    const live = [...this.liveKernels.entries()];
    if (live.length === 0) {
      throw new DomainValidationError("cannot steer: no agent run is in flight");
    }
    if (live.length > 1) {
      throw new DomainValidationError(
        `cannot steer: ${live.length} agent runs are in flight and steering has no target`
      );
    }
    const [soleInstanceId, kernel] = live[0] as [AgentInstanceId, ControlledCodingSession];
    this.deliver(soleInstanceId, kernel, text);
  }

  private deliver(agentInstanceId: AgentInstanceId, kernel: ControlledCodingSession, text: string): void {
    kernel.steerText(text);
    // Recorded only once the kernel has taken the text: a steer the live
    // attempt refused was never delivered, and re-delivering it to the next
    // attempt would turn that refusal into a silent acceptance.
    this.acceptedSteers.get(agentInstanceId)?.push(text);
  }

  async *execute(request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    const startedAtMs = Date.now();
    const strictReferenceBudget = (this.nativeCostPolicy ?? this.options).strictReferenceBudget === true;
    const costs = new ExecutionCostObservation(strictReferenceBudget
      ? { maxCostUsd: request.maxCostUsd ?? this.options.maxCostUsd } : undefined);
    const onExecutionCost = (this.nativeCostPolicy ?? this.options).onExecutionCost;
    const costIdentity = { runId: request.runId, taskId: request.taskId, agentInstanceId: request.agentInstanceId };
    try {

    // A pre-aborted request never constructs an Agent or opens a provider
    // stream, but still records honest cancelled telemetry.
    if (signal.aborted) {
      this.reportInvocation(request, this.resolveIdentity(request), [], startedAtMs, 1, "cancelled");
      yield* this.finish(request, [], "CANCELLED", false);
      return;
    }

    const resolved = this.resolveModel(request);
    if (resolved === undefined) {
      yield { type: "EXECUTION_FINISHED", outcome: "FAILURE" };
      return;
    }

    // Model chain: primary first, then fallbackModels in order. Each entry
    // gets its own retry budget and model-priced gate. Known spend is carried
    // into the next gate so changing models never refreshes the execution cap.
    // The first entry whose
    // runWithRetry returns without a provider failure wins; the chain stops on
    // cancellation, a cost-gate stop, or exhaustion of the fallback list.
    const chain: Array<{ readonly identity: ModelRef; readonly model: Model<Api> }> = [resolved];
    for (const fallback of this.options.fallbackModels ?? []) {
      const fallbackModel = this.models.getModel(fallback.providerId, fallback.modelId);
      if (fallbackModel !== undefined) {
        chain.push({ identity: fallback, model: fallbackModel });
      }
    }

    let winningIdentity: ModelRef | undefined;
    let winningEvents: readonly ExecutionEvent[] = [];
    let winningFailure: ProviderFailure | undefined;
    let winningAttempt = 0;
    let lastModelRun: RetriedRun | undefined;
    let stoppedGate: CostGate | undefined;
    const costGates = costs.gates;
    const requestedCap = request.maxCostUsd ?? this.options.maxCostUsd;
    const pricedSpend = (): number =>
      costGates.reduce((sum, gate) => sum + (gate.spentUsd ?? 0), 0);
    const executionLedger = (): CostGateLedger => {
      const ledgers = costGates.map((gate) => gate.ledger);
      return {
        turns: ledgers.reduce((sum, ledger) => sum + ledger.turns, 0),
        turnsWithoutUsage: ledgers.reduce((sum, ledger) => sum + ledger.turnsWithoutUsage, 0),
        tokensIn: ledgers.reduce((sum, ledger) => sum + ledger.tokensIn, 0),
        tokensOut: ledgers.reduce((sum, ledger) => sum + ledger.tokensOut, 0),
        // Mixed/unpriced chains still cannot report a complete dollar figure.
        spentUsd: ledgers.every((ledger) => ledger.spentUsd !== undefined)
          ? Math.round(pricedSpend() * 1_000_000) / 1_000_000
          : undefined
      };
    };

    for (const entry of chain) {
      if (signal.aborted) break;
      const gate = this.buildCostGate(request, entry.model, strictReferenceBudget ? costs.knownReferenceUsd() ?? 0 : pricedSpend(), strictReferenceBudget);
      costGates.push(gate);
      lastModelRun = yield* this.runWithRetry(
        entry.model,
        request,
        gate,
        signal,
        costs
      );
      const { attempt, events: collected, failure } = lastModelRun;
      // Failed final attempts can bypass the loop's stop hook and the retry
      // predicate. Their billed usage must still stop a subsequent fallback.
      costs.requestStop(gate, catalogPrices(entry.model.cost) !== undefined);
      if (signal.aborted) {
        winningIdentity = entry.identity;
        winningEvents = collected;
        winningAttempt = attempt;
        winningFailure = undefined;
        stoppedGate = gate;
        break;
      }
      if (failure === undefined) {
        winningIdentity = entry.identity;
        winningEvents = collected;
        winningAttempt = attempt;
        winningFailure = undefined;
        stoppedGate = gate;
        break;
      }
      // Persist the actual failed model before deciding whether a different
      // model may be tried. Auth, malformed requests and no-retry directives
      // remain terminal even when a fallback list exists.
      const callOutcome: InvocationCallOutcome = callOutcomeForFailure(failure);
      this.reportInvocation(request, entry.identity, collected, startedAtMs, attempt, callOutcome);
      winningFailure = failure;
      const gateState = gate.state;
      if (gate.stopRequested && gateState.armed) {
        this.options.onCostGate?.({
          kind: "stopped",
          taskId: request.taskId,
          maxCostUsd: requestedCap ?? gateState.maxCostUsd,
          ledger: executionLedger()
        });
        break;
      }
      if (costs.strictDispatchRefusal !== undefined) break;
      if (!failure.retryable) break;
    }

    if (winningIdentity === undefined) {
      // Every entry in the chain failed. Close the transcript with a FAILURE
      // terminal and the last provider failure so finish() can synthesize the
      // UNOBSERVED + PROVIDER_ERROR message that downstream attribution needs.
      const outcome = signal.aborted ? "CANCELLED" : "FAILURE";
      // A failed transport's buffered verdict cannot authorize task success,
      // even when it came from the final model in the chain.
      yield* this.finish(request, [], outcome, false, signal.aborted ? undefined : winningFailure);
      return;
    }

    const strictFailure = costs.strictDispatchRefusal !== undefined && costs.strictDispatchRefusal !== "exhausted";
    const callOutcome: InvocationCallOutcome = signal.aborted
      ? "cancelled"
      : strictFailure ? "error" : "ok";

    this.reportInvocation(request, winningIdentity, winningEvents, startedAtMs, winningAttempt, callOutcome);

    if (stoppedGate !== undefined && stoppedGate.stopRequested) {
      const gateState = stoppedGate.state;
      if (gateState.armed) {
        this.options.onCostGate?.({
          kind: "stopped",
          taskId: request.taskId,
          maxCostUsd: requestedCap ?? gateState.maxCostUsd,
          ledger: executionLedger()
        });
      }
    }

    // Commit settlement once, before publishing buffered verdict events. An
    // async-generator consumer can abort between yields, but cannot retract a
    // verdict already published or cause finish() to synthesize a second one.
    const cancelled = signal.aborted;
    const outcome = cancelled ? "CANCELLED" : strictFailure ? "FAILURE" : "SUCCESS";
    const finalEvents = cancelled || strictFailure ? [] : winningEvents;
    if (!cancelled && !strictFailure && lastModelRun !== undefined) yield* this.remainingAttemptEvents(lastModelRun);
    yield* this.finish(request, finalEvents, outcome, stoppedGate?.stopRequested ?? false, winningFailure);
    } finally {
      if (onExecutionCost !== undefined) {
        const report = costs.report(costIdentity);
        issuedCostReports.set(report, { sink: onExecutionCost, strict: strictReferenceBudget });
        onExecutionCost(report);
      }
    }
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

  /** Close the already-yielded transcript with one terminal and completion. */
  private *finish(
    request: AgentExecutionRequest,
    collected: readonly ExecutionEvent[],
    outcome: "SUCCESS" | "FAILURE" | "CANCELLED",
    stoppedAtCostCeiling: boolean,
    failure?: ProviderFailure
  ): Generator<ExecutionEvent> {
    if (!collected.some((event) => event.type === "MESSAGE" && event.message.type === "TASK_RESULT")) {
      // The classified provider failure carries the reason a bare "finished"
      // would hide: surface it the way 9035's agent.state.errorMessage did.
      // Provider/env failures stay UNOBSERVED so they never enter taskSuccess
      // as FAILED-with-empty-evidence (which defaults to failureClass=model).
      const errorMessage = failure !== undefined && failure.message.trim() !== ""
        ? failure.message.trim()
        : undefined;
      const providerFailure = failure !== undefined ? taskFailureForProvider(failure) : undefined;
      // Synthesized silence is always UNOBSERVED (never FAILED with empty
      // evidenceIds). Assign the object first so the option-a producer census
      // still sees only the child-tool runtime path as a verification producer.
      const synthesizedVerification = {
        kind: "UNOBSERVED" as const,
        evidenceIds: [] as EvidenceId[]
      };
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
          summary:
            stoppedAtCostCeiling
              ? "pi agent stopped at the cost ceiling"
              : errorMessage !== undefined
                ? `pi agent failed: ${errorMessage}`
                : "pi agent finished",
          artifactIds: [],
          evidenceIds: [],
          verification: synthesizedVerification,
          ...(providerFailure !== undefined ? { failure: providerFailure } : {})
        }
      };
    }
    yield { type: "EXECUTION_FINISHED", outcome };
  }

  /**
   * Build this execution's spend ceiling from the request (or executor
   * default) and the resolved model's catalog rates.
   */
  private buildCostGate(request: AgentExecutionRequest, model: Model<Api>, priorPricedSpend = 0, strictReferenceBudget = false): CostGate {
    const maxCostUsd = request.maxCostUsd ?? this.options.maxCostUsd;
    // Gates round observed dollars to microdollars. Subtract at that same
    // scale: 0.8 - 0.1 in binary dollars is otherwise greater than the rounded
    // $0.7 spend, permitting another call at an already-exhausted ceiling.
    // Ceil keeps a positive sub-microdollar cap armed rather than rounding it
    // to zero; observed spend can only cross it at the next microdollar.
    const capMicros = maxCostUsd === undefined ? undefined : Math.ceil(maxCostUsd * 1_000_000);
    const remainingCap = strictReferenceBudget && maxCostUsd !== undefined
      ? maxCostUsd - priorPricedSpend
      : maxCostUsd !== undefined && Number.isFinite(maxCostUsd) && maxCostUsd > 0
      ? capMicros !== undefined && Number.isSafeInteger(capMicros)
        ? (capMicros - Math.round(priorPricedSpend * 1_000_000)) / 1_000_000
        : maxCostUsd - priorPricedSpend
      : maxCostUsd;
    const prices = catalogPrices(model.cost);
    const gate = new CostGate({
      ...(remainingCap !== undefined ? { maxCostUsd: remainingCap } : {}),
      ...(prices !== undefined ? { prices } : {})
    });
    const state = gate.state;
    if (!state.armed && maxCostUsd !== undefined) {
      this.options.onCostGate?.({
        kind: "disarmed",
        taskId: request.taskId,
        maxCostUsd,
        reason: state.reason
      });
    }
    return gate;
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
    let cacheReadTokens = 0;
    let sawUsage = false;
    for (const event of collected) {
      if (event.type === "TEXT_DELTA") {
        responseText += event.text;
      } else if (event.type === "TURN_FINISHED" && event.usage !== undefined) {
        sawUsage = true;
        if (event.usage.inputTokens !== undefined) {
          tokensIn = (tokensIn ?? 0) + event.usage.inputTokens;
        }
        if (event.usage.outputTokens !== undefined) {
          tokensOut = (tokensOut ?? 0) + event.usage.outputTokens;
        }
        if (event.usage.cacheReadTokens !== undefined) {
          cacheReadTokens += event.usage.cacheReadTokens;
        }
      }
    }
    // A failed, timed-out, or cancelled call has no trustworthy usage: error
    // payloads carry a zeroed usage block, and a partial stream reports only
    // what arrived before the failure. Cost aggregates must see undefined.
    const usageIsTrustworthy = callOutcome === "ok";
    // F6 §2.2: cacheHit is a three-state observation — true (cache tokens
    // seen), false (usage reported, zero cache), undefined (no trustworthy
    // usage, so cache status is unknown, never guessed).
    const cacheHit = !usageIsTrustworthy || !sawUsage ? undefined : cacheReadTokens > 0;
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
      // F6 §2.9 provenance: which executor class produced this row. The faux
      // loopback provider is test infrastructure; labeling it keeps holdout
      // audits able to prove no test double ever posed as production. Keyed
      // off the resolved identity (not the constructor handle) so executors
      // built with an injected Models registry are classified too.
      executorClass: identity.providerId === "faux" ? "faux" : "pi",
      ...(cacheHit !== undefined ? { cacheHit } : {}),
    };
  }
}
