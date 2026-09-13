import type { IsoTimestamp } from "../domain/timestamp.js";
import type { Event } from "./events.js";
import { CheckpointStore } from "./checkpoint-store.js";
import { EventLogOffsetError, EventStore } from "./event-store.js";
import {
  applyReplayEvents,
  createReplayCursor,
  materializeCheckpoint,
  snapshotReplay,
  validateCheckpoint,
  type ReplayCursor,
  type RunCheckpoint
} from "./replay.js";

export interface LoadReplayForPersistInput {
  readonly eventStore: EventStore;
  readonly cursor?: ReplayCursor;
  readonly eventLogByteOffset?: number;
}

export interface LoadedReplayForPersist {
  readonly cursor: ReplayCursor;
  readonly eventLogByteOffset: number;
  readonly replayMode: "incremental" | "full";
  readonly appliedEvents: readonly Event[];
}

export interface PersistRunCheckpointInput extends LoadReplayForPersistInput {
  readonly checkpointStore: CheckpointStore;
  readonly now: () => IsoTimestamp;
}

export interface PersistRunCheckpointResult extends LoadedReplayForPersist {
  readonly checkpoint: RunCheckpoint;
}

/**
 * Incremental replay for a checkpoint persist. A live cursor + byte offset
 * reads only the tail; unsafe offsets fall back to a full read. A corrupt
 * middle still fails closed.
 */
export async function loadReplayForPersist(
  input: LoadReplayForPersistInput
): Promise<LoadedReplayForPersist> {
  let cursor = input.cursor;
  let offset = input.eventLogByteOffset;
  let mode: "incremental" | "full" = "full";
  let appliedEvents: readonly Event[] = [];

  if (cursor !== undefined && offset !== undefined && offset > 0) {
    try {
      const tail = await input.eventStore.readFromOffset(offset);
      if (tail.mode === "incremental") {
        applyReplayEvents(cursor, tail.events);
        offset = tail.completeByteLength;
        mode = "incremental";
        appliedEvents = tail.events;
      }
    } catch (error) {
      if (!(error instanceof EventLogOffsetError)) throw error;
      mode = "full";
    }
  }

  if (mode === "full") {
    const read = await input.eventStore.readAll();
    cursor = createReplayCursor();
    applyReplayEvents(cursor, read.events);
    offset = read.completeByteLength;
    appliedEvents = read.events;
  }

  if (cursor === undefined || offset === undefined) {
    throw new Error("loadReplayForPersist: cursor/offset missing after replay");
  }

  return {
    cursor,
    eventLogByteOffset: offset,
    replayMode: mode,
    appliedEvents
  };
}

export async function writeRunCheckpoint(input: {
  readonly checkpointStore: CheckpointStore;
  readonly checkpoint: RunCheckpoint;
}): Promise<RunCheckpoint> {
  const checkpoint = validateCheckpoint(input.checkpoint);
  await input.checkpointStore.write(checkpoint);
  return checkpoint;
}

/**
 * Checkpoint persist duty, extracted from the flowchart loop.
 *
 * The loop owns scheduling and supervisor lifecycle. This module owns
 * incremental replay (when a live cursor + byte offset are safe) and the
 * write.
 */
export async function persistRunCheckpoint(
  input: PersistRunCheckpointInput
): Promise<PersistRunCheckpointResult> {
  const loaded = await loadReplayForPersist(input);
  const checkpoint = await writeRunCheckpoint({
    checkpointStore: input.checkpointStore,
    checkpoint: validateCheckpoint(
      materializeCheckpoint(snapshotReplay(loaded.cursor), input.now())
    )
  });
  return { ...loaded, checkpoint };
}
