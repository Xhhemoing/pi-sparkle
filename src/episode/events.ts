import { DomainValidationError } from "../domain/errors.js";
import { isEpisodeId, isRunId, type EpisodeId, type RunId } from "../domain/ids.js";
import { isRecord } from "../domain/record.js";
import { isIsoTimestamp, type IsoTimestamp } from "../domain/timestamp.js";
import { isEpisodeStatus, validateEpisode, type ProjectEpisode, type EpisodeStatus } from "../domain/episode.js";

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

const TYPE_LABEL_LIMIT = 40;

function typeLabel(value: unknown): string {
  const raw = typeof value === "string" ? value : String(value);
  return raw.length > TYPE_LABEL_LIMIT ? `${raw.slice(0, TYPE_LABEL_LIMIT)}…` : raw;
}

function requireTimestamp(value: unknown, field: string): IsoTimestamp {
  if (!isIsoTimestamp(value)) {
    throw new DomainValidationError(`EpisodeEvent.${field} must be a valid IsoTimestamp`);
  }
  return value;
}

function requireEpisodeId(value: unknown): EpisodeId {
  if (!isEpisodeId(value)) {
    throw new DomainValidationError("EpisodeEvent.episodeId must be a valid EpisodeId");
  }
  return value;
}

function requireRunId(value: unknown): RunId {
  if (!isRunId(value)) {
    throw new DomainValidationError("EpisodeEvent.runId must be a valid RunId");
  }
  return value;
}

/**
 * Fail-closed decoder for a persisted episode event.
 * Only the four known shapes survive: an unknown `type` or a malformed required
 * field is rejected rather than cast, so nothing that reaches a reader (or
 * `episode events --json`) can be a row the writer never could have produced.
 */
export function validateEpisodeEvent(value: unknown): EpisodeEvent {
  if (!isRecord(value)) {
    throw new DomainValidationError("EpisodeEvent must be an object");
  }
  const type: unknown = value.type;
  switch (type) {
    case "EPISODE_OPENED":
      return {
        type,
        episode: validateEpisode(value.episode),
        occurredAt: requireTimestamp(value.occurredAt, "occurredAt")
      };
    case "RUN_ATTACHED":
      return {
        type,
        episodeId: requireEpisodeId(value.episodeId),
        runId: requireRunId(value.runId),
        attachedAt: requireTimestamp(value.attachedAt, "attachedAt")
      };
    case "EPISODE_WAITING": {
      const reason: unknown = value.reason;
      if (typeof reason !== "string" || reason.trim().length === 0) {
        throw new DomainValidationError("EpisodeEvent.reason must be a non-empty string");
      }
      const requiredEvidence: unknown = value.requiredEvidence;
      if (!Array.isArray(requiredEvidence) || requiredEvidence.some((entry) => typeof entry !== "string")) {
        throw new DomainValidationError("EpisodeEvent.requiredEvidence must be an array of strings");
      }
      return {
        type,
        episodeId: requireEpisodeId(value.episodeId),
        reason,
        requiredEvidence: requiredEvidence as readonly string[],
        occurredAt: requireTimestamp(value.occurredAt, "occurredAt")
      };
    }
    case "EPISODE_CLOSED": {
      const status: unknown = value.status;
      if (!isEpisodeStatus(status)) {
        throw new DomainValidationError("EpisodeEvent.status must be a valid EpisodeStatus");
      }
      const outcomeId: unknown = value.outcomeId;
      if (outcomeId !== undefined && typeof outcomeId !== "string") {
        throw new DomainValidationError("EpisodeEvent.outcomeId must be a string when present");
      }
      return {
        type,
        episodeId: requireEpisodeId(value.episodeId),
        status,
        closedAt: requireTimestamp(value.closedAt, "closedAt"),
        ...(outcomeId !== undefined ? { outcomeId } : {})
      };
    }
    default:
      throw new DomainValidationError(`Unknown EpisodeEvent.type: ${typeLabel(type)}`);
  }
}
