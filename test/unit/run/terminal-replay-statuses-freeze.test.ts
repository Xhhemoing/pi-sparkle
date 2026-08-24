import assert from "node:assert/strict";
import { test } from "node:test";

import { RUN_STATUSES, type RunStatus } from "../../../src/domain/status.js";
import { EVENT_TYPES, type M0EventType } from "../../../src/run/events.js";
import { TERMINAL_REPLAY_STATUSES } from "../../../src/run/replay.js";

type RunUnblockedEventType = Extract<M0EventType, `RUN_UNBLOCKED${string}`>;
type RunUnblockedStatusOverlap = Extract<RunUnblockedEventType, RunStatus>;
type RunUnblockedEventsAreNotStatuses = [RunUnblockedStatusOverlap] extends [never] ? true : false;

test("terminal replay statuses stay exactly COMPLETED, FAILED and BLOCKED", () => {
  assert.deepEqual([...TERMINAL_REPLAY_STATUSES].toSorted(), ["BLOCKED", "COMPLETED", "FAILED"]);
});

test("every RUN_UNBLOCKED event stays outside RunStatus and the terminal replay set", () => {
  const runUnblockedEvents = EVENT_TYPES.filter((type) => type.startsWith("RUN_UNBLOCKED"));
  const runStatuses: ReadonlySet<string> = new Set(RUN_STATUSES);
  const terminalReplayStatuses: ReadonlySet<string> = TERMINAL_REPLAY_STATUSES;
  const typesAreDisjoint: RunUnblockedEventsAreNotStatuses = true;

  assert.equal(typesAreDisjoint, true);
  assert.ok(runUnblockedEvents.includes("RUN_UNBLOCKED"));
  for (const eventType of runUnblockedEvents) {
    assert.equal(runStatuses.has(eventType), false, `${eventType} must remain an event, not a RunStatus`);
    assert.equal(
      terminalReplayStatuses.has(eventType),
      false,
      `${eventType} must remain outside TERMINAL_REPLAY_STATUSES`
    );
  }
});
