import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  Type,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type Context,
  type FauxResponseStep
} from "@earendil-works/pi-ai";
import { createAgentInstanceId, createRunId, createTaskId } from "../../../src/domain/ids.js";
import type { ExecutionEvent } from "../../../src/execution/contract.js";
import { PiAgentExecutor } from "../../../src/pi-adapter/pi-executor.js";
import type { RetryAttemptInfo } from "../../../src/pi-adapter/provider-retry.js";

/**
 * A steer accepted mid-attempt has to survive that attempt being retried.
 *
 * `runWithRetry` builds a fresh Agent per attempt, so the context that carried
 * a steer into attempt N is discarded when a 429 sends the executor to attempt
 * N+1. The run's `STEER_INJECTED` record is written as soon as this executor
 * accepts the text, so a dropped steer would leave the log permanently
 * claiming the run was told something no surviving model call ever saw.
 */

const STEER_TEXT = "Switch to the migration path and skip the rewrite.";
const RATE_LIMIT = '429: {"error":{"message":"rate limit exceeded"}}';
const PROMPT = "Call blocking_hook, then report.";

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

function deferred(): Deferred {
  let settle: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return {
    promise,
    resolve: () => settle?.()
  };
}

function userTurnsOf(context: Context): string[] {
  return context.messages
    .filter((message) => message.role === "user")
    .map((message) => JSON.stringify(message.content));
}

const hookParameters = Type.Object({});

/**
 * One tool call that holds attempt 1 open, so the run is steerable at a moment
 * the transcript makes observable — the same shape as the blocked-tool pin.
 */
function blockingHook(
  started: Deferred,
  release: Deferred
): AgentTool<typeof hookParameters, Record<string, never>> {
  return {
    name: "blocking_hook",
    label: "Blocking hook",
    description: "Hold the turn open until the test has steered the run.",
    parameters: hookParameters,
    execute: async () => {
      started.resolve();
      await release.promise;
      return { content: [{ type: "text", text: "hook released" }], details: {} };
    }
  };
}

interface SteeredRun {
  /** User turns seen by each provider call, in call order. */
  readonly calls: readonly (readonly string[])[];
  readonly events: readonly ExecutionEvent[];
  readonly retries: readonly RetryAttemptInfo[];
  readonly steeredWhileBlocked: boolean;
  readonly fallbackFired: boolean;
}

/**
 * Drive one execution that steers while `blocking_hook` holds attempt 1 open,
 * against a scripted provider. `script` is handed a recorder that captures the
 * user turns of the call each step is answering.
 */
async function runSteeredExecution(
  script: (record: (context: Context) => void) => FauxResponseStep[]
): Promise<SteeredRun> {
  const hookStarted = deferred();
  const releaseHook = deferred();
  const fallbackReached = deferred();
  let hookReleased = false;
  let fallbackFired = false;
  const releaseHookOnce = (): void => {
    if (hookReleased) return;
    hookReleased = true;
    releaseHook.resolve();
  };

  const calls: string[][] = [];
  const faux = fauxProvider({
    provider: "steer-retry-faux",
    models: [{ id: "steer-retry-model", name: "Steer retry model" }]
  });
  faux.setResponses(
    script((context) => {
      calls.push(userTurnsOf(context));
    })
  );
  const models = createModels();
  models.setProvider(faux.provider);

  const retries: RetryAttemptInfo[] = [];
  const executor = new PiAgentExecutor({
    providerId: "steer-retry-faux",
    modelId: "steer-retry-model",
    models,
    tools: [blockingHook(hookStarted, releaseHook)],
    retry: {
      maxAttempts: 3,
      random: () => 0,
      // No wall clock: this test is about the attempt boundary, not the
      // backoff arithmetic, which `provider-retry` pins on its own.
      sleep: async () => undefined,
      onRetry: (info) => retries.push(info)
    }
  });

  const events: ExecutionEvent[] = [];
  let steeredWhileBlocked = false;
  const fallback = setTimeout(() => {
    fallbackFired = true;
    fallbackReached.resolve();
    releaseHookOnce();
  }, 5_000);

  try {
    for await (const event of executor.execute(
      {
        runId: createRunId(),
        taskId: createTaskId(),
        agentInstanceId: createAgentInstanceId(),
        prompt: PROMPT,
        workingDirectory: "."
      },
      new AbortController().signal
    )) {
      events.push(event);
      if (event.type !== "TOOL_STARTED" || steeredWhileBlocked) continue;
      await Promise.race([hookStarted.promise, fallbackReached.promise]);
      if (fallbackFired) break;
      steeredWhileBlocked = true;
      executor.steerText(STEER_TEXT);
      releaseHookOnce();
    }
  } finally {
    clearTimeout(fallback);
    releaseHookOnce();
  }

  return { calls, events, retries, steeredWhileBlocked, fallbackFired };
}

