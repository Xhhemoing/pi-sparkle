import type {
  PreferenceObservation,
  PreferenceScope,
  PreferenceConflict,
  PreferenceView,
} from "./types.js";
import { nowIso } from "../domain/timestamp.js";
import { createId } from "../domain/ids.js";
import type { EpisodeId } from "../domain/ids.js";

const observations: PreferenceObservation[] = [];
const tombstones = new Set<string>();
const views = new Map<string, PreferenceView>();

/** Inferred observations must recur across this many comparable occurrences before becoming durable. */
export const MIN_INFERRED_RECURRENCE_DEFAULT = 2;
let minInferredRecurrence = MIN_INFERRED_RECURRENCE_DEFAULT;

export function configureMinInferredRecurrence(n: number): void {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`min inferred recurrence must be a positive integer, got ${n}`);
  }
  minInferredRecurrence = n;
  rebuildViews();
}

export function isTombstoned(id: string): boolean {
  return tombstones.has(id);
}

function viewKey(scope: PreferenceScope, scopeKey: string): string {
  return `${scope}:${scopeKey}`;
}

function sameSubject(a: PreferenceObservation, b: PreferenceObservation): boolean {
  return a.scope === b.scope && a.scopeKey === b.scopeKey && a.key === b.key;
}

/**
 * Recomputes every materialized view from the observation history in insertion
 * order. Only explicit observations and inferred observations that reached the
 * recurrence threshold are durable; everything else is retained as history but
 * never influences an effective value.
 */
function rebuildViews(): void {
  views.clear();
  const byPair = new Map<string, PreferenceObservation[]>();
  for (const obs of observations) {
    const key = viewKey(obs.scope, obs.scopeKey);
    const list = byPair.get(key) ?? [];
    list.push(obs);
    byPair.set(key, list);
  }
  byPair.forEach((obsList, key) => {
    const first = obsList[0];
    if (!first) return;
    const aggregates: Record<string, string | number | boolean> = {};
    let sourceCount = 0;
    let explicitOverrides = 0;
    let inferredConflicts = 0;
    for (const obs of obsList) {
      if (!obs.explicit && obs.recurrenceCount < minInferredRecurrence) continue;
      sourceCount += 1;
      const current = aggregates[obs.key];
      const hasConflict = current !== undefined && current !== obs.value;
      if (!hasConflict) {
        if (typeof current === "number" && typeof obs.value === "number") {
          aggregates[obs.key] = (current + obs.value) / 2;
        } else {
          aggregates[obs.key] = obs.value;
        }
      } else if (obs.explicit) {
        // Explicit instruction overrides any learned value and raises confidence.
        aggregates[obs.key] = obs.value;
        explicitOverrides += 1;
      } else {
        // Inferred conflict: merge numbers when possible, otherwise keep the
        // existing value; confidence drops either way and history is preserved.
        if (typeof current === "number" && typeof obs.value === "number") {
          aggregates[obs.key] = (current + obs.value) / 2;
        }
        inferredConflicts += 1;
      }
    }
    const base = Math.min(1, sourceCount / 5);
    const confidence = Math.max(
      0,
      Math.min(1, base + 0.25 * explicitOverrides - 0.25 * inferredConflicts)
    );
    views.set(key, {
      scope: first.scope,
      scopeKey: first.scopeKey,
      aggregates,
      lastUpdated: nowIso(),
      confidence,
      sourceCount,
    });
  });
}

function applyObservation(obs: PreferenceObservation): PreferenceObservation {
  // Recurrence counts comparable observations of the same kind: inferred
  // recurrences are behavioral evidence and must not borrow strength from an
  // explicit anchor (or vice versa).
  const prior = observations.filter(
    (o) => sameSubject(o, obs) && o.explicit === obs.explicit
  );
  const computed: PreferenceObservation = { ...obs, recurrenceCount: prior.length + 1 };
  observations.push(computed);
  rebuildViews();
  return computed;
}

export function recordObservation(obs: PreferenceObservation): void {
  applyObservation(obs);
}

export function recordPreference(
  scope: PreferenceScope,
  scopeKey: string,
  key: string,
  value: string | number | boolean,
  episodeId: EpisodeId,
  weight = 1.0,
  explicit = false
): PreferenceObservation {
  const obs: PreferenceObservation = {
    id: createId("EvidenceId"),
    scope,
    scopeKey,
    key,
    value,
    evidenceEpisodeId: episodeId,
    weight,
    createdAt: nowIso(),
    explicit,
    recurrenceCount: 1,
  };
  return applyObservation(obs);
}

export function listObservations(scope?: PreferenceScope): PreferenceObservation[] {
  if (!scope) return [...observations];
  return observations.filter((o) => o.scope === scope);
}

export function getObservationsByKey(
  scope: PreferenceScope,
  scopeKey: string
): PreferenceObservation[] {
  return observations.filter((o) => o.scope === scope && o.scopeKey === scopeKey);
}

export function findConflicts(
  scope: PreferenceScope,
  scopeKey: string
): PreferenceConflict[] {
  const byKey = new Map<string, PreferenceObservation[]>();
  for (const obs of observations) {
    if (obs.scope !== scope || obs.scopeKey !== scopeKey) continue;
    const list = byKey.get(obs.key) ?? [];
    list.push(obs);
    byKey.set(obs.key, list);
  }
  const conflicts: PreferenceConflict[] = [];
  byKey.forEach((obsList) => {
    const first = obsList[0];
    if (!first) return;
    for (let i = 1; i < obsList.length; i++) {
      const incoming = obsList[i];
      if (!incoming || incoming.value === first.value) continue;
      const resolution: PreferenceConflict["resolution"] = incoming.explicit
        ? "override"
        : first.explicit
          ? "keep-existing"
          : "merge";
      conflicts.push({ key: incoming.key, existing: first, incoming, resolution });
    }
  });
  return conflicts;
}

export function deleteObservation(id: string): boolean {
  const index = observations.findIndex((o) => o.id === id);
  if (index < 0) return false;
  tombstones.add(id);
  observations.splice(index, 1);
  rebuildViews();
  return true;
}

export function buildView(scope: PreferenceScope, scopeKey: string): PreferenceView {
  const key = viewKey(scope, scopeKey);
  const existing = views.get(key);
  if (existing) return existing;
  const empty: PreferenceView = {
    scope,
    scopeKey,
    aggregates: {},
    lastUpdated: nowIso(),
    confidence: 0,
    sourceCount: 0,
  };
  views.set(key, empty);
  return empty;
}

export function getView(scope: PreferenceScope, scopeKey: string): PreferenceView | undefined {
  return views.get(viewKey(scope, scopeKey));
}

export function clearPreferences(): void {
  observations.length = 0;
  views.clear();
}

/** Full reset including tombstones; used by tests and `pref` maintenance paths. */
export function resetPreferenceStore(): void {
  observations.length = 0;
  views.clear();
  tombstones.clear();
}
