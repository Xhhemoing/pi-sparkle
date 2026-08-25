import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  PreferenceObservation,
  PreferenceScope,
  PreferenceConflict,
  PreferenceView,
} from "./types.js";
import { nowIso } from "../domain/timestamp.js";
import { createId } from "../domain/ids.js";
import type { EpisodeId } from "../domain/ids.js";
import { DomainValidationError } from "../domain/errors.js";
import { writeFileAtomicSync } from "../persist/atomic-file.js";
import { adaptationRoot } from "../privacy/state-layout.js";

/**
 * This module is a process-global singleton with a synchronous API, and that
 * API alone is **in-process-only**: it holds no lock. Every mutator
 * (`recordObservation`, `recordPreference`, `deleteObservation`,
 * `clearPreferences`) persists the whole in-memory state, and
 * `configurePreferencePersistence` loads the whole snapshot, so two processes
 * whose load→mutate→persist windows overlap are last-writer-wins: the loser's
 * write is lost silently, and a lost `deleteObservation` puts a tombstoned
 * observation back on disk under a delete that already reported success.
 *
 * The cross-process exclusion therefore lives one layer up, at the writer:
 * `pref correct` and `pref delete` hold `preferenceSnapshotLockPath` across
 * bind, mutate and persist (`src/cli/main.ts`). **Any new writer of this
 * snapshot must take that lock over the same span** — binding inside it, so
 * the state it persists derives from bytes read while the lock was held.
 * Readers (`pref list` / `pref export`, doctor's `readPreferenceSnapshot`)
 * stay lock-free: the snapshot is published by rename, so a reader sees one
 * whole version or another, never a splice.
 */

let persistFile: string | undefined;

/** The preference snapshot for `stateRoot`; the store's only durable file. */
export function preferenceSnapshotPath(stateRoot: string): string {
  return join(adaptationRoot(stateRoot), "preferences.json");
}

/**
 * Cooperative lock guarding the snapshot's cross-process read-modify-write.
 *
 * Mirrors `records.jsonl.lock` and `bandit.json.lock`: a `<file>.lock` sidecar
 * next to the file it guards, acquired through `withExclusiveFileLock`, never
 * stolen, and inventoried by `pi-sparkle doctor` without acquiring it (its
 * lock scan discovers any `*.lock` under the state root).
 */
export function preferenceSnapshotLockPath(stateRoot: string): string {
  return `${preferenceSnapshotPath(stateRoot)}.lock`;
}

const observations: PreferenceObservation[] = [];
const tombstones = new Set<string>();
const views = new Map<string, PreferenceView>();

export const PREFERENCE_SNAPSHOT_UNREADABLE_CODE = "PREFERENCE_SNAPSHOT_UNREADABLE" as const;

/**
 * `adaptation/preferences.json` exists but cannot be read as a preference snapshot.
 *
 * Preferences are learned, behaviour-bearing state with no other copy on disk, so an
 * unreadable snapshot fails closed: the store keeps whatever binding and in-memory state it
 * had before the call, and nothing is persisted over the unreadable bytes. Silently starting
 * from empty would look identical to "the user has never expressed a preference" and the next
 * `recordPreference` would overwrite the file, destroying the history for good.
 *
 * The file is written by `writeFileAtomicSync`, so a partial snapshot is no longer reachable
 * by a crash mid-write; what remains is external damage (a truncated restore, a hand edit, a
 * disk fault). Recovery is an operator decision — repair the file from a backup, or move it
 * aside to start over deliberately. Discriminate on `code`, never on the message.
 */
export class PreferenceSnapshotUnreadableError extends DomainValidationError {
  readonly code = PREFERENCE_SNAPSHOT_UNREADABLE_CODE;
  readonly path: string;

  constructor(path: string, detail: string, cause?: unknown) {
    super(
      `preference snapshot at ${path} is unreadable (${detail}); ` +
        "preferences were left untouched and nothing was written back — " +
        "repair the file or move it aside to start from an empty store"
    );
    this.name = "PreferenceSnapshotUnreadableError";
    this.path = path;
    if (cause !== undefined) this.cause = cause;
  }
}

export interface PreferenceSnapshot {
  readonly observations: readonly PreferenceObservation[];
  readonly tombstones: readonly string[];
}

/**
 * Structural gate only: rows are trusted field-by-field because this store is their sole
 * writer. What it rejects is the shape a damaged file takes — a truncation, a wrong document,
 * a non-array where history belongs — all of which would otherwise read as "no preferences".
 */
function parseSnapshot(path: string, raw: string): PreferenceSnapshot {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error: unknown) {
    throw new PreferenceSnapshotUnreadableError(path, "not valid JSON", error);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PreferenceSnapshotUnreadableError(path, "top level is not a JSON object");
  }
  const record = value as { observations?: unknown; tombstones?: unknown };
  const rawObservations = record.observations ?? [];
  if (!Array.isArray(rawObservations)) {
    throw new PreferenceSnapshotUnreadableError(path, "observations is not an array");
  }
  for (const row of rawObservations) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      throw new PreferenceSnapshotUnreadableError(path, "an observation row is not an object");
    }
  }
  const rawTombstones = record.tombstones ?? [];
  if (!Array.isArray(rawTombstones) || rawTombstones.some((id) => typeof id !== "string")) {
    throw new PreferenceSnapshotUnreadableError(path, "tombstones is not an array of ids");
  }
  return {
    observations: rawObservations as readonly PreferenceObservation[],
    tombstones: rawTombstones as readonly string[],
  };
}

