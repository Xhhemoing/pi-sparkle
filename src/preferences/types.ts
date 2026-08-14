import type { EpisodeId } from "../domain/ids.js";
import type { IsoTimestamp } from "../domain/timestamp.js";

export type PreferenceScope = "user" | "project" | "task-family" | "role" | "model";

export interface PreferenceObservation {
  readonly id: string;
  readonly scope: PreferenceScope;
  readonly scopeKey: string;
  readonly key: string;
  readonly value: string | number | boolean;
  readonly evidenceEpisodeId: EpisodeId;
  readonly weight: number;
  readonly createdAt: IsoTimestamp;
  readonly explicit: boolean;
  readonly recurrenceCount: number;
}

export interface PreferenceView {
  readonly scope: PreferenceScope;
  readonly scopeKey: string;
  readonly aggregates: Record<string, string | number | boolean>;
  readonly lastUpdated: IsoTimestamp;
  readonly confidence: number;
  readonly sourceCount: number;
}

export interface PreferenceConflict {
  readonly key: string;
  readonly existing: PreferenceObservation;
  readonly incoming: PreferenceObservation;
  readonly resolution: "keep-existing" | "override" | "merge";
}