function callsCarryingSteer(
  calls: readonly (readonly string[])[]
): readonly (readonly string[])[] {
  return calls.filter((turns) => turns.some((turn) => turn.includes(STEER_TEXT)));
}

function terminalOutcome(events: readonly ExecutionEvent[]): string | undefined {
  for (const event of events) {
    if (event.type === "EXECUTION_FINISHED") return event.outcome;
  }
  return undefined;
}

test("a steer accepted before a retried provider failure reaches the retry's context", async () => {
  const run = await runSteeredExecution((record) => [
    (context) => {
      record(context);
      return fauxAssistantMessage([fauxText("starting the rewrite"), fauxToolCall("blocking_hook", {})], {
        stopReason: "toolUse"
      });
    },
    (context) => {
      record(context);
      throw new Error(RATE_LIMIT);
    },
    (context) => {
      record(context);
      return fauxAssistantMessage("restarted after the rate limit");
    },
    (context) => {
      record(context);
      return fauxAssistantMessage("acknowledged the change of direction");
    }
  ]);

  assert.equal(run.fallbackFired, false, "the steer should have released the hook without the fallback");
  assert.equal(run.steeredWhileBlocked, true, "expected to steer while blocking_hook held the turn");
  assert.equal(run.retries.length, 1, "expected exactly one retry");
  assert.equal(run.retries[0]?.failure.kind, "rate-limit");
  assert.equal(terminalOutcome(run.events), "SUCCESS");

  // Attempt 1: the steer landed as a second user turn, and then the call
  // carrying it failed and took that whole context with it.
  assert.equal(
    run.calls[0]?.length,
    1,
    `attempt 1's opening call should carry the prompt alone, got ${JSON.stringify(run.calls[0])}`
  );
  assert.equal(run.calls[1]?.length, 2);
  assert.ok((run.calls[1]?.[1] as string).includes(STEER_TEXT));

  // The regression itself: the surviving attempt sees the steer, once, so the
  // run's `STEER_INJECTED` record describes something a live model was told.
  assert.equal(
    callsCarryingSteer(run.calls.slice(2)).length,
    1,
    `the surviving attempt must see the steer exactly once, got ${JSON.stringify(run.calls.slice(2))}`
  );

  // Attempt 2 still opens from the original prompt: the steer is queued into
  // the new kernel and polled after its first turn, not folded into the
  // retry's opening request.
  assert.deepEqual(
    run.calls[2],
    run.calls[0],
    `the retry's first call must repeat the original prompt alone, got ${JSON.stringify(run.calls[2])}`
  );
  const surviving = run.calls[3] as string[];
  assert.equal(surviving.length, 2, `expected prompt plus steer, got ${JSON.stringify(surviving)}`);
  assert.match(surviving[0] as string, /Call blocking_hook/);

  // Four provider calls: two in the discarded attempt, two in the surviving
  // one. A fifth would mean the re-delivery kept re-queueing itself.
  assert.equal(run.calls.length, 4);
});

test("a steer survives more than one retry and is re-delivered exactly once per attempt", async () => {
  const run = await runSteeredExecution((record) => [
    (context) => {
      record(context);
      return fauxAssistantMessage([fauxText("starting the rewrite"), fauxToolCall("blocking_hook", {})], {
        stopReason: "toolUse"
      });
    },
    (context) => {
      record(context);
      throw new Error(RATE_LIMIT);
    },
    // Attempt 2 dies on its opening call, before it can consume the steer the
    // executor re-delivered into it.
    (context) => {
      record(context);
      throw new Error(RATE_LIMIT);
    },
    (context) => {
      record(context);
      return fauxAssistantMessage("restarted after the second rate limit");
    },
    (context) => {
      record(context);
      return fauxAssistantMessage("acknowledged the change of direction");
    }
  ]);

  assert.equal(run.fallbackFired, false);
  assert.equal(run.retries.length, 2);
  assert.equal(terminalOutcome(run.events), "SUCCESS");

  // One surviving call carries the steer, across two discarded kernels.
  assert.equal(
    callsCarryingSteer(run.calls.slice(2)).length,
    1,
    `the third attempt must see the steer exactly once, got ${JSON.stringify(run.calls.slice(2))}`
  );

  // Attempt 2's one call saw the prompt alone and the steer handed to it died
  // with it, so attempt 3 has to be handed the same text again.
  assert.deepEqual(run.calls[2], run.calls[0]);
  assert.deepEqual(run.calls[3], run.calls[0]);

  const surviving = run.calls[4] as string[];
  assert.equal(surviving.length, 2, `expected prompt plus one steer, got ${JSON.stringify(surviving)}`);
  assert.equal(run.calls.length, 5);
});
