import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type FauxResponseStep
} from "@earendil-works/pi-ai";
import { PiAgentExecutor } from "../../../src/pi-adapter/pi-executor.js";
import type { RetryAttemptInfo } from "../../../src/pi-adapter/provider-retry.js";
import type { AgentExecutionRequest, ExecutionEvent } from "../../../src/execution/contract.js";
import type { ModelInvocation } from "../../../src/telemetry/model-invocation.js";
import { isInvocation } from "../../../src/telemetry/model-invocation.js";

/**
 * 2026-08-22 weak-area report §1.3: a 429 failed the agent immediately and the
 * run limits never re-drove the executor. These tests script a faux provider
 * (no network, no timers) so the retry path is exercised end to end through
 * `execute()`.
 */

function request(): AgentExecutionRequest {
  return {
    runId: "run_1",
    taskId: "tsk_1",
    agentInstanceId: "agt_1",
    prompt: "Reply with exactly: OK",
    workingDirectory: "/tmp/project"
  } as unknown as AgentExecutionRequest;
}

/** A provider error shaped the way pi flattens one onto the assistant message. */
function providerError(status: number, body: string): () => never {
  return () => {
    throw new Error(`${status}: ${body}`);
  };
}

interface Harness {
  readonly executor: PiAgentExecutor;
  readonly invocations: ModelInvocation[];
  readonly retries: RetryAttemptInfo[];
  readonly waits: number[];
  readonly callCount: () => number;
}

function harness(responses: FauxResponseStep[], maxAttempts = 3): Harness {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses(responses);
  const invocations: ModelInvocation[] = [];
  const retries: RetryAttemptInfo[] = [];
  const waits: number[] = [];
  const executor = new PiAgentExecutor({
    providerId: "faux",
    modelId: "faux-1",
    models,
    retry: {
      maxAttempts,
      baseDelayMs: 10,
      jitterRatio: 0,
      random: () => 0,
      // No real waiting: the delay is asserted, not slept through.
      sleep: async (ms) => {
        waits.push(ms);
      },
      onRetry: (info) => retries.push(info)
    },
    onInvocation: (invocation) => invocations.push(invocation)
  });
  return { executor, invocations, retries, waits, callCount: () => faux.state.callCount };
}

async function drain(
  executor: PiAgentExecutor,
  signal: AbortSignal = new AbortController().signal
): Promise<ExecutionEvent[]> {
  const events: ExecutionEvent[] = [];
  for await (const event of executor.execute(request(), signal)) {
    events.push(event);
  }
  return events;
}

function outcomeOf(events: readonly ExecutionEvent[]): string {
  const finished = events.find((event) => event.type === "EXECUTION_FINISHED");
  return finished?.type === "EXECUTION_FINISHED" ? finished.outcome : "none";
}

function textOf(events: readonly ExecutionEvent[]): string {
  return events
    .filter((event): event is Extract<ExecutionEvent, { type: "TEXT_DELTA" }> => event.type === "TEXT_DELTA")
    .map((event) => event.text)
    .join("");
}

