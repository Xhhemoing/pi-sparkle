import type { EpisodeId } from "../domain/ids.js";
import type { PreferenceObservation, PreferenceScope } from "./types.js";
import {
  recordPreference,
  listObservations,
  deleteObservation,
  isTombstoned,
  resetPreferenceStore,
  configurePreferencePersistence,
} from "./store.js";

export { configurePreferencePersistence };

export interface InspectResult {
  readonly count: number;
  readonly observations: PreferenceObservation[];
}

export function inspectPreferences(scope?: PreferenceScope): InspectResult {
  const obs = listObservations(scope);
  return { count: obs.length, observations: obs };
}

export function recordExplicitPreference(
  scope: PreferenceScope,
  scopeKey: string,
  key: string,
  value: string | number | boolean,
  episodeId: EpisodeId
): PreferenceObservation {
  return recordPreference(scope, scopeKey, key, value, episodeId, 1.0, true);
}

export function recordInferredPreference(
  scope: PreferenceScope,
  scopeKey: string,
  key: string,
  value: string | number | boolean,
  episodeId: EpisodeId,
  weight = 0.5
): PreferenceObservation {
  return recordPreference(scope, scopeKey, key, value, episodeId, weight, false);
}

export function correctPreference(
  scope: PreferenceScope,
  scopeKey: string,
  key: string,
  value: string | number | boolean,
  episodeId: EpisodeId
): PreferenceObservation {
  return recordExplicitPreference(scope, scopeKey, key, value, episodeId);
}

export function deletePreference(id: string): boolean {
  return deleteObservation(id);
}

export function isDeleted(id: string): boolean {
  return isTombstoned(id);
}

export function clearAll(): void {
  resetPreferenceStore();
}
