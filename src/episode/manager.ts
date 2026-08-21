import { nowIso } from "../domain/timestamp.js";
import type { EpisodeId, ProjectId, RunId } from "../domain/ids.js";
import type { ProjectEpisode, AcceptanceCriterion, EpisodeStatus } from "../domain/episode.js";
import {
  type EpisodeEvent,
  type EpisodeOpenedEvent,
  type RunAttachedEvent,
  type EpisodeWaitingEvent,
  type EpisodeClosedEvent,
} from "./events.js";

export interface OpenEpisodeInput {
  readonly id: EpisodeId;
  readonly projectId: ProjectId;
  readonly objective: string;
  readonly contractVersion: number;
  readonly acceptance: readonly AcceptanceCriterion[];
}

export interface EpisodeState {
  readonly episode: ProjectEpisode | null;
  readonly events: readonly EpisodeEvent[];
  /** Sticky: true once the log contained an event that had to be rejected. */
  readonly failClosed: boolean;
  readonly failClosedReason?: string;
}

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["COMPLETED", "FAILED", "ABANDONED"]);

export function openEpisode(input: OpenEpisodeInput): { episode: ProjectEpisode; event: EpisodeOpenedEvent } {
  const episode: ProjectEpisode = {
    id: input.id,
    projectId: input.projectId,
    objective: input.objective,
    contractVersion: input.contractVersion,
    runIds: [],
    startedAt: nowIso(),
    status: "OPEN",
    acceptance: [...input.acceptance],
    evidenceRefs: [],
  };
  const event: EpisodeOpenedEvent = {
    type: "EPISODE_OPENED",
    episode,
    occurredAt: episode.startedAt,
  };
  return { episode, event };
}

export function attachRun(
  episode: ProjectEpisode,
  runId: RunId,
  runProjectId: ProjectId
): { episode: ProjectEpisode; event: RunAttachedEvent } {
  if (episode.runIds.includes(runId)) {
    throw new Error("run already attached");
  }
  if (episode.projectId !== runProjectId) {
    throw new Error("cannot attach a run from another project");
  }
  const next: ProjectEpisode = {
    ...episode,
    runIds: [...episode.runIds, runId],
  };
  const event: RunAttachedEvent = {
    type: "RUN_ATTACHED",
    episodeId: episode.id,
    runId,
    attachedAt: nowIso(),
  };
  return { episode: next, event };
}

export function waitForUser(
  episode: ProjectEpisode,
  reason: string,
  requiredEvidence: readonly string[]
): { episode: ProjectEpisode; event: EpisodeWaitingEvent } {
  const next: ProjectEpisode = { ...episode, status: "WAITING_FOR_USER" as const };
  const event: EpisodeWaitingEvent = {
    type: "EPISODE_WAITING",
    episodeId: episode.id,
    reason,
    requiredEvidence,
    occurredAt: nowIso(),
  };
  return { episode: next, event };
}

export function closeEpisode(
  episode: ProjectEpisode,
  status: "COMPLETED" | "FAILED" | "ABANDONED",
  outcomeId?: string
): { episode: ProjectEpisode; event: EpisodeClosedEvent } {
  const closedAt = nowIso();
  const next: ProjectEpisode = {
    ...episode,
    status: status as EpisodeStatus,
    closedAt,
    outcomeId: outcomeId as string | undefined,
  };
  const event: EpisodeClosedEvent = {
    type: "EPISODE_CLOSED",
    episodeId: episode.id,
    status: status as EpisodeStatus,
    closedAt,
    outcomeId: outcomeId as string | undefined,
  };
  return { episode: next, event };
}

export function reduceEpisodeEvents(events: readonly EpisodeEvent[]): EpisodeState {
  let episode: ProjectEpisode | null = null;
  const out: EpisodeEvent[] = [];
  let failClosed = false;
  let failClosedReason: string | undefined;
  const markFailed = (reason: string): void => {
    if (!failClosed) {
      failClosed = true;
      failClosedReason = reason;
    }
  };
  for (const e of events) {
    switch (e.type) {
      case "EPISODE_OPENED": {
        if (episode !== null) {
          markFailed(`duplicate EPISODE_OPENED for episode ${e.episode.id}; log rejected`);
          break;
        }
        episode = { ...e.episode };
        out.push(e);
        break;
      }
      case "RUN_ATTACHED": {
        if (episode === null) {
          markFailed(
            `RUN_ATTACHED for episode ${e.episodeId} before EPISODE_OPENED; dangling cross-stream ref`,
          );
          break;
        }
        if (episode.id !== e.episodeId) {
          markFailed(
            `RUN_ATTACHED references another episode (${e.episodeId}); dangling cross-stream ref`,
          );
          break;
        }
        if (TERMINAL_STATUSES.has(episode.status)) {
          markFailed(`RUN_ATTACHED after terminal status ${episode.status} for episode ${episode.id}`);
          break;
        }
        if (episode.runIds.includes(e.runId)) {
          markFailed(`duplicate RUN_ATTACHED for run ${e.runId} on episode ${episode.id}`);
          break;
        }
        const current: ProjectEpisode = episode;
        episode = { ...current, runIds: [...current.runIds, e.runId] };
        out.push(e);
        break;
      }
      case "EPISODE_WAITING": {
        if (episode === null || episode.id !== e.episodeId) {
          markFailed(
            `EPISODE_WAITING references ${episode === null ? "an unopened" : "another"} episode (${e.episodeId}); dangling cross-stream ref`,
          );
          break;
        }
        if (TERMINAL_STATUSES.has(episode.status)) {
          markFailed(`EPISODE_WAITING after terminal status ${episode.status} for episode ${episode.id}`);
          break;
        }
        const current: ProjectEpisode = episode;
        episode = { ...current, status: "WAITING_FOR_USER" as const };
        out.push(e);
        break;
      }
      case "EPISODE_CLOSED": {
        if (episode === null || episode.id !== e.episodeId) {
          markFailed(
            `EPISODE_CLOSED references ${episode === null ? "an unopened" : "another"} episode (${e.episodeId}); dangling cross-stream ref`,
          );
          break;
        }
        if (TERMINAL_STATUSES.has(episode.status)) {
          markFailed(
            `duplicate EPISODE_CLOSED after terminal status ${episode.status} for episode ${episode.id}`,
          );
          break;
        }
        const current: ProjectEpisode = episode;
        episode = {
          ...current,
          status: e.status,
          closedAt: e.closedAt,
          outcomeId: e.outcomeId,
        };
        out.push(e);
        break;
      }
    }
  }
  return {
    episode,
    events: out,
    failClosed,
    ...(failClosedReason !== undefined ? { failClosedReason } : {}),
  };
}
