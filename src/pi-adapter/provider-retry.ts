import type { InvocationCallOutcome } from "../telemetry/model-invocation.js";

/**
 * 429-aware failure classification and backoff for the Pi executor.
 *
 * A provider failure reaches the adapter in one of two shapes:
 *
 *  1. a thrown SDK error object carrying `status`/`statusCode`, response
 *     headers, and a parsed body; or
 *  2. a flattened string on `AgentState.errorMessage` — the agent loop keeps
 *     only `error.message` for stream failures, and the provider layer has
 *     already folded the status and body into that string ("429: {...}",
 *     "openrouter (429): ...", "429 status code (no body)").
 *
 * Both shapes are classified here so a rate limit is retried whichever way it
 * arrives. Evidence for the gap: docs/reports/2026-08-22-weak-areas-data-collection.md
 * §1.3 — four consecutive runs failed at ~1.6s against a 429 that cleared on
 * its own ~20 minutes later.
 */

/** Statuses another attempt can plausibly clear without operator action. */
const RETRYABLE_STATUS: ReadonlySet<number> = new Set([408, 425, 429, 500, 502, 503, 504, 529]);
/** Credential rejections: a retry re-sends the same rejected credential. */
const AUTH_STATUS: ReadonlySet<number> = new Set([401, 403]);
const TIMEOUT_STATUS: ReadonlySet<number> = new Set([408, 504]);

export type ProviderFailureKind = "rate-limit" | "server" | "timeout" | "auth" | "unknown";

/**
 * A provider-supplied recovery directive (`remedy_hint`). Providers use it to
 * say both *whether* to retry and *how long* to wait, which is stronger
 * evidence than anything the adapter can infer from a status code.
 */
export interface RemedyHint {
  /** Verbatim hint, for logs and the failure message. */
  readonly raw: string;
  /** Explicit retry directive when the hint carries one, else undefined. */
  readonly retry: boolean | undefined;
  /** Wait requested by the hint, in milliseconds, when it carries one. */
  readonly delayMs: number | undefined;
}

export interface ProviderFailure {
  readonly kind: ProviderFailureKind;
  readonly status: number | undefined;
  /** Server-requested wait in ms, from Retry-After or an SDK equivalent. */
  readonly retryAfterMs: number | undefined;
  readonly remedyHint: RemedyHint | undefined;
  readonly message: string;
  /** True when another attempt could succeed without operator action. */
  readonly retryable: boolean;
}

export interface RetryPolicy {
  /** Total attempts including the first, so 3 means "first plus two retries". */
  readonly maxAttempts: number;
  /** First backoff step; attempt N waits `baseDelayMs * 2^(N-1)` before jitter. */
  readonly baseDelayMs: number;
  /** Cap on the computed exponential backoff. */
  readonly maxDelayMs: number;
  /**
   * Cap on a server-requested wait. A provider asking for longer than this is
   * asking for more than one executor call should hold, so the failure is
   * surfaced to the supervisor instead of being slept through.
   */
  readonly maxRetryAfterMs: number;
  /** Additive jitter as a fraction of the backoff step. */
  readonly jitterRatio: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  maxRetryAfterMs: 30_000,
  jitterRatio: 0.25
};

export interface RetryAttemptInfo {
  /** 1-based number of the attempt that just failed. */
  readonly attempt: number;
  readonly nextAttempt: number;
  readonly delayMs: number;
  readonly reason: RetryReason;
  readonly failure: ProviderFailure;
}

export interface RetryOptions {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly maxRetryAfterMs?: number;
  readonly jitterRatio?: number;
  /** Jitter source; injected by tests to make backoff deterministic. */
  readonly random?: () => number;
  /** Abort-aware wait; injected by tests so retries do not burn wall clock. */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Fired before each backoff sleep. The adapter itself never logs. */
  readonly onRetry?: (info: RetryAttemptInfo) => void;
}

export type RetryReason =
  | "backoff"
  | "retry-after"
  | "remedy-hint"
  | "non-retryable"
  | "attempts-exhausted"
  | "requested-delay-exceeds-cap";

export interface RetryDecision {
  readonly retry: boolean;
  readonly delayMs: number;
  readonly reason: RetryReason;
}

export function resolveRetryPolicy(options: RetryOptions | undefined): RetryPolicy {
  return {
    maxAttempts: Math.max(1, Math.trunc(options?.maxAttempts ?? DEFAULT_RETRY_POLICY.maxAttempts)),
    baseDelayMs: Math.max(0, options?.baseDelayMs ?? DEFAULT_RETRY_POLICY.baseDelayMs),
    maxDelayMs: Math.max(0, options?.maxDelayMs ?? DEFAULT_RETRY_POLICY.maxDelayMs),
    maxRetryAfterMs: Math.max(0, options?.maxRetryAfterMs ?? DEFAULT_RETRY_POLICY.maxRetryAfterMs),
    jitterRatio: Math.max(0, options?.jitterRatio ?? DEFAULT_RETRY_POLICY.jitterRatio)
  };
}

