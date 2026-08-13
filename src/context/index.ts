import type { ProjectId, RunId, EpisodeId } from "../domain/ids.js";
import type { IsoTimestamp } from "../domain/timestamp.js";

export interface ProjectContextIndex {
  readonly projectId: ProjectId;
  readonly episodeId?: EpisodeId;
  readonly lastUpdated: IsoTimestamp;
  readonly manifests: Record<string, string>;
  readonly architecture: string[];
  readonly tests: string[];
  readonly risks: string[];
  readonly priorEpisodes: EpisodeId[];
}

export function createEmptyContext(projectId: ProjectId, ts: IsoTimestamp): ProjectContextIndex {
  return {
    projectId,
    lastUpdated: ts,
    manifests: {},
    architecture: [],
    tests: [],
    risks: [],
    priorEpisodes: []
  };
}
