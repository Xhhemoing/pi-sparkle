import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { translatePiEvent } from "../../../src/pi-adapter/pi-executor.js";

describe("translatePiEvent thinking redaction", () => {
  it("maps thinking deltas to byte counts without exposing raw thinking", () => {
    const rawThinking = "private reasoning must not cross the adapter boundary";
    const event = {
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        contentIndex: 0,
        delta: rawThinking,
        partial: {}
      }
    } as never;

    const translated = translatePiEvent(event);

    assert.ok(translated);
    assert.equal(translated.type, "THINKING_DELTA");
    assert.ok("bytes" in translated && translated.bytes > 0);
    assert.equal(JSON.stringify(translated).includes(rawThinking), false);
  });
});
