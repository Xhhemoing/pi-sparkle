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
}

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
  for (const e of events) {
    out.push(e);
    switch (e.type) {
      case "EPISODE_OPENED":
        episode = { ...e.episode };
        break;
      case "RUN_ATTACHED":
        if (episode && episode.id === e.episodeId) {
          const current: ProjectEpisode = episode;
          if (!current.runIds.includes(e.runId)) {
            episode = { ...current, runIds: [...current.runIds, e.runId] };
          }
        }
        break;
      case "EPISODE_WAITING":
        if (episode && episode.id === e.episodeId) {
          const current: ProjectEpisode = episode;
          episode = { ...current, status: "WAITING_FOR_USER" as const };
        }
        break;
      case "EPISODE_CLOSED":
        if (episode && episode.id === e.episodeId) {
          const current: ProjectEpisode = episode;
          episode = {
            ...current,
            status: e.status,
            closedAt: e.closedAt,
            outcomeId: e.outcomeId,
          };
        }
        break;
    }
  }
  return { episode, events: out };
}
