import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type FauxProviderHandle,
  type FauxResponseStep,
  type MutableModels
} from "@earendil-works/pi-ai";
import { PiAgentExecutor } from "../../../src/pi-adapter/pi-executor.js";
import type { RetryAttemptInfo } from "../../../src/pi-adapter/provider-retry.js";
import type { AgentExecutionRequest, ExecutionEvent } from "../../../src/execution/contract.js";
import type { ModelInvocation } from "../../../src/telemetry/model-invocation.js";
import { isInvocation } from "../../../src/telemetry/model-invocation.js";

/**
 * Loop 4 R1 §9: `runAttempt` guarded cancellation with an "abort" listener
 * only, and an already-aborted signal fires no such event. An executor
 * reached after its run was cancelled therefore paid for a full provider
 * call. These tests pin the three windows — before the first attempt, between
 * attempts, and racing the listener registration — by counting the *provider
 * stream calls* the executor actually makes.
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

function providerError(status: number, body: string): () => never {
  return () => {
    throw new Error(`${status}: ${body}`);
  };
}

type StreamArgs = Parameters<MutableModels["streamSimple"]>;
type StreamResult = ReturnType<MutableModels["streamSimple"]>;

interface ModelsSpy {
  readonly models: MutableModels;
  /** Provider stream calls: the thing an aborted run must never pay for. */
  readonly streamCalls: () => number;
  /** Catalog lookups, which only happen when the executor builds an Agent. */
  readonly modelLookups: () => number;
}

/**
 * Real models with the faux provider behind a counting proxy. Methods are
 * bound to the underlying instance so its private state stays reachable.
 */
