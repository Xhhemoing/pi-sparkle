import type { EpisodeId } from "../domain/ids.js";
import type { IsoTimestamp } from "../domain/timestamp.js";

export type PreferenceScope = "user" | "project" | "task-family" | "role" | "model";

export interface PreferenceObservation {
  readonly id: string;
  readonly scope: PreferenceScope;
  readonly scopeKey: string; // projectId / role / model etc.
  readonly key: string;
  readonly value: string | number | boolean;
  readonly evidenceEpisodeId: EpisodeId;
  readonly weight: number; // 0-1
  readonly createdAt: IsoTimestamp;
}

export interface PreferenceView {
  readonly scope: PreferenceScope;
  readonly scopeKey: string;
  readonly aggregates: Record<string, number>;
  readonly lastUpdated: IsoTimestamp;
}
