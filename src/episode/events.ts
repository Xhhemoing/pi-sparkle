import type { EpisodeId, RunId } from "../domain/ids.js";
import type { IsoTimestamp } from "../domain/timestamp.js";
import type { ProjectEpisode, EpisodeStatus } from "../domain/episode.js";

export type EpisodeEventType =
  | "EPISODE_OPENED"
  | "RUN_ATTACHED"
  | "EPISODE_WAITING"
  | "EPISODE_CLOSED";

export interface EpisodeOpenedEvent {
  readonly type: "EPISODE_OPENED";
  readonly episode: ProjectEpisode;
  readonly occurredAt: IsoTimestamp;
}

export interface RunAttachedEvent {
  readonly type: "RUN_ATTACHED";
  readonly episodeId: EpisodeId;
  readonly runId: RunId;
  readonly attachedAt: IsoTimestamp;
}

export interface EpisodeWaitingEvent {
  readonly type: "EPISODE_WAITING";
  readonly episodeId: EpisodeId;
  readonly reason: string;
  readonly requiredEvidence: readonly string[];
  readonly occurredAt: IsoTimestamp;
}

export interface EpisodeClosedEvent {
  readonly type: "EPISODE_CLOSED";
  readonly episodeId: EpisodeId;
  readonly status: EpisodeStatus;
  readonly closedAt: IsoTimestamp;
  readonly outcomeId?: string | undefined;
}

export type EpisodeEvent =
  | EpisodeOpenedEvent
  | RunAttachedEvent
  | EpisodeWaitingEvent
  | EpisodeClosedEvent;