function spyModels(faux: FauxProviderHandle, onStream?: () => void): ModelsSpy {
  const base = createModels();
  base.setProvider(faux.provider);
  let streamCalls = 0;
  let modelLookups = 0;
  const models = new Proxy(base, {
    get(target, property) {
      if (property === "streamSimple") {
        return (...args: StreamArgs): StreamResult => {
          streamCalls += 1;
          onStream?.();
          return target.streamSimple(...args);
        };
      }
      if (property === "getModel") {
        return (provider: string, id: string) => {
          modelLookups += 1;
          return target.getModel(provider, id);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  return { models, streamCalls: () => streamCalls, modelLookups: () => modelLookups };
}

interface Harness {
  readonly executor: PiAgentExecutor;
  readonly invocations: ModelInvocation[];
  readonly retries: RetryAttemptInfo[];
  readonly waits: number[];
  readonly spy: ModelsSpy;
  readonly callCount: () => number;
}

interface HarnessOptions {
  readonly responses: FauxResponseStep[];
  readonly maxAttempts?: number;
  /** Fires synchronously on the provider's first tick of every stream call. */
  readonly onStream?: () => void;
  /** Fires instead of a real backoff sleep. */
  readonly onSleep?: () => void;
  readonly withInvocationSink?: boolean;
}

function harness(options: HarnessOptions): Harness {
  const faux = fauxProvider();
  faux.setResponses(options.responses);
  const spy = spyModels(faux, options.onStream);
  const invocations: ModelInvocation[] = [];
  const retries: RetryAttemptInfo[] = [];
  const waits: number[] = [];
  const executor = new PiAgentExecutor({
    providerId: "faux",
    modelId: "faux-1",
    models: spy.models,
    retry: {
      maxAttempts: options.maxAttempts ?? 3,
      baseDelayMs: 10,
      jitterRatio: 0,
      random: () => 0,
      sleep: async (ms) => {
        waits.push(ms);
        options.onSleep?.();
      },
      onRetry: (info) => retries.push(info)
    },
    ...(options.withInvocationSink === false
      ? {}
      : { onInvocation: (invocation: ModelInvocation) => invocations.push(invocation) })
  });
  return { executor, invocations, retries, waits, spy, callCount: () => faux.state.callCount };
}

async function drain(executor: PiAgentExecutor, signal: AbortSignal): Promise<ExecutionEvent[]> {
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

describe("PiAgentExecutor pre-aborted signal", () => {
  it("makes no provider call at all and reports CANCELLED", async () => {
    const scripted = harness({ responses: [fauxAssistantMessage("must never be requested")] });
    const controller = new AbortController();
    controller.abort();

    const events = await drain(scripted.executor, controller.signal);

    assert.equal(scripted.spy.streamCalls(), 0, "an aborted run must not open a provider stream");
    assert.equal(scripted.callCount(), 0, "the provider must never be reached");
    assert.equal(
      scripted.spy.modelLookups(),
      0,
      "no catalog lookup means no Agent was constructed for a dead run"
    );
    assert.equal(outcomeOf(events), "CANCELLED");
    assert.deepEqual(
      events.map((event) => event.type),
      ["MESSAGE", "EXECUTION_FINISHED"],
      "a short-circuited run emits only its terminal result"
    );
    assert.deepEqual(scripted.retries, []);
    assert.deepEqual(scripted.waits, []);
  });

  it("records the cancelled invocation with no fabricated usage", async () => {
    const scripted = harness({ responses: [fauxAssistantMessage("must never be requested")] });
    const controller = new AbortController();
    controller.abort();

    await drain(scripted.executor, controller.signal);

    const record = scripted.invocations[0];
    assert.ok(record !== undefined, "cancellation is still one accounted-for invocation");
    assert.equal(scripted.invocations.length, 1);
    assert.equal(isInvocation(record), true);
    assert.equal(record.callOutcome, "cancelled");
    assert.equal(record.tokensIn, undefined, "a call that never happened reports no usage");
    assert.equal(record.tokensOut, undefined);
    assert.equal(record.attempt, 1);
    assert.equal(record.config.provider, "faux");
    assert.equal(record.config.model, "faux-1");
    assert.ok(
      record.latencyMs <= 50,
      `short-circuit latency must be ~0, got ${String(record.latencyMs)}ms`
    );
  });

  it("short-circuits without an invocation sink too", async () => {
    const scripted = harness({
      responses: [fauxAssistantMessage("must never be requested")],
      withInvocationSink: false
    });
    const controller = new AbortController();
    controller.abort();

    const events = await drain(scripted.executor, controller.signal);

    assert.equal(outcomeOf(events), "CANCELLED");
    assert.equal(scripted.spy.streamCalls(), 0);
    assert.deepEqual(scripted.invocations, []);
  });
});

describe("PiAgentExecutor abort between attempts", () => {
  it("does not start attempt N+1 when the signal flips during the backoff", async () => {
    const controller = new AbortController();
    const scripted = harness({
      responses: [
        providerError(429, "rate limited"),
        fauxAssistantMessage("never reached"),
        fauxAssistantMessage("never reached either")
      ],
      onSleep: () => controller.abort()
    });

    const events = await drain(scripted.executor, controller.signal);

    assert.equal(scripted.spy.streamCalls(), 1, "the retry must not be issued after cancellation");
    assert.deepEqual(scripted.waits, [10], "the backoff was entered before the signal flipped");
    assert.equal(outcomeOf(events), "CANCELLED");
    assert.equal(scripted.invocations[0]?.callOutcome, "cancelled");
    assert.equal(scripted.invocations[0]?.attempt, 1, "only the first attempt ever ran");
    assert.equal(scripted.invocations[0]?.tokensIn, undefined);
  });
});

describe("PiAgentExecutor abort racing listener registration", () => {
  it("cancels a run aborted on the provider's first tick", async () => {
    const controller = new AbortController();
    const scripted = harness({
      responses: [
        providerError(429, "rate limited"),
        fauxAssistantMessage("never reached")
      ],
      onStream: () => controller.abort()
    });

    const events = await drain(scripted.executor, controller.signal);

    assert.equal(scripted.spy.streamCalls(), 1, "a retryable failure must not be retried once cancelled");
    assert.equal(outcomeOf(events), "CANCELLED");
    assert.deepEqual(scripted.retries, [], "a cancelled run must not schedule a backoff");
    assert.equal(scripted.invocations[0]?.callOutcome, "cancelled");
  });
});

describe("PiAgentExecutor without cancellation", () => {
  it("leaves the uncancelled path untouched", async () => {
    const scripted = harness({
      responses: [providerError(429, "rate limited"), fauxAssistantMessage("recovered")]
    });

    const events = await drain(scripted.executor, new AbortController().signal);

    assert.equal(outcomeOf(events), "SUCCESS");
    assert.equal(scripted.spy.streamCalls(), 2, "the retry still happens when nothing was cancelled");
    assert.equal(scripted.invocations[0]?.callOutcome, "ok");
    assert.equal(scripted.invocations[0]?.attempt, 2);
  });
});
