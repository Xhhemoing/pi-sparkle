import { DomainValidationError } from "../domain/errors.js";
import { hash32 } from "../domain/hash.js";
import { isAgentInstanceId, isInvocationId, isRunId, isTaskId } from "../domain/ids.js";
import type { AgentInstanceId, InvocationId, RunId, TaskId } from "../domain/ids.js";
import { isIsoTimestamp } from "../domain/timestamp.js";
import type { IsoTimestamp } from "../domain/timestamp.js";

/**
 * Frozen configuration snapshot for one external model call. Reference-only:
 * no prompt, response body, secret, or environment value is ever persisted
 * here — only identity plus a parameter hash.
 */
export interface InvocationConfig {
  readonly provider: string;
  readonly model: string;
  /** Provider-pinned model version when known; unpinned models leave it undefined. */
  readonly modelVersion: string | undefined;
  /** hash32 over the request parameters (model, thinking level, tools, system prompt). */
  readonly parameterHash: string;
}

export type InvocationCallOutcome = "ok" | "timeout" | "cancelled" | "error";

export const INVOCATION_CALL_OUTCOMES: readonly InvocationCallOutcome[] = [
  "ok",
  "timeout",
  "cancelled",
  "error"
];

/**
 * Pricing snapshot recorded separately from provider-reported usage. The
 * catalog version identifies the price table used for any derived cost;
 * usage (tokensIn/tokensOut) is what the provider reported.
 */
export interface InvocationPricing {
  readonly catalogVersion: string;
  readonly inputUsdPerMTok?: number | undefined;
  readonly outputUsdPerMTok?: number | undefined;
}

export interface ModelInvocation {
  readonly id: InvocationId;
  readonly taskId: TaskId;
  readonly runId: RunId;
  readonly agentInstanceId: AgentInstanceId;
  readonly config: InvocationConfig;
  /** hash32 over the response body — the body itself is never persisted. */
  readonly responseHash: string;
  /** Provider-reported usage; unavailable is undefined, never zero. */
  readonly tokensIn: number | undefined;
  readonly tokensOut: number | undefined;
  readonly latencyMs: number;
  readonly occurredAt: IsoTimestamp;
  /** 1-based attempt number; > 1 marks a retry of the same logical call. */
  readonly attempt?: number | undefined;
  /** True when the response was served from a provider cache. */
  readonly cacheHit?: boolean | undefined;
  /** Terminal call disposition for attribution. */
  readonly callOutcome?: InvocationCallOutcome | undefined;
  /** Price table used for derived cost; never merged into usage fields. */
  readonly pricing?: InvocationPricing | undefined;
}

const HASH_PATTERN = /^[0-9a-f]{1,8}$/;

/** hash32 over the response body. Reference-only — never store the body. */
export function hashInvocationResponse(body: string): string {
  return hash32(body);
}

