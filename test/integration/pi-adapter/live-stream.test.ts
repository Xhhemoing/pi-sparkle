import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  Type,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall
} from "@earendil-works/pi-ai";
import { createAgentInstanceId, createRunId, createTaskId } from "../../../src/domain/ids.js";
import { PiAgentExecutor } from "../../../src/pi-adapter/pi-executor.js";

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

test("PiAgentExecutor exposes a text delta before an in-flight tool lets execute finish", async () => {
  const hookStarted = deferred();
  const releaseHook = deferred();
  const fallbackReached = deferred();
  let hookInFlight = false;
  let hookReleased = false;
  let fallbackReleasedHook = false;

  const releaseHookOnce = () => {
    if (hookReleased) return;
    hookReleased = true;
    releaseHook.resolve();
  };

  const hookParameters = Type.Object({});
  const blockingHook: AgentTool<typeof hookParameters, Record<string, never>> = {
    name: "blocking_hook",
    label: "Blocking hook",
    description: "Wait until the stream consumer observes the leading text delta.",
    parameters: hookParameters,
    execute: async () => {
      hookInFlight = true;
      hookStarted.resolve();
      await releaseHook.promise;
      hookInFlight = false;
      return {
        content: [{ type: "text", text: "hook released" }],
        details: {}
      };
    }
  };

  const faux = fauxProvider({
    provider: "live-stream-faux",
    models: [{ id: "live-stream-model", name: "Live stream model" }]
  });
  faux.setResponses([
    fauxAssistantMessage(
      [fauxText("visible before hook"), fauxToolCall("blocking_hook", {})],
      { stopReason: "toolUse" }
    ),
    fauxAssistantMessage("finished after hook")
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  const executor = new PiAgentExecutor({
    providerId: "live-stream-faux",
    modelId: "live-stream-model",
    models,
    tools: [blockingHook]
  });

  let firstTextDeltaAt: number | undefined;
  let executeCompletedAt: number | undefined;
  let hookWasInFlightAtFirstDelta = false;
  let textDeltaCount = 0;
  const fallback = setTimeout(() => {
    fallbackReleasedHook = true;
    fallbackReached.resolve();
    releaseHookOnce();
  }, 500);

  try {
    for await (const event of executor.execute(
      {
        runId: createRunId(),
        taskId: createTaskId(),
        agentInstanceId: createAgentInstanceId(),
        prompt: "Call blocking_hook after emitting leading text.",
        workingDirectory: "."
      },
      new AbortController().signal
    )) {
      if (event.type !== "TEXT_DELTA") continue;
      textDeltaCount += 1;
      if (firstTextDeltaAt !== undefined) continue;

      await Promise.race([hookStarted.promise, fallbackReached.promise]);
      firstTextDeltaAt = performance.now();
      hookWasInFlightAtFirstDelta = hookInFlight;
      if (hookWasInFlightAtFirstDelta) releaseHookOnce();
    }
    executeCompletedAt = performance.now();
  } finally {
    clearTimeout(fallback);
    releaseHookOnce();
  }

  assert.ok(textDeltaCount >= 1, "expected at least one TEXT_DELTA from the faux provider");
  assert.ok(firstTextDeltaAt !== undefined, "expected to timestamp the first TEXT_DELTA");
  assert.ok(executeCompletedAt !== undefined, "expected execute() to complete");
  assert.ok(firstTextDeltaAt <= executeCompletedAt, "the first TEXT_DELTA timestamp must precede completion");
  assert.equal(
    hookWasInFlightAtFirstDelta,
    true,
    "TEXT_DELTA must be delivered while the custom tool is still in flight"
  );
  assert.equal(fallbackReleasedHook, false, "live delivery should release the hook without the fallback");
  assert.ok(firstTextDeltaAt < executeCompletedAt, "execute() must remain active after the first TEXT_DELTA");
});