/**
 * Read and validate a snapshot without binding the store or touching its in-memory state:
 * `undefined` means the file does not exist, and damage throws
 * `PreferenceSnapshotUnreadableError`. This is the reader for callers that want to know whether
 * a snapshot is intact — a diagnostic inventory, say — without adopting it as this process's
 * preferences; `configurePreferencePersistence` is what adopts one.
 */
export function readPreferenceSnapshot(file: string): PreferenceSnapshot | undefined {
  if (!existsSync(file)) return undefined;
  return parseSnapshot(file, readFileSync(file, "utf8"));
}

/** Reads and validates `file` before touching any in-memory state: a throw changes nothing. */
function loadFromDisk(file: string): void {
  const snapshot = readPreferenceSnapshot(file);
  if (snapshot === undefined) return;
  observations.length = 0;
  observations.push(...snapshot.observations);
  tombstones.clear();
  for (const id of snapshot.tombstones) tombstones.add(id);
  rebuildViews();
}

function saveToDisk(): void {
  if (persistFile === undefined) return;
  writeFileAtomicSync(
    persistFile,
    JSON.stringify({ observations, tombstones: Array.from(tombstones) })
  );
}

/**
 * Persist preferences to `filePath` and load any existing snapshot.
 *
 * Binding happens only after a successful load, so a `PreferenceSnapshotUnreadableError`
 * leaves the store persisting exactly where it did before instead of pointing at a file the
 * next observation would overwrite.
 *
 * This call is the "load" half of the read-modify-write window described at the top of the
 * module: a writer must make it while already holding `preferenceSnapshotLockPath`.
 */
export function configurePreferencePersistence(filePath: string | undefined): void {
  if (filePath === undefined) {
    persistFile = undefined;
    return;
  }
  loadFromDisk(filePath);
  persistFile = filePath;
}

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

/** All tombstoned observation ids, for authorized exports and audits. */
export function listTombstones(): string[] {
  return Array.from(tombstones);
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
    // Parallel weight sums so numeric merges are weighted means instead of
    // naive averages; a heavier observation dominates the merged value.
    const weights: Record<string, number> = {};
    // Keys anchored by an explicit instruction: inferred conflicts against
    // them keep the explicit value instead of merging (mirrors findConflicts'
    // "keep-existing" resolution).
    const explicitAnchored = new Set<string>();
    let sourceCount = 0;
    let explicitOverrides = 0;
    let inferredConflicts = 0;
    for (const obs of obsList) {
      if (!obs.explicit && obs.recurrenceCount < minInferredRecurrence) continue;
      sourceCount += 1;
      const current = aggregates[obs.key];
      const currentW = weights[obs.key] ?? 0;
      const hasConflict = current !== undefined && current !== obs.value;

      if (obs.explicit) {
        // Explicit instruction anchors the key: it sets the value and any
        // later inferred conflict keeps this value instead of merging.
        aggregates[obs.key] = obs.value;
        weights[obs.key] = obs.weight;
        explicitAnchored.add(obs.key);
        if (hasConflict) explicitOverrides += 1;
      } else if (!hasConflict) {
        if (typeof obs.value === "number" && typeof current === "number" && currentW > 0) {
          // Same numeric value: the weighted mean is the value itself; only
          // accumulate weight so later conflicting observations merge fairly.
          weights[obs.key] = currentW + obs.weight;
        } else {
          aggregates[obs.key] = obs.value;
          weights[obs.key] = obs.weight;
        }
      } else if (explicitAnchored.has(obs.key)) {
        // Inferred conflict against an explicit anchor: keep the explicit
        // value; confidence drops and history is preserved.
        inferredConflicts += 1;
      } else if (typeof current === "number" && typeof obs.value === "number") {
        // Inferred-vs-inferred numeric conflict: weighted mean.
        const merged = (current * currentW + obs.value * obs.weight) / (currentW + obs.weight);
        aggregates[obs.key] = merged;
        weights[obs.key] = currentW + obs.weight;
        inferredConflicts += 1;
      } else {
        // Inferred conflict on a non-numeric key: keep the existing value.
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
  saveToDisk();
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
  saveToDisk();
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
  saveToDisk();
}

/**
 * Full in-memory reset including tombstones. Does not rewrite the on-disk
 * snapshot: a process restart is `resetPreferenceStore()` (or `clearAll()`)
 * followed by `configurePreferencePersistence(path)`, which reloads
 * observations and tombstones from disk.
 */
export function resetPreferenceStore(): void {
  observations.length = 0;
  views.clear();
  tombstones.clear();
}