export function invocationError(inv: ModelInvocation): string | undefined {
  if (!isInvocationId(inv.id)) {
    return `invalid invocation id: ${String(inv.id)}`;
  }
  if (!isTaskId(inv.taskId)) {
    return `invalid taskId: ${String(inv.taskId)}`;
  }
  if (!isRunId(inv.runId)) {
    return `invalid runId: ${String(inv.runId)}`;
  }
  if (!isAgentInstanceId(inv.agentInstanceId)) {
    return `invalid agentInstanceId: ${String(inv.agentInstanceId)}`;
  }
  const { config } = inv;
  if (typeof config.provider !== "string" || config.provider.trim() === "") {
    return "config.provider is required";
  }
  if (typeof config.model !== "string" || config.model.trim() === "") {
    return "config.model is required";
  }
  if (config.modelVersion !== undefined && config.modelVersion.trim() === "") {
    return "config.modelVersion must not be empty when present";
  }
  if (typeof config.parameterHash !== "string" || !HASH_PATTERN.test(config.parameterHash)) {
    return `invalid parameterHash: ${String(config.parameterHash)}`;
  }
  if (typeof inv.responseHash !== "string" || !HASH_PATTERN.test(inv.responseHash)) {
    return `invalid responseHash: ${String(inv.responseHash)}`;
  }
  for (const [name, value] of [
    ["tokensIn", inv.tokensIn],
    ["tokensOut", inv.tokensOut],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      return `${name} must be a non-negative integer when present`;
    }
  }
  if (!Number.isFinite(inv.latencyMs) || inv.latencyMs < 0) {
    return "latencyMs must be a non-negative finite number";
  }
  if (!isIsoTimestamp(inv.occurredAt)) {
    return "occurredAt must be an ISO timestamp";
  }
  if (inv.attempt !== undefined && (!Number.isInteger(inv.attempt) || inv.attempt < 1)) {
    return "attempt must be an integer >= 1 when present";
  }
  if (inv.cacheHit !== undefined && typeof inv.cacheHit !== "boolean") {
    return "cacheHit must be a boolean when present";
  }
  if (
    inv.callOutcome !== undefined &&
    !INVOCATION_CALL_OUTCOMES.includes(inv.callOutcome)
  ) {
    return `invalid callOutcome: ${String(inv.callOutcome)}`;
  }
  if (inv.pricing !== undefined) {
    if (typeof inv.pricing.catalogVersion !== "string" || inv.pricing.catalogVersion.trim() === "") {
      return "pricing.catalogVersion is required when pricing is present";
    }
    for (const [name, value] of [
      ["inputUsdPerMTok", inv.pricing.inputUsdPerMTok],
      ["outputUsdPerMTok", inv.pricing.outputUsdPerMTok]
    ] as const) {
      if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
        return `pricing.${name} must be a non-negative finite number when present`;
      }
    }
  }
  return undefined;
}

export function validateInvocation(inv: ModelInvocation): void {
  const error = invocationError(inv);
  if (error !== undefined) {
    throw new DomainValidationError(error);
  }
}

export function isInvocation(value: unknown): value is ModelInvocation {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return invocationError(value as ModelInvocation) === undefined;
}

/** Validate-and-return: recording a malformed invocation fails closed. */
export function recordInvocation(inv: ModelInvocation): ModelInvocation {
  validateInvocation(inv);
  return inv;
}

export interface RunToRunVariance {
  /** Invocations paired by taskId across the two runs. */
  readonly paired: number;
  /** Paired invocations with identical config hash, model/provider, and response hash. */
  readonly identical: number;
  /** Paired invocations that differ in configuration or response hash. */
  readonly differing: number;
  readonly unpairedInFirst: number;
  readonly unpairedInSecond: number;
  /**
   * True only when every paired invocation matched. This is hash equality of
   * observed responses — never a byte-identical replay claim.
   */
  readonly allPairedIdentical: boolean;
}

/**
 * Hash equality means identical observed responses and configuration.
 * Provider behavior may still vary between runs; byte-identical replay is
 * never claimed.
 */
export const RUN_TO_RUN_NOTE =
  "hash equality means identical observed responses and configuration; " +
  "provider behavior may still vary between runs and byte-identical replay is never claimed";

/**
 * Compare two runs' invocation records. Pairing is by taskId; duplicates or
 * missing counterparts count as unpaired. A response-hash match records the
 * observable equality of both runs without claiming byte-identical replay.
 */
export function compareRunToRun(
  first: readonly ModelInvocation[],
  second: readonly ModelInvocation[]
): RunToRunVariance {
  const secondByTask = new Map<string, ModelInvocation>();
  for (const inv of second) {
    secondByTask.set(inv.taskId, inv);
  }
  let paired = 0;
  let identical = 0;
  let differing = 0;
  const matchedSecond = new Set<string>();
  for (const inv of first) {
    const other = secondByTask.get(inv.taskId);
    if (other === undefined) {
      continue;
    }
    matchedSecond.add(inv.taskId);
    paired += 1;
    const sameConfig =
      inv.config.parameterHash === other.config.parameterHash &&
      inv.config.provider === other.config.provider &&
      inv.config.model === other.config.model;
    if (sameConfig && inv.responseHash === other.responseHash) {
      identical += 1;
    } else {
      differing += 1;
    }
  }
  return {
    paired,
    identical,
    differing,
    unpairedInFirst: first.length - paired,
    unpairedInSecond: second.length - matchedSecond.size,
    allPairedIdentical: paired > 0 && differing === 0,
  };
}
