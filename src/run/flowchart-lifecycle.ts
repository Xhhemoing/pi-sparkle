import { DomainValidationError } from "../domain/errors.js";
import type { RunId } from "../domain/ids.js";
import type { Event } from "./events.js";
import {
  replayRun,
  validateCheckpoint,
  type ReconstructedRun,
  type RunCheckpoint
} from "./replay.js";

type FlowchartReplay = ReconstructedRun & Required<Pick<ReconstructedRun, "run" | "project">>;
type FlowchartCheckpoint = RunCheckpoint & Required<Pick<RunCheckpoint, "flowchart">>;

/** Require the durable log inputs shared by resume and control restoration. */
export function requireFlowchartReplay(runId: RunId, events: readonly Event[]): FlowchartReplay {
  if (events.length === 0) {
    throw new DomainValidationError(`Run ${runId} not found`);
  }
  const replayed = replayRun(events);
  if (replayed.run === undefined) {
    throw new DomainValidationError(`Run ${runId} has no RUN_CREATED event`);
  }
  if (replayed.project === undefined) {
    throw new DomainValidationError(`Run ${runId} has no PROJECT_DISCOVERED event`);
  }
  // Both optional fields were checked above; keep the replay object unchanged.
  return replayed as FlowchartReplay;
}

/** Validate the stored schema before requiring its flowchart-specific snapshot. */
export function requireFlowchartCheckpoint(runId: RunId, raw: unknown): FlowchartCheckpoint {
  if (raw === undefined) {
    throw new DomainValidationError(
      `Flowchart run ${runId} has no durable checkpoint; refusing to invent state`
    );
  }
  const checkpoint = validateCheckpoint(raw);
  if (checkpoint.flowchart === undefined) {
    throw new DomainValidationError(`Flowchart run ${runId} checkpoint is missing flowchart snapshot`);
  }
  return checkpoint as FlowchartCheckpoint;
}
