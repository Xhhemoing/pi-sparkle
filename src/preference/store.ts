import type { PreferenceObservation, PreferenceView, PreferenceScope } from "./types.js";
import type { EpisodeId } from "../domain/ids.js";
import { nowIso } from "../domain/timestamp.js";

const observations: PreferenceObservation[] = [];

export function recordPreference(
  scope: PreferenceScope,
  scopeKey: string,
  key: string,
  value: string | number | boolean,
  episodeId: EpisodeId,
  weight = 1.0
): PreferenceObservation {
  const obs: PreferenceObservation = {
    id: `pref_${Date.now()}`,
    scope,
    scopeKey,
    key,
    value,
    evidenceEpisodeId: episodeId,
    weight,
    createdAt: nowIso(),
  };
  observations.push(obs);
  return obs;
}

export function buildView(scope: PreferenceScope, scopeKey: string): PreferenceView {
  const relevant = observations.filter(o => o.scope === scope && o.scopeKey === scopeKey);
  const aggregates: Record<string, number> = {};
  for (const o of relevant) {
    const k = String(o.key);
    aggregates[k] = (aggregates[k] || 0) + (typeof o.value === "number" ? o.value : 1) * o.weight;
  }
  return {
    scope,
    scopeKey,
    aggregates,
    lastUpdated: nowIso(),
  };
}

export function listObservations(scope?: PreferenceScope): PreferenceObservation[] {
  return scope ? observations.filter(o => o.scope === scope) : [...observations];
}
