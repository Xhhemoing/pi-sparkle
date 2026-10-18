import assert from "node:assert/strict";
import { test } from "node:test";
import { createRunId } from "../../../src/domain/ids.js";
import { ConversationFocus } from "../../../src/conversation/focus.js";

const main = { projectRef: "plugin", taskRef: "contributions" };
const side = { projectRef: "plugin", taskRef: "daylight" };
const known = [{ projectRef: "plugin" }, main, side];

test("focus snapshots are immutable and a temporary task preserves one mainline", () => {
  const focus = new ConversationFocus(known);
  const first = focus.select(main, focus.snapshot().token, "message:main");
  const temporary = focus.select(side, first.token, "message:side", true);
  assert.deepEqual(temporary.current, side);
  assert.deepEqual(temporary.suspended, main);
  assert.ok(Object.isFrozen(temporary));
  assert.ok(Object.isFrozen(temporary.current));
  assert.ok(Object.isFrozen(temporary.token));
  const restored = focus.restore(temporary.token, "message:restore");
  assert.deepEqual(restored.current, main);
  assert.equal(restored.suspended, undefined);
  assert.equal(restored.token.revision, first.token.revision + 2);
});

test("focus refuses unknown targets, stale revisions and another session's token", () => {
  const focus = new ConversationFocus(known);
  const original = focus.snapshot();
  assert.throws(() => focus.select({ projectRef: "unknown" }, original.token, "message:bad"), /unknown/);
  const selected = focus.select(main, original.token, "message:main");
  assert.throws(() => focus.select(side, original.token, "message:stale"), /stale/);
  const other = new ConversationFocus(known);
  assert.throws(() => focus.select(side, other.snapshot().token, "message:foreign"), /stale/);
  assert.deepEqual(focus.snapshot(), selected);
});

test("late run references cannot overwrite a switched focus or its suspended pointer", () => {
  const focus = new ConversationFocus(known);
  const first = focus.select(main, focus.snapshot().token, "message:main");
  const sideFocus = focus.select(side, first.token, "message:side", true);
  assert.equal(focus.recordRun(first.token, createRunId(), "message:main-result"), false);
  assert.deepEqual(focus.snapshot(), sideFocus);
  const runId = createRunId();
  assert.equal(focus.recordRun(sideFocus.token, runId, "message:side-result"), true);
  assert.deepEqual(focus.snapshot().current, { ...side, runId });
  const restored = focus.restore(focus.snapshot().token, "message:restore");
  assert.deepEqual(restored.current, main);
});

test("focus rejects authority fields and accessors without evaluating them", () => {
  const focus = new ConversationFocus(known);
  let reads = 0;
  const accessor = Object.defineProperty({ projectRef: "plugin" }, "taskRef", { get() { reads++; return "daylight"; } });
  assert.throws(() => focus.select(accessor, focus.snapshot().token, "message:accessor"), /ordinary|accessor/);
  assert.equal(reads, 0);
  assert.throws(() => focus.select({ ...main, authority: "host" } as never, focus.snapshot().token, "message:authority"), /unsupported/);
  assert.throws(() => focus.restore(focus.snapshot().token, "message:restore"), /suspended/);
});
