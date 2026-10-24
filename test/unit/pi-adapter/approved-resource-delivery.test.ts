import assert from "node:assert/strict";
import { test } from "node:test";
import { Type, createModels, fauxProvider, fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt, type TranscriptContext } from "@earendil-works/pi-ai";
import { createControlledCodingSession } from "../../../src/pi-adapter/coding-session.js";
import { prepareApprovedResources } from "../../../src/pi-adapter/approved-resources.js";

function latch() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

test("actual steering retains one approved resource message without reinjection", { timeout: 10000 }, async () => {
  const entered = latch(), release = latch();
  const contexts: TranscriptContext[] = [];
  const faux = fauxProvider({ tokensPerSecond: 1_000_000, provider: "approved-steer", models: [{ id: "synthetic" }] });
  faux.setResponses([fauxAssistantMessage(fauxToolCall("read", {})), fauxAssistantMessage("finished")]);
  const model = faux.getModel(), models = createModels(); models.setProvider(faux.provider);
  const payload = prepareApprovedResources({ skills: [{ name: "approved", description: "Owned content", body: "APPROVED_STEER_BODY" }] });
  const session = await createControlledCodingSession({ cwd: process.cwd(), model, thinkingLevel: "off", systemPrompt: "EXACT_HOST",
    approvedResourcePayload: payload,
    tools: [{ name: "read", label: "Owned read", description: "Held read", parameters: Type.Object({}),
      execute: async () => { entered.release(); await release.promise; return { content: [{ type: "text", text: "owned" }], details: {} }; } }],
    streamFn: (selected, context, options) => {
      contexts.push(context); return models.streamSimple(selected, context, options);
    }
  });
  let running: Promise<void> | undefined;
  try {
    running = session.prompt("Synthetic resource steering");
    await entered.promise;
    session.steerText("APPROVED_STEER_ONCE"); release.release();
    await running; await session.waitForIdle();
    assert.equal(faux.state.callCount, 2);
    for (const context of contexts) {
      assert.equal(getCurrentSystemPrompt(context.messages), "EXACT_HOST");
      assert.equal(JSON.stringify(context.messages).match(/APPROVED_STEER_BODY/g)?.length, 1);
    }
    assert.match(JSON.stringify(contexts.at(-1)!.messages), /APPROVED_STEER_ONCE/);
  } finally { release.release(); await running; session.dispose(); }
});
