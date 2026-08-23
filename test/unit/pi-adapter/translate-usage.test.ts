import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { translatePiEvent } from "../../../src/pi-adapter/pi-executor.js";

/**
 * Regression (2026-08-22 weak-area data collection): turn_end carries the
 * assistant message's usage; without extracting it, cost telemetry records
 * tokensIn/tokensOut as undefined and no cost-quality gate can ever run.
 */

describe("translatePiEvent usage extraction", () => {
  it("maps assistant turn_end usage onto TURN_FINISHED", () => {
    const event = {
      type: "turn_end",
      message: {
        role: "assistant",
        content: [],
        usage: { input: 92, output: 31, cacheRead: 0, cacheWrite: 0, totalTokens: 123 }
      },
      toolResults: []
    } as never;
    const translated = translatePiEvent(event);
    assert.ok(translated);
    assert.equal(translated.type, "TURN_FINISHED");
    assert.deepEqual(translated.usage, { inputTokens: 92, outputTokens: 31 });
  });

  it("omits usage when the provider did not report it", () => {
    const event = {
      type: "turn_end",
      message: { role: "assistant", content: [], usage: {} },
      toolResults: []
    } as never;
    const translated = translatePiEvent(event);
    assert.ok(translated);
    assert.equal(
      translated.type === "TURN_FINISHED" ? translated.usage : undefined,
      undefined
    );
  });

  it("ignores non-assistant messages", () => {
    const event = {
      type: "turn_end",
      message: { role: "user", content: [] },
      toolResults: []
    } as never;
    const translated = translatePiEvent(event);
    assert.ok(translated);
    assert.equal(
      translated.type === "TURN_FINISHED" ? translated.usage : undefined,
      undefined
    );
  });
});
