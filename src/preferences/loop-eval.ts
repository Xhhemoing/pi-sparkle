import type { PreferenceObservation } from "./types.js";
import { MIN_INFERRED_RECURRENCE_DEFAULT } from "./store.js";

export interface PreferenceLoopReport {
  readonly fit: number;
  readonly correctionCost: number;
  readonly forgettingEvents: number;
  readonly reversalEvents: number;
}

function subjectId(obs: PreferenceObservation): string {
  return `${obs.scope}\u0000${obs.scopeKey}\u0000${obs.key}`;
}

function valueKey(value: string | number | boolean): string {
  return `${typeof value}:${String(value)}`;
}

function sameValue(
  a: string | number | boolean,
  b: string | number | boolean
): boolean {
  return a === b;
}

/**
 * Effective value for one subject from live (non-tombstoned) observations:
 * last explicit wins; otherwise the latest inferred value that reached the
 * default recurrence threshold.
 */
function effectiveForSubject(
  live: readonly PreferenceObservation[]
): string | number | boolean | undefined {
  let lastExplicit: string | number | boolean | undefined;
  const inferredCounts = new Map<string, number>();
  let lastDurableInferred: string | number | boolean | undefined;

  for (const obs of live) {
    if (obs.explicit) {
      lastExplicit = obs.value;
      continue;
    }
    const key = valueKey(obs.value);
    const count = (inferredCounts.get(key) ?? 0) + 1;
    inferredCounts.set(key, count);
    if (count >= MIN_INFERRED_RECURRENCE_DEFAULT) {
      lastDurableInferred = obs.value;
    }
  }

  return lastExplicit ?? lastDurableInferred;
}

function effectiveBySubject(
  live: readonly PreferenceObservation[]
): Map<string, string | number | boolean> {
  const grouped = new Map<string, PreferenceObservation[]>();
  for (const obs of live) {
    const id = subjectId(obs);
    const list = grouped.get(id) ?? [];
    list.push(obs);
    grouped.set(id, list);
  }
  const result = new Map<string, string | number | boolean>();
  for (const [id, list] of grouped) {
    const value = effectiveForSubject(list);
    if (value !== undefined) result.set(id, value);
  }
  return result;
}

function subjectIsExplicitAnchored(
  live: readonly PreferenceObservation[],
  id: string
): boolean {
  return live.some((obs) => subjectId(obs) === id && obs.explicit);
}

/**
 * Preference-loop metrics over an observation history.
 *
 * - **fit**: of later explicit observations (those recorded while a
 *   then-effective value already existed for the same subject), the fraction
 *   whose value matches that then-effective view. Vacuous `1` when none.
 * - **correctionCost**: explicit observations that override a prior inferred
 *   or explicit effective value with a different value.
 * - **forgettingEvents**: effective value becomes absent after a tombstone,
 *   or an inferred effective value is displaced by an explicit opposite
 *   correction.
 * - **reversalEvents**: effective value flips A→B then later B→A.
 */
export function evaluatePreferenceLoop(
  observations: readonly PreferenceObservation[],
  tombstones: ReadonlySet<string>
): PreferenceLoopReport {
  const sorted = [...observations].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0
  );

  const live: PreferenceObservation[] = [];
  const lastFlippedAway = new Map<string, string | number | boolean>();

  let laterExplicit = 0;
  let laterExplicitMatches = 0;
  let correctionCost = 0;
  let forgettingEvents = 0;
  let reversalEvents = 0;

  for (const obs of sorted) {
    const id = subjectId(obs);
    const before = effectiveBySubject(live).get(id);
    const inferredBefore =
      before !== undefined && !subjectIsExplicitAnchored(live, id);

    if (obs.explicit && before !== undefined) {
      laterExplicit += 1;
      if (sameValue(before, obs.value)) {
        laterExplicitMatches += 1;
      } else {
        correctionCost += 1;
        if (inferredBefore) forgettingEvents += 1;
      }
    }

    live.push(obs);
    const mid = effectiveBySubject(live).get(id);

    if (tombstones.has(obs.id)) {
      const index = live.findIndex((row) => row.id === obs.id);
      if (index >= 0) live.splice(index, 1);
    }

    const after = effectiveBySubject(live).get(id);

    if (tombstones.has(obs.id) && mid !== undefined && after === undefined) {
      forgettingEvents += 1;
    }

    if (before !== undefined && after !== undefined && !sameValue(before, after)) {
      const origin = lastFlippedAway.get(id);
      if (origin !== undefined && sameValue(origin, after)) {
        reversalEvents += 1;
      }
      lastFlippedAway.set(id, before);
    } else if (after === undefined) {
      lastFlippedAway.delete(id);
    }
  }

  return {
    fit: laterExplicit === 0 ? 1 : laterExplicitMatches / laterExplicit,
    correctionCost,
    forgettingEvents,
    reversalEvents,
  };
}
