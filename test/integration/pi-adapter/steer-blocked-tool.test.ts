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
  type Context
} from "@earendil-works/pi-ai";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { createAgentInstanceId, createRunId, createTaskId } from "../../../src/domain/ids.js";
import { PiAgentExecutor } from "../../../src/pi-adapter/pi-executor.js";

const STEER_TEXT = "Switch to the migration path and skip the rewrite.";

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

test("steerText reaches the live agent while a tool blocks the run, and only then", async () => {
  const hookStarted = deferred();
  const releaseHook = deferred();
  const fallbackReached = deferred();
  let hookReleased = false;
  let fallbackFired = false;

  const releaseHookOnce = () => {
    if (hookReleased) return;
    hookReleased = true;
    releaseHook.resolve();
  };

  const hookParameters = Type.Object({});
  const blockingHook: AgentTool<typeof hookParameters, Record<string, never>> = {
    name: "blocking_hook",
    label: "Blocking hook",
    description: "Hold the turn open until the test has steered the run.",
    parameters: hookParameters,
    execute: async () => {
      hookStarted.resolve();
      await releaseHook.promise;
      return { content: [{ type: "text", text: "hook released" }], details: {} };
    }
  };

  const faux = fauxProvider({
    provider: "steer-faux",
    models: [{ id: "steer-model", name: "Steer model" }]
  });
  let secondCallUserTurns: string[] | undefined;
  faux.setResponses([
    fauxAssistantMessage([fauxText("starting the rewrite"), fauxToolCall("blocking_hook", {})], {
      stopReason: "toolUse"
    }),
    (context) => {
      secondCallUserTurns = userTurnsOf(context);
      return fauxAssistantMessage("acknowledged the change of direction");
    }
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  const executor = new PiAgentExecutor({
    providerId: "steer-faux",
    modelId: "steer-model",
    models,
    tools: [blockingHook]
  });

  assert.throws(() => executor.steerText(STEER_TEXT), DomainValidationError);
  assert.throws(() => executor.steerText(STEER_TEXT), /no agent run is in flight/);

  let steeredWhileBlocked = false;
  const fallback = setTimeout(() => {
    fallbackFired = true;
    fallbackReached.resolve();
    releaseHookOnce();
  }, 2_000);

  try {
    for await (const event of executor.execute(
      {
        runId: createRunId(),
        taskId: createTaskId(),
        agentInstanceId: createAgentInstanceId(),
        prompt: "Call blocking_hook, then report.",
        workingDirectory: "."
      },
      new AbortController().signal
    )) {
      if (event.type !== "TOOL_STARTED" || steeredWhileBlocked) continue;
      await Promise.race([hookStarted.promise, fallbackReached.promise]);
      if (fallbackFired) break;
      steeredWhileBlocked = true;
      assert.throws(() => executor.steerText("   "), /non-empty/);
      executor.steerText(STEER_TEXT);
      releaseHookOnce();
    }
  } finally {
    clearTimeout(fallback);
    releaseHookOnce();
  }

  assert.equal(fallbackFired, false, "the steer should have released the hook without the fallback");
  assert.equal(steeredWhileBlocked, true, "expected to steer while blocking_hook held the turn");
  assert.ok(secondCallUserTurns !== undefined, "expected the agent to make a second provider call");
  // The original prompt plus the steer, in that order: the steer is a new user
  // turn appended after the tool result, not an edit of the opening prompt.
  assert.equal(secondCallUserTurns.length, 2);
  assert.match(secondCallUserTurns[0] as string, /Call blocking_hook/);
  assert.ok(
    (secondCallUserTurns[1] as string).includes(STEER_TEXT),
    `steered text must be the second user turn, got ${secondCallUserTurns[1] as string}`
  );

  assert.throws(() => executor.steerText(STEER_TEXT), /no agent run is in flight/);
});

test("steerText refuses to guess when the shared executor has several runs in flight", async () => {
  const releaseHooks = deferred();
  const bothStarted = deferred();
  let startedCount = 0;

  const hookParameters = Type.Object({});
  const blockingHook: AgentTool<typeof hookParameters, Record<string, never>> = {
    name: "blocking_hook",
    label: "Blocking hook",
    description: "Hold both concurrent turns open at once.",
    parameters: hookParameters,
    execute: async () => {
      startedCount += 1;
      if (startedCount === 2) bothStarted.resolve();
      await releaseHooks.promise;
      return { content: [{ type: "text", text: "hook released" }], details: {} };
    }
  };

  const faux = fauxProvider({
    provider: "steer-many-faux",
    models: [{ id: "steer-many-model", name: "Steer many model" }]
  });
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("blocking_hook", {})], { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxToolCall("blocking_hook", {})], { stopReason: "toolUse" }),
    fauxAssistantMessage("first done"),
    fauxAssistantMessage("second done")
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  const executor = new PiAgentExecutor({
    providerId: "steer-many-faux",
    modelId: "steer-many-model",
    models,
    tools: [blockingHook]
  });

  const drain = async (): Promise<void> => {
    for await (const _event of executor.execute(
      {
        runId: createRunId(),
        taskId: createTaskId(),
        agentInstanceId: createAgentInstanceId(),
        prompt: "Call blocking_hook.",
        workingDirectory: "."
      },
      new AbortController().signal
    )) {
      // Only the concurrency matters here, not the events.
    }
  };

  const runs = Promise.all([drain(), drain()]);
  const timeout = setTimeout(() => releaseHooks.resolve(), 5_000);
  try {
    await bothStarted.promise;
    assert.throws(() => executor.steerText(STEER_TEXT), /2 agent runs are in flight/);
  } finally {
    releaseHooks.resolve();
    clearTimeout(timeout);
    await runs;
  }
});
