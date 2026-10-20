import { DomainValidationError } from "../domain/errors.js";
import { GithubReceiptStore, snapshotGithubDelivery, type GithubDelivery, type GithubReceiptResult } from "./github-receipt-store.js";

export interface GithubGetRequest {
  readonly method: "GET";
  readonly headers: Readonly<Record<string, string>>;
  readonly redirect: "manual";
  readonly signal: AbortSignal;
}
/** Host-owned transport must honor abort, including streamed body reads. */
export type GithubGetTransport = (url: string, request: GithubGetRequest) => Promise<Response>;
export interface GithubDraftImporterOptions {
  /** Root API origin only; enterprise API base paths are not supported by this initial API. */
  readonly apiOrigin: string;
  readonly expectedRepositoryId: number;
  readonly receipts: GithubReceiptStore;
  /** Explicit host credential; never read from ambient environment. */
  readonly credential?: string;
  readonly fetch?: GithubGetTransport;
  readonly timeoutMs?: number;
  /** Shared byte allowance for repository + issue response bodies. */
  readonly maxResponseBytes?: number;
  readonly now?: () => number;
}
export interface GithubDraft {
  readonly identity: string;
  readonly repositoryId: number;
  readonly number: number;
  readonly locator: GithubDelivery["locator"];
  readonly kind: "issue" | "pull-request";
  readonly title: string;
  readonly body: string;
  readonly observedAt: string;
  readonly sourceUpdatedAt: string;
  readonly trust: "untrusted-external-data";
}
export type GithubImportResult =
  | { readonly status: "draft"; readonly receipt: GithubReceiptResult; readonly draft: GithubDraft }
  | { readonly status: "rate-limited"; readonly receipt: GithubReceiptResult; readonly retryAfterMs?: number }
  | { readonly status: "unavailable" | "not-found-or-hidden" | "identity-mismatch" | "invalid-response" | "cancelled" | "deadline";
      readonly receipt?: GithubReceiptResult };
export interface GithubImportOperation { readonly signal?: AbortSignal }
function fail(reason: string): never { throw new DomainValidationError(`GitHub import: ${reason}`); }
function record(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).some((key) => typeof key !== "string" || (keys !== undefined && !keys.includes(key))) ||
      Object.values(Object.getOwnPropertyDescriptors(value)).some((entry) => !entry.enumerable || entry.get !== undefined || entry.set !== undefined)) fail("invalid object fields or accessors");
  return value as Record<string, unknown>;
}
function limit(value: number | undefined, fallback: number, maximum: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) fail("invalid transport limit");
  return result;
}
class ResponseFailure extends Error {}
class HttpFailure extends Error {
  constructor(readonly status: "unavailable" | "not-found-or-hidden" | "rate-limited", readonly retryAfterMs?: number) { super(status); }
}

