import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { runtimeRoot } from "./state-layout.js";
import type { EpisodeId, RunId } from "../domain/ids.js";
import {
  feedbackTombstonesPath,
  readFeedbackRecordsRaw,
  readFeedbackTombstoneIds,
  writeFeedbackRecords
} from "../feedback/store.js";

export function tombstoneIds(ids: readonly string[]): ReadonlySet<string> {
  return new Set(ids);
}

export function materializeWithoutTombstones<T extends { id: string }>(
  items: readonly T[],
  tombstones: ReadonlySet<string>
): T[] {
  return items.filter((item) => !tombstones.has(item.id));
}

/**
 * P0 Q2 remediation (2026-08-22 privacy sign-off): consistent deletion
 * tooling. Deleting a run removes its runtime subtree. Deleting an episode
 * removes its runtime records AND cascades into the adaptation plane: every
 * feedback record bound to that episode gets its free-text payload stripped
 * and its id persisted as a tombstone, so dataset exports and materialized
 * views can never resurrect it.
 */

export interface DeletionResult {
  readonly target: string;
  readonly removedPaths: readonly string[];
  /** Feedback ids tombstoned by the episode cascade (empty for run deletes). */
  readonly cascadedFeedbackTombstones: readonly string[];
}

export { feedbackTombstonesPath } from "../feedback/store.js";

async function statExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete one run's runtime subtree: events, checkpoint, pause state, and
 * track questions live under `runtime/runs/<runId>/`. Deleting a run does not
 * touch its episode: episodes can outlive individual runs (multi-run attach).
 */
export async function deleteRunRecords(
  stateRoot: string,
  runId: RunId
): Promise<DeletionResult> {
  const runDir = join(runtimeRoot(stateRoot), "runs", runId);
  const removed: string[] = [];
  if (await statExists(runDir)) {
    await rm(runDir, { recursive: true, force: true });
    removed.push(runDir);
  }
  return { target: `run:${runId}`, removedPaths: removed, cascadedFeedbackTombstones: [] };
}

/**
 * Delete one episode's runtime records and cascade into feedback. Idempotent:
 * deleting an already-deleted episode succeeds and re-asserts the tombstones.
 */
export async function deleteEpisodeRecords(
  stateRoot: string,
  episodeId: EpisodeId
): Promise<DeletionResult> {
  const episodesDir = join(runtimeRoot(stateRoot), "episodes");
  const removed: string[] = [];
  // Two durable episode file shapes exist: the project-episode log
  // (`<id>.jsonl`) and the episode event log (`<id>.events.jsonl`). Both are
  // runtime records of this episode; both go.
  for (const file of [
    join(episodesDir, `${episodeId}.jsonl`),
    join(episodesDir, `${episodeId}.events.jsonl`)
  ]) {
    if (await statExists(file)) {
      await rm(file, { force: true });
      removed.push(file);
    }
  }

  const cascaded = await cascadeFeedbackTombstones(stateRoot, episodeId);
  return {
    target: `episode:${episodeId}`,
    removedPaths: removed,
    cascadedFeedbackTombstones: cascaded
  };
}

/**
 * Strip free-text payloads from feedback bound to the episode and persist
 * their ids as tombstones. The record shell (id, score, kind, timestamps) is
 * kept for audit; the body — the only user-text field — is removed.
 */
export async function cascadeFeedbackTombstones(
  stateRoot: string,
  episodeId: EpisodeId
): Promise<string[]> {
  const records = await readFeedbackRecordsRaw(stateRoot).catch(() => []);
  if (records.length === 0) return [];

  const tombstones = await readFeedbackTombstoneIds(stateRoot);
  const cascaded: string[] = [];
  const updated = records.map((record) => {
    if (record.episodeId !== episodeId) return record;
    cascaded.push(record.id);
    tombstones.add(record.id);
    return record.body === undefined ? record : { ...record, body: undefined };
  });
  if (cascaded.length === 0) return [];

  await writeFeedbackRecords(stateRoot, updated);
  const tombstonePath = feedbackTombstonesPath(stateRoot);
  await mkdir(dirname(tombstonePath), { recursive: true });
  await writeFile(tombstonePath, `${JSON.stringify([...tombstones].sort(), null, 2)}\n`, "utf8");
  return cascaded.sort();
}
