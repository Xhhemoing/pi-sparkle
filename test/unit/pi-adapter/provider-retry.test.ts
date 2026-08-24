import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_RETRY_POLICY,
  callOutcomeForFailure,
  classifyProviderFailure,
  decideRetry,
  resolveRetryPolicy,
  sleepWithAbort
} from "../../../src/pi-adapter/provider-retry.js";

/**
 * 2026-08-22 weak-area report §1.3: a 429 failed the agent immediately, four
 * runs in a row, against an upstream pool that recovered on its own. The
 * classifier has to recognize a rate limit both as a thrown SDK error and as
 * the flattened string the agent loop keeps on `state.errorMessage`.
 */

describe("provider failure classification", () => {
  it("treats a thrown 429 as a retryable rate limit", () => {
    const failure = classifyProviderFailure(Object.assign(new Error("Too Many Requests"), { status: 429 }));
    assert.equal(failure.status, 429);
    assert.equal(failure.kind, "rate-limit");
    assert.equal(failure.retryable, true);
    assert.equal(callOutcomeForFailure(failure), "error");
  });

  it("recovers the status from the flattened agent error message", () => {
    for (const message of [
      '429: {"error":{"message":"rate limit exceeded"}}',
      "openrouter-ox (429): upstream pool exhausted",
      "429 status code (no body)",
      'provider said {"status":429,"detail":"slow down"}'
    ]) {
      const failure = classifyProviderFailure(undefined, message);
      assert.equal(failure.status, 429, message);
      assert.equal(failure.retryable, true, message);
    }
  });

  it("falls back to rate-limit wording when no status survived", () => {
    const failure = classifyProviderFailure(undefined, "Rate limit reached for this key");
    assert.equal(failure.status, undefined);
    assert.equal(failure.kind, "rate-limit");
    assert.equal(failure.retryable, true);
  });

  it("never retries 401/403, whatever the message claims", () => {
    for (const status of [401, 403]) {
      const failure = classifyProviderFailure(Object.assign(new Error("nope"), { status }));
      assert.equal(failure.kind, "auth");
      assert.equal(failure.retryable, false);
    }
    // Even an explicit provider instruction cannot make a rejected credential
    // worth re-sending.
    const hinted = classifyProviderFailure({ status: 401, remedy_hint: "retry in 5s" });
    assert.equal(hinted.retryable, false);
  });

  it("retries transient 5xx but not deterministic 4xx", () => {
    for (const status of [500, 502, 503, 504, 529, 408]) {
      assert.equal(classifyProviderFailure({ status }).retryable, true, `status ${status}`);
    }
    for (const status of [400, 404, 422, 501]) {
      assert.equal(classifyProviderFailure({ status }).retryable, false, `status ${status}`);
    }
  });

  it("marks timeouts separately so attribution stays honest", () => {
    assert.equal(callOutcomeForFailure(classifyProviderFailure({ status: 504 })), "timeout");
    assert.equal(
      callOutcomeForFailure(classifyProviderFailure(undefined, "socket timed out after 60000ms")),
      "timeout"
    );
  });

  it("digs the status out of nested SDK error shapes", () => {
    assert.equal(classifyProviderFailure({ $metadata: { httpStatusCode: 429 } }).status, 429);
    assert.equal(classifyProviderFailure({ response: { status: 503 } }).status, 503);
    assert.equal(classifyProviderFailure({ cause: { statusCode: 429 } }).status, 429);
  });
});

describe("Retry-After extraction", () => {
  it("reads delta-seconds from a Headers-like object", () => {
    const failure = classifyProviderFailure({
      status: 429,
      headers: new Headers({ "retry-after": "12" })
    });
    assert.equal(failure.retryAfterMs, 12_000);
  });

  it("reads a plain header record and the millisecond variant", () => {
    assert.equal(classifyProviderFailure({ status: 429, headers: { "Retry-After": "3" } }).retryAfterMs, 3_000);
    assert.equal(
      classifyProviderFailure({ status: 429, headers: { "retry-after-ms": "1500" } }).retryAfterMs,
      1_500
    );
  });

  it("reads SDK fields and the flattened message", () => {
    assert.equal(classifyProviderFailure({ status: 429, retryAfterSeconds: 7 }).retryAfterMs, 7_000);
    assert.equal(
      classifyProviderFailure(undefined, '429: {"error":{"retry_after":4}}').retryAfterMs,
      4_000
    );
    assert.equal(
      classifyProviderFailure(undefined, "429 rate limited, try again in 2.5 seconds").retryAfterMs,
      2_500
    );
  });
});