/** An opt-in read-only fetcher. A draft grants no local queue, recipe, acceptance or apply authority. */
export class GithubDraftImporter {
  private readonly origin: string;
  private readonly repositoryId: number;
  private readonly receipts: GithubReceiptStore;
  private readonly transport: GithubGetTransport;
  private readonly headers: Readonly<Record<string, string>>;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly now: () => number;
  constructor(options: GithubDraftImporterOptions) {
    record(options, ["apiOrigin", "expectedRepositoryId", "receipts", "credential", "fetch", "timeoutMs", "maxResponseBytes", "now"]);
    if (typeof options.apiOrigin !== "string" || options.apiOrigin.length > 4096) fail("invalid API origin");
    let origin: URL;
    try { origin = new URL(options.apiOrigin); } catch { fail("invalid API origin"); }
    if (!["http:", "https:"].includes(origin.protocol) || origin.username !== "" || origin.password !== "" ||
        origin.pathname !== "/" || origin.search !== "" || origin.hash !== "") fail("API must be a root origin without credentials/path/query/fragment");
    if (!Number.isSafeInteger(options.expectedRepositoryId) || options.expectedRepositoryId < 1) fail("invalid expected repository ID");
    if (!(options.receipts instanceof GithubReceiptStore)) fail("explicit receipt store required");
    if (options.fetch !== undefined && typeof options.fetch !== "function") fail("invalid GET transport");
    if (options.now !== undefined && typeof options.now !== "function") fail("invalid clock");
    if (options.credential !== undefined && (typeof options.credential !== "string" || !/^[\x21-\x7e]{1,4096}$/.test(options.credential))) fail("invalid explicit credential");
    this.origin = origin.origin; this.repositoryId = options.expectedRepositoryId; this.receipts = options.receipts;
    this.transport = options.fetch ?? fetch; this.now = options.now ?? Date.now;
    this.timeoutMs = limit(options.timeoutMs, 10_000, 300_000);
    this.maxResponseBytes = limit(options.maxResponseBytes, 1_048_576, 1_048_576);
    this.headers = Object.freeze({ Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
      ...(options.credential === undefined ? {} : { Authorization: `Bearer ${options.credential}` }) });
  }
  async import(input: GithubDelivery, operation: GithubImportOperation = {}): Promise<GithubImportResult> {
    const delivery = snapshotGithubDelivery(input);
    record(operation, ["signal"]); const external = operation.signal;
    if (external !== undefined && !(external instanceof AbortSignal)) fail("invalid cancellation signal");
    if (external?.aborted) return Object.freeze({ status: "cancelled" });
    const receipt = await this.receipts.receive(delivery);
    if (external?.aborted) return Object.freeze({ status: "cancelled", receipt });
    const controller = new AbortController();
    const signal = external === undefined ? controller.signal : AbortSignal.any([external, controller.signal]);
    let expired = false; let remaining = this.maxResponseBytes;
    const deadline = performance.now() + this.timeoutMs;
    const timer = setTimeout(() => { expired = true; controller.abort(); }, this.timeoutMs);
    const stopped = (): void => {
      // Timers cannot run while trusted host code blocks the event loop. Check
      // elapsed time again when control returns, without claiming termination.
      if (performance.now() >= deadline) { expired = true; controller.abort(); }
      if (signal.aborted) throw new Error("aborted");
    };
    const get = async (path: string): Promise<Record<string, unknown>> => {
      stopped();
      const response = await this.transport(`${this.origin}${path}`, { method: "GET", headers: this.headers, redirect: "manual", signal });
      stopped();
      if (response.status !== 200) {
        let hint: number | undefined;
        if (response.status === 429) {
          const retry = response.headers.get("retry-after");
          const reset = response.headers.get("x-ratelimit-reset");
          const seconds = retry !== null && /^\d{1,16}$/.test(retry) ? Number(retry) :
            reset !== null && /^\d{1,16}$/.test(reset) ? Math.max(0, Number(reset) - this.now() / 1000) : undefined;
          if (seconds !== undefined && Number.isFinite(seconds)) hint = Math.min(3_600_000, Math.ceil(seconds * 1000));
        }
        await response.body?.cancel();
        throw new HttpFailure(response.status === 404 ? "not-found-or-hidden" : response.status === 429 ? "rate-limited" : "unavailable", hint);
      }
      if (response.body === null) throw new ResponseFailure();
      const length = response.headers.get("content-length");
      if (length !== null && /^\d+$/.test(length) && Number(length) > remaining) {
        await response.body.cancel(); throw new ResponseFailure();
      }
      const reader = response.body.getReader(); const parts: Uint8Array[] = [];
      try {
        while (true) {
          const chunk = await reader.read(); stopped();
          if (chunk.done) break;
          remaining -= chunk.value.byteLength;
          if (remaining < 0) { await reader.cancel(); throw new ResponseFailure(); }
          parts.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      stopped();
      try { return record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts))) as unknown); }
      catch { throw new ResponseFailure(); }
    };
    try {
      const base = `/repos/${encodeURIComponent(delivery.locator.owner)}/${encodeURIComponent(delivery.locator.repository)}`;
      const repository = await get(base);
      if (repository.id !== this.repositoryId) return Object.freeze({ status: "identity-mismatch", receipt });
      const current = await get(`${base}/issues/${delivery.locator.number}`);
      if (current.number !== delivery.locator.number || typeof current.title !== "string" || Buffer.byteLength(current.title) > 1024 ||
          !(current.body === null || typeof current.body === "string") || (typeof current.body === "string" && Buffer.byteLength(current.body) > 262_144) ||
          typeof current.updated_at !== "string" || current.updated_at.length > 64 || !Number.isFinite(Date.parse(current.updated_at))) throw new ResponseFailure();
      if (current.pull_request !== undefined) record(current.pull_request);
      const observed = this.now();
      if (!Number.isSafeInteger(observed) || observed < 0 || !Number.isFinite(new Date(observed).valueOf())) throw new ResponseFailure();
      stopped();
      return Object.freeze({ status: "draft", receipt, draft: Object.freeze({ identity: `${this.repositoryId}:${delivery.locator.number}`,
        repositoryId: this.repositoryId, number: delivery.locator.number, locator: delivery.locator,
        kind: current.pull_request === undefined ? "issue" : "pull-request", title: current.title, body: current.body ?? "",
        observedAt: new Date(observed).toISOString(), sourceUpdatedAt: new Date(current.updated_at).toISOString(), trust: "untrusted-external-data" }) });
    } catch (error) {
      if (external?.aborted) return Object.freeze({ status: "cancelled", receipt });
      if (expired) return Object.freeze({ status: "deadline", receipt });
      if (error instanceof HttpFailure) return Object.freeze({ status: error.status, receipt,
        ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }) });
      return Object.freeze({ status: error instanceof ResponseFailure || error instanceof DomainValidationError ? "invalid-response" : "unavailable", receipt });
    } finally { clearTimeout(timer); controller.abort(); }
  }
}