/**
 * Classify a failed provider call from whatever the boundary managed to keep:
 * the thrown object, the flattened agent error message, or both.
 */
export function classifyProviderFailure(error: unknown, errorMessage?: string): ProviderFailure {
  const texts = [messageOf(error), errorMessage].filter(
    (text): text is string => text !== undefined && text.trim() !== ""
  );
  const message = texts.length === 0 ? "unknown provider failure" : texts.join(" | ");
  const status = statusFromValue(error, 0) ?? statusFromText(message);
  const retryAfterMs = retryAfterFromValue(error, 0) ?? retryAfterFromText(message);
  const remedyHint = remedyHintFromValue(error, 0) ?? remedyHintFromText(message);
  const kind = classifyKind(status, message);
  return {
    kind,
    status,
    retryAfterMs,
    remedyHint,
    message,
    retryable: isRetryable(status, kind, remedyHint)
  };
}

/**
 * Terminal disposition recorded on the invocation. Timeouts are separated from
 * other errors so latency budgets and provider faults stay distinguishable.
 */
export function callOutcomeForFailure(failure: ProviderFailure): InvocationCallOutcome {
  return failure.kind === "timeout" ? "timeout" : "error";
}

/**
 * Decide whether to make another attempt and how long to wait first.
 * Precedence for the wait: remedy hint, then Retry-After, then exponential
 * backoff with additive jitter. The first two are what the server asked for;
 * the third is the adapter guessing.
 */
export function decideRetry(
  failure: ProviderFailure,
  attempt: number,
  policy: RetryPolicy,
  random: () => number = Math.random
): RetryDecision {
  if (!failure.retryable) {
    return { retry: false, delayMs: 0, reason: "non-retryable" };
  }
  if (attempt >= policy.maxAttempts) {
    return { retry: false, delayMs: 0, reason: "attempts-exhausted" };
  }
  const hintDelayMs = failure.remedyHint?.delayMs;
  const requested = hintDelayMs ?? failure.retryAfterMs;
  if (requested !== undefined) {
    if (requested > policy.maxRetryAfterMs) {
      return { retry: false, delayMs: 0, reason: "requested-delay-exceeds-cap" };
    }
    return {
      retry: true,
      delayMs: Math.max(0, Math.round(requested)),
      reason: hintDelayMs !== undefined ? "remedy-hint" : "retry-after"
    };
  }
  const step = Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs);
  const jittered = step * (1 + policy.jitterRatio * clampUnit(random()));
  return { retry: true, delayMs: Math.min(Math.round(jittered), policy.maxDelayMs), reason: "backoff" };
}