describe("remedy_hint", () => {
  it("honors a wait requested by a string hint", () => {
    const failure = classifyProviderFailure({ status: 429, remedy_hint: "back off for 6 seconds" });
    assert.equal(failure.remedyHint?.delayMs, 6_000);
    assert.equal(failure.remedyHint?.retry, true);
    const decision = decideRetry(failure, 1, DEFAULT_RETRY_POLICY, () => 0);
    assert.deepEqual(
      { retry: decision.retry, delayMs: decision.delayMs, reason: decision.reason },
      { retry: true, delayMs: 6_000, reason: "remedy-hint" }
    );
  });

  it("honors a structured hint and lets it veto a retry", () => {
    const structured = classifyProviderFailure({
      status: 503,
      error: { remedy_hint: { retry: true, delayMs: 250 } }
    });
    assert.equal(structured.remedyHint?.delayMs, 250);
    assert.equal(structured.retryable, true);

    const refused = classifyProviderFailure({ status: 503, remedy_hint: "do not retry; upgrade your plan" });
    assert.equal(refused.remedyHint?.retry, false);
    assert.equal(refused.retryable, false);
    assert.equal(decideRetry(refused, 1, DEFAULT_RETRY_POLICY).reason, "non-retryable");
  });

  it("reads a hint that only survived inside the flattened message", () => {
    const failure = classifyProviderFailure(
      undefined,
      '429: {"error":{"remedy_hint":"retry after 1500 ms"}}'
    );
    assert.equal(failure.remedyHint?.delayMs, 1_500);
  });

  it("prefers the hint over the Retry-After header", () => {
    const failure = classifyProviderFailure({
      status: 429,
      headers: { "retry-after": "20" },
      remedy_hint: "retry in 2s"
    });
    const decision = decideRetry(failure, 1, DEFAULT_RETRY_POLICY);
    assert.equal(decision.delayMs, 2_000);
    assert.equal(decision.reason, "remedy-hint");
  });
});

describe("retry decisions", () => {
  const policy = resolveRetryPolicy({ maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 8_000, jitterRatio: 0.5 });

  it("backs off exponentially with bounded jitter", () => {
    assert.equal(decideRetry(classifyProviderFailure({ status: 429 }), 1, policy, () => 0).delayMs, 100);
    assert.equal(decideRetry(classifyProviderFailure({ status: 429 }), 2, policy, () => 0).delayMs, 200);
    // Full jitter adds at most jitterRatio of the step.
    assert.equal(decideRetry(classifyProviderFailure({ status: 429 }), 2, policy, () => 1).delayMs, 300);
  });

  it("caps the computed backoff", () => {
    const capped = resolveRetryPolicy({ maxAttempts: 20, baseDelayMs: 1_000, maxDelayMs: 8_000, jitterRatio: 0.5 });
    for (let attempt = 1; attempt < 15; attempt += 1) {
      const decision = decideRetry(classifyProviderFailure({ status: 429 }), attempt, capped, () => 1);
      assert.ok(decision.delayMs <= 8_000, `attempt ${attempt} waited ${decision.delayMs}ms`);
    }
  });

  it("stops at the attempt cap", () => {
    const failure = classifyProviderFailure({ status: 429 });
    assert.equal(decideRetry(failure, 2, policy).retry, true);
    const exhausted = decideRetry(failure, 3, policy);
    assert.equal(exhausted.retry, false);
    assert.equal(exhausted.reason, "attempts-exhausted");
  });

  it("refuses to sleep through a server-requested wait longer than the cap", () => {
    const failure = classifyProviderFailure({ status: 429, headers: { "retry-after": "1200" } });
    const decision = decideRetry(failure, 1, policy);
    assert.equal(decision.retry, false);
    assert.equal(decision.reason, "requested-delay-exceeds-cap");
  });

  it("honors a Retry-After inside the cap verbatim, without jitter", () => {
    const failure = classifyProviderFailure({ status: 429, headers: { "retry-after": "3" } });
    const decision = decideRetry(failure, 1, policy, () => 1);
    assert.deepEqual(
      { retry: decision.retry, delayMs: decision.delayMs, reason: decision.reason },
      { retry: true, delayMs: 3_000, reason: "retry-after" }
    );
  });
});

describe("abort-aware sleep", () => {
  it("resolves immediately when the run is already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const startedAt = Date.now();
    await sleepWithAbort(5_000, controller.signal);
    assert.ok(Date.now() - startedAt < 1_000);
  });

  it("resolves early when the run is cancelled mid-wait", async () => {
    const controller = new AbortController();
    const startedAt = Date.now();
    const waiting = sleepWithAbort(5_000, controller.signal);
    setTimeout(() => controller.abort(), 10);
    await waiting;
    assert.ok(Date.now() - startedAt < 1_000);
  });
});