describe("PiAgentExecutor 429 retry", () => {
  it("retries a 429 and succeeds on the second attempt", async () => {
    const scripted = harness([
      providerError(429, '{"error":{"message":"rate limit exceeded"}}'),
      fauxAssistantMessage("recovered after backoff")
    ]);
    const events = await drain(scripted.executor);

    assert.equal(outcomeOf(events), "SUCCESS");
    assert.equal(scripted.callCount(), 2, "the provider must actually be called twice");
    assert.equal(textOf(events), "recovered after backoff");
    // The failed attempt's (empty) transcript must not leak into the result.
    assert.equal(scripted.retries.length, 1);
    assert.equal(scripted.retries[0]?.failure.status, 429);
    assert.equal(scripted.retries[0]?.failure.kind, "rate-limit");
    assert.deepEqual(scripted.waits, [10]);

    const record = scripted.invocations[0];
    assert.ok(record !== undefined);
    assert.equal(isInvocation(record), true);
    assert.equal(record.attempt, 2, "attempt must count the retry");
    assert.equal(record.callOutcome, "ok");
  });

  it("honors Retry-After instead of the computed backoff", async () => {
    const scripted = harness([
      providerError(429, '{"error":{"message":"slow down","retry_after":2}}'),
      fauxAssistantMessage("ok")
    ]);
    await drain(scripted.executor);
    assert.deepEqual(scripted.waits, [2_000]);
    assert.equal(scripted.retries[0]?.reason, "retry-after");
  });

  it("honors a remedy_hint carried on the error payload", async () => {
    const scripted = harness([
      providerError(429, '{"error":{"remedy_hint":"retry after 250 ms"}}'),
      fauxAssistantMessage("ok")
    ]);
    await drain(scripted.executor);
    assert.deepEqual(scripted.waits, [250]);
    assert.equal(scripted.retries[0]?.reason, "remedy-hint");
  });

  it("gives up after the attempt cap and records a terminal error", async () => {
    const scripted = harness(
      [
        providerError(429, "rate limited"),
        providerError(429, "rate limited"),
        providerError(429, "rate limited"),
        fauxAssistantMessage("never reached")
      ],
      3
    );
    const events = await drain(scripted.executor);

    assert.equal(outcomeOf(events), "FAILURE");
    assert.equal(scripted.callCount(), 3, "attempts are capped at maxAttempts");
    assert.equal(scripted.retries.length, 2, "two backoffs between three attempts");
    const record = scripted.invocations[0];
    assert.equal(record?.attempt, 3);
    assert.equal(record?.callOutcome, "error");
  });

  it("does not retry an auth rejection", async () => {
    const scripted = harness([
      providerError(401, '{"error":{"message":"invalid api key"}}'),
      fauxAssistantMessage("never reached")
    ]);
    const events = await drain(scripted.executor);

    assert.equal(outcomeOf(events), "FAILURE");
    assert.equal(scripted.callCount(), 1, "a rejected credential must not be re-sent");
    assert.deepEqual(scripted.retries, []);
    assert.equal(scripted.invocations[0]?.attempt, 1);
    assert.equal(scripted.invocations[0]?.callOutcome, "error");
  });

  it("retries a transient 503 and marks a 504 as a timeout", async () => {
    const serverError = harness([providerError(503, "upstream overloaded"), fauxAssistantMessage("ok")]);
    assert.equal(outcomeOf(await drain(serverError.executor)), "SUCCESS");
    assert.equal(serverError.callCount(), 2);

    const timeout = harness([providerError(504, "gateway timeout")], 1);
    await drain(timeout.executor);
    assert.equal(timeout.invocations[0]?.callOutcome, "timeout");
  });

  it("records attempt 1 and callOutcome ok on a clean first call", async () => {
    const scripted = harness([fauxAssistantMessage("first time lucky")]);
    assert.equal(outcomeOf(await drain(scripted.executor)), "SUCCESS");
    assert.equal(scripted.callCount(), 1);
    assert.deepEqual(scripted.waits, []);
    assert.equal(scripted.invocations[0]?.attempt, 1);
    assert.equal(scripted.invocations[0]?.callOutcome, "ok");
  });

  it("stops retrying when the run is cancelled and reports it as cancelled", async () => {
    const scripted = harness([
      providerError(429, "rate limited"),
      providerError(429, "rate limited"),
      fauxAssistantMessage("never reached")
    ]);
    const controller = new AbortController();
    controller.abort();
    const events = await drain(scripted.executor, controller.signal);

    assert.equal(outcomeOf(events), "CANCELLED");
    assert.deepEqual(scripted.retries, [], "a cancelled run must not schedule a backoff");
    assert.equal(scripted.invocations[0]?.callOutcome, "cancelled");
  });
});

describe("usage integrity across retries", () => {
  it("stores undefined usage for a failed call instead of the error payload's zeros", async () => {
    const scripted = harness([providerError(429, "rate limited")], 1);
    await drain(scripted.executor);
    const record = scripted.invocations[0];
    assert.ok(record !== undefined);
    assert.equal(record.callOutcome, "error");
    assert.equal(record.tokensIn, undefined, "a failed call reports no trustworthy usage");
    assert.equal(record.tokensOut, undefined);
  });

  it("keeps real usage from the successful retry", async () => {
    const scripted = harness([providerError(429, "rate limited"), fauxAssistantMessage("recovered")]);
    await drain(scripted.executor);
    const record = scripted.invocations[0];
    assert.ok(record !== undefined);
    assert.equal(record.callOutcome, "ok");
    assert.equal(typeof record.tokensIn, "number");
    assert.ok((record.tokensIn ?? 0) > 0);
  });
});
