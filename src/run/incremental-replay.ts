import type { EventId } from "../domain/ids.js";
import {
  applyReplayEvents,
  createReplayCursor,
  replayRun,
  snapshotReplay,
  type ReconstructedRun,
  type ReplayCursor
} from "./replay.js";
import type { Event } from "./events.js";

export type IncrementalReplayReason = "safe" | "no-checkpoint-offset" | "offset-event-missing";

export interface IncrementalReplayResult {
  readonly mode: "incremental" | "full";
  readonly reason: IncrementalReplayReason;
  readonly state: ReconstructedRun;
  readonly eventsSkipped: number;
  readonly eventsApplied: number;
}

/**
 * Resume replay at `lastEventId` when that id is on the log.
 *
 * Incremental mode builds a cursor through the prefix (the durable
 * checkpoint's last published event), then applies only the tail — the same
 * split a live persist uses when it already holds the cursor. Missing or
 * unknown offsets fall back to a full {@link replayRun} so recovery never
 * invents a split point.
 */
export function replayFromCheckpointOffset(
  events: readonly Event[],
  lastEventId: EventId | undefined
): IncrementalReplayResult {
  if (lastEventId === undefined) {
    return {
      mode: "full",
      reason: "no-checkpoint-offset",
      state: replayRun(events),
      eventsSkipped: 0,
      eventsApplied: events.length
    };
  }
  const at = events.findIndex((event) => event.id === lastEventId);
  if (at < 0) {
    return {
      mode: "full",
      reason: "offset-event-missing",
      state: replayRun(events),
      eventsSkipped: 0,
      eventsApplied: events.length
    };
  }
  const cursor = createReplayCursor();
  applyReplayEvents(cursor, events.slice(0, at + 1));
  const tail = events.slice(at + 1);
  applyReplayEvents(cursor, tail);
  return {
    mode: "incremental",
    reason: "safe",
    state: snapshotReplay(cursor),
    eventsSkipped: at + 1,
    eventsApplied: tail.length
  };
}

/**
 * Continue a live cursor through `tail` events. The cursor must already
 * describe the prefix that `tail` follows; callers that cannot prove that
 * must use {@link replayFromCheckpointOffset} instead.
 */
export function continueReplay(cursor: ReplayCursor, tail: readonly Event[]): ReconstructedRun {
  applyReplayEvents(cursor, tail);
  return snapshotReplay(cursor);
}