/** Wait that also resolves when the run is cancelled, so aborts stay prompt. */
export function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = (): void => {
      finish();
    };
    timer = setTimeout(finish, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function classifyKind(status: number | undefined, message: string): ProviderFailureKind {
  if (status !== undefined) {
    if (status === 429) return "rate-limit";
    if (AUTH_STATUS.has(status)) return "auth";
    if (TIMEOUT_STATUS.has(status)) return "timeout";
    if (status >= 500) return "server";
    return "unknown";
  }
  if (/\brate[\s_-]?limit|\btoo many requests\b|\bslow down\b/i.test(message)) return "rate-limit";
  if (/\btimed?[\s_-]?out\b|\bETIMEDOUT\b|\bESOCKETTIMEDOUT\b/i.test(message)) return "timeout";
  if (/\bunauthori[sz]ed\b|\bforbidden\b|\binvalid api[\s_-]?key\b|\bauthentication fail/i.test(message)) {
    return "auth";
  }
  if (
    /\boverloaded\b|\bservice unavailable\b|\btemporarily unavailable\b|\bbad gateway\b|\bECONNRESET\b|\bEPIPE\b|\bEAI_AGAIN\b|\bsocket hang up\b|\bfetch failed\b/i.test(
      message
    )
  ) {
    return "server";
  }
  return "unknown";
}

function isRetryable(
  status: number | undefined,
  kind: ProviderFailureKind,
  remedyHint: RemedyHint | undefined
): boolean {
  // A credential rejection is terminal no matter what the hint claims:
  // retrying only re-sends the key the provider just refused.
  if (kind === "auth") return false;
  if (remedyHint?.retry !== undefined) return remedyHint.retry;
  if (status !== undefined) return RETRYABLE_STATUS.has(status);
  return kind === "rate-limit" || kind === "server" || kind === "timeout";
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function messageOf(error: unknown): string | undefined {
  if (error === undefined || error === null) return undefined;
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  const record = asRecord(error);
  const message = record?.["message"];
  if (typeof message === "string") return message;
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asHttpStatus(value: unknown): number | undefined {
  const parsed = asFiniteNumber(value);
  if (parsed === undefined || !Number.isInteger(parsed)) return undefined;
  return parsed >= 100 && parsed <= 599 ? parsed : undefined;
}

/** SDK field names that carry an HTTP status, across the providers pi wraps. */
const STATUS_FIELDS = ["statusCode", "status", "httpStatusCode", "code"] as const;
/** Nested containers worth descending into when probing an SDK error. */
const NESTED_FIELDS = ["$metadata", "$response", "response", "error", "cause", "body", "data"] as const;
const MAX_PROBE_DEPTH = 3;

function statusFromValue(value: unknown, depth: number): number | undefined {
  const record = asRecord(value);
  if (record === undefined || depth > MAX_PROBE_DEPTH) return undefined;
  for (const field of STATUS_FIELDS) {
    const status = asHttpStatus(record[field]);
    if (status !== undefined) return status;
  }
  for (const field of NESTED_FIELDS) {
    const status = statusFromValue(record[field], depth + 1);
    if (status !== undefined) return status;
  }
  return undefined;
}

/**
 * Status shapes observed on flattened provider messages, most specific first:
 * "openrouter (429): ...", "429: {...}", "429 status code (no body)",
 * `"status": 429` inside a JSON body, and "HTTP 429".
 */
const STATUS_TEXT_PATTERNS: readonly RegExp[] = [
  /\((\d{3})\)/,
  /(?:^|\s)(\d{3})\s*:/,
  /(?:^|\s)(\d{3})\s+status[\s_-]?code\b/i,
  /"?status(?:[\s_-]?code)?"?\s*[:=]\s*"?(\d{3})"?/i,
  /"?code"?\s*[:=]\s*"?(\d{3})"?/i,
  /\bHTTP[\s/]?(?:\d(?:\.\d)?\s+)?(\d{3})\b/i
];

function statusFromText(message: string): number | undefined {
  for (const pattern of STATUS_TEXT_PATTERNS) {
    const status = asHttpStatus(pattern.exec(message)?.[1]);
    if (status !== undefined) return status;
  }
  return undefined;
}

const RETRY_AFTER_MS_FIELDS = ["retryAfterMs", "retry_after_ms", "retryDelayMs", "retry_delay_ms"] as const;
const RETRY_AFTER_SECOND_FIELDS = [
  "retryAfter",
  "retry_after",
  "retryAfterSeconds",
  "retry_after_seconds",
  "retryDelaySeconds",
  "retry_delay_seconds"
] as const;

function retryAfterFromValue(value: unknown, depth: number): number | undefined {
  const record = asRecord(value);
  if (record === undefined || depth > MAX_PROBE_DEPTH) return undefined;
  for (const field of RETRY_AFTER_MS_FIELDS) {
    const ms = asFiniteNumber(record[field]);
    if (ms !== undefined && ms >= 0) return ms;
  }
  for (const field of RETRY_AFTER_SECOND_FIELDS) {
    const ms = retryAfterToMs(record[field]);
    if (ms !== undefined) return ms;
  }
  for (const source of [record["headers"], asRecord(record["response"])?.["headers"]]) {
    const headerMs = asFiniteNumber(headerValue(source, "retry-after-ms"));
    if (headerMs !== undefined && headerMs >= 0) return headerMs;
    const headerSeconds = retryAfterToMs(headerValue(source, "retry-after"));
    if (headerSeconds !== undefined) return headerSeconds;
  }
  for (const field of NESTED_FIELDS) {
    const nested = retryAfterFromValue(record[field], depth + 1);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

/** Retry-After is either delta-seconds or an HTTP-date. Both are accepted. */
function retryAfterToMs(value: unknown): number | undefined {
  if (value instanceof Date) {
    const deltaMs = value.getTime() - Date.now();
    return Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : undefined;
  }
  const seconds = asFiniteNumber(value);
  if (seconds !== undefined) return seconds >= 0 ? seconds * 1000 : undefined;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed - Date.now()) : undefined;
}

function headerValue(source: unknown, name: string): string | undefined {
  const record = asRecord(source);
  if (record === undefined) return undefined;
  const get = record["get"];
  if (typeof get === "function") {
    try {
      const value = (get as (key: string) => unknown).call(record, name);
      if (typeof value === "string") return value;
    } catch {
      // Not a Headers-like object after all; fall through to a plain lookup.
    }
  }
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() !== name) continue;
    if (typeof value === "string") return value;
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string") return first;
    const numeric = asFiniteNumber(first);
    if (numeric !== undefined) return String(numeric);
  }
  return undefined;
}

const RETRY_AFTER_TEXT_PATTERNS: readonly RegExp[] = [
  /retry[\s_-]?after(?:[\s_-]?ms)?"?\s*[:=]?\s*"?(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?)?/i,
  /\btry again in\s+(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?)?/i
];

function retryAfterFromText(message: string): number | undefined {
  for (const pattern of RETRY_AFTER_TEXT_PATTERNS) {
    const match = pattern.exec(message);
    if (match === null) continue;
    const amount = asFiniteNumber(match[1]);
    if (amount === undefined || amount < 0) continue;
    // "retry-after-ms" and a bare "retry-after" differ only in the unit; a
    // missing unit means seconds unless the key itself said milliseconds.
    const unit = match[2] ?? (/ms\b/i.test(match[0]) ? "ms" : "s");
    return amount * unitToMs(unit);
  }
  return undefined;
}

function unitToMs(unit: string): number {
  const normalized = unit.toLowerCase();
  if (normalized.startsWith("ms") || normalized.startsWith("milli")) return 1;
  if (normalized.startsWith("m")) return 60_000;
  return 1_000;
}

const REMEDY_FIELDS = ["remedy_hint", "remedyHint"] as const;

function remedyHintFromValue(value: unknown, depth: number): RemedyHint | undefined {
  const record = asRecord(value);
  if (record === undefined || depth > MAX_PROBE_DEPTH) return undefined;
  for (const field of REMEDY_FIELDS) {
    const hint = toRemedyHint(record[field]);
    if (hint !== undefined) return hint;
  }
  for (const field of NESTED_FIELDS) {
    const nested = remedyHintFromValue(record[field], depth + 1);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function remedyHintFromText(message: string): RemedyHint | undefined {
  const match = /"?remedy[\s_-]?hint"?\s*[:=]\s*"([^"]+)"/i.exec(message);
  return match?.[1] === undefined ? undefined : parseRemedyText(match[1]);
}

function toRemedyHint(value: unknown): RemedyHint | undefined {
  if (typeof value === "string" && value.trim() !== "") return parseRemedyText(value);
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const raw = safeStringify(record);
  const structuredDelay =
    asFiniteNumber(record["delayMs"]) ??
    asFiniteNumber(record["delay_ms"]) ??
    retryAfterToMs(record["retryAfterSeconds"] ?? record["retry_after_seconds"] ?? record["retryAfter"]);
  const structuredRetry =
    typeof record["retry"] === "boolean" ? (record["retry"] as boolean) : undefined;
  const fromText = parseRemedyText(
    [record["action"], record["hint"], record["message"]]
      .filter((part): part is string => typeof part === "string")
      .join(" ")
  );
  const retry = structuredRetry ?? fromText?.retry;
  const delayMs = structuredDelay ?? fromText?.delayMs;
  if (retry === undefined && delayMs === undefined) return undefined;
  return {
    raw,
    retry,
    delayMs: delayMs !== undefined && delayMs >= 0 ? delayMs : undefined
  };
}

/** "do not retry" contains "retry", so the refusal pattern is tested first. */
const NO_RETRY_PATTERN =
  /\b(?:do not retry|don't retry|dont retry|no retry|non-?retryable|not retryable|abort|give up|fail fast|re-?authenticate|contact support|upgrade (?:your )?plan)\b/i;
const RETRY_PATTERN = /\b(?:retry|retries|retrying|back[\s_-]?off|try again|wait)\b/i;
const DURATION_PATTERN = /(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?)\b/i;

function parseRemedyText(raw: string): RemedyHint | undefined {
  const text = raw.trim();
  if (text === "") return undefined;
  const retry = NO_RETRY_PATTERN.test(text) ? false : RETRY_PATTERN.test(text) ? true : undefined;
  const match = DURATION_PATTERN.exec(text);
  const amount = asFiniteNumber(match?.[1]);
  const unit = match?.[2];
  const delayMs =
    amount !== undefined && amount >= 0 && unit !== undefined ? amount * unitToMs(unit) : undefined;
  if (retry === undefined && delayMs === undefined) return undefined;
  // A hint that names a wait is asking for a retry after that wait.
  return { raw: text, retry: retry ?? (delayMs !== undefined ? true : undefined), delayMs };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
