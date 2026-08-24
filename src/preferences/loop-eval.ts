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

type EffectiveValue = string | number | boolean;

/**
 * Running fold over one subject's live (pushed and not tombstone-removed)
 * observations, in order. Replaying the fold over a subject's live list
 * yields the same effective value as the historical whole-map recompute:
 * last explicit wins; otherwise the latest inferred value that reached the
 * default recurrence threshold.
 */
interface SubjectState {
  /** Value of the last live explicit observation; undefined = not anchored. */
  lastExplicit: EffectiveValue | undefined;
  /** Latest inferred value that reached the recurrence threshold. */
  lastDurableInferred: EffectiveValue | undefined;
  /** Live inferred occurrences per valueKey. */
  readonly inferredCounts: Map<string, number>;
}

/** Snapshot of the {@link SubjectState} fields one push may overwrite. */
interface PushUndo {
  readonly prevLastExplicit: EffectiveValue | undefined;
  readonly prevLastDurableInferred: EffectiveValue | undefined;
  /** Counted key for inferred pushes; undefined for explicit pushes. */
  readonly inferredKey: string | undefined;
}

function effectiveOf(state: SubjectState): EffectiveValue | undefined {
  return state.lastExplicit ?? state.lastDurableInferred;
}

function pushObservation(state: SubjectState, obs: PreferenceObservation): PushUndo {
  if (obs.explicit) {
    const undo: PushUndo = {
      prevLastExplicit: state.lastExplicit,
      prevLastDurableInferred: state.lastDurableInferred,
      inferredKey: undefined,
    };
    state.lastExplicit = obs.value;
    return undo;
  }
  const key = valueKey(obs.value);
  const undo: PushUndo = {
    prevLastExplicit: state.lastExplicit,
    prevLastDurableInferred: state.lastDurableInferred,
    inferredKey: key,
  };
  const count = (state.inferredCounts.get(key) ?? 0) + 1;
  state.inferredCounts.set(key, count);
  if (count >= MIN_INFERRED_RECURRENCE_DEFAULT) {
    state.lastDurableInferred = obs.value;
  }
  return undo;
}

/** Exact inverse of the immediately preceding {@link pushObservation}. */
function undoPush(state: SubjectState, undo: PushUndo): void {
  state.lastExplicit = undo.prevLastExplicit;
  state.lastDurableInferred = undo.prevLastDurableInferred;
  if (undo.inferredKey === undefined) return;
  const count = state.inferredCounts.get(undo.inferredKey) ?? 0;
  if (count <= 1) {
    state.inferredCounts.delete(undo.inferredKey);
  } else {
    state.inferredCounts.set(undo.inferredKey, count - 1);
  }
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
 *
 * Effective values are tracked per subject as an incremental fold instead of
 * regrouping every live observation at each step. A tombstone removal always
 * targets the observation pushed in the same iteration — a record id in
 * `tombstones` can never survive its own iteration, so no earlier live
 * observation shares the current id — which makes removal an O(1) undo of
 * the immediately preceding push.
 */
export function evaluatePreferenceLoop(
  observations: readonly PreferenceObservation[],
  tombstones: ReadonlySet<string>
): PreferenceLoopReport {
  const sorted = [...observations].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0
  );

  const bySubject = new Map<string, SubjectState>();
  const lastFlippedAway = new Map<string, EffectiveValue>();

  let laterExplicit = 0;
  let laterExplicitMatches = 0;
  let correctionCost = 0;
  let forgettingEvents = 0;
  let reversalEvents = 0;

  for (const obs of sorted) {
    const id = subjectId(obs);
    let state = bySubject.get(id);
    if (state === undefined) {
      state = { lastExplicit: undefined, lastDurableInferred: undefined, inferredCounts: new Map() };
      bySubject.set(id, state);
    }
    const before = effectiveOf(state);
    const inferredBefore = before !== undefined && state.lastExplicit === undefined;

    if (obs.explicit && before !== undefined) {
      laterExplicit += 1;
      if (sameValue(before, obs.value)) {
        laterExplicitMatches += 1;
      } else {
        correctionCost += 1;
        if (inferredBefore) forgettingEvents += 1;
      }
    }

    const undo = pushObservation(state, obs);
    const mid = effectiveOf(state);

    if (tombstones.has(obs.id)) {
      undoPush(state, undo);
    }

    const after = effectiveOf(state);

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
