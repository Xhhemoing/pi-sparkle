import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DomainValidationError } from "../domain/errors.js";
import { isRecord } from "../domain/record.js";
import { writeFileAtomic } from "../persist/atomic-file.js";
import { withExclusiveFileLock } from "../persist/file-lock.js";
import { adaptationRoot } from "../privacy/state-layout.js";
import { stableStringify } from "../experiments/manifest.js";
import { updateProjectBandit } from "./bandit-store.js";
import { stableProjectKey } from "./learned-routing.js";
import type { ObservedSignal } from "./signals.js";

/**
 * PS-P4 observation ledger: stable observation identity + dedupe before a
 * signal may update the project bandit. The same signal id must not double-
 * apply a reward.
 */

export interface ObservationLedgerDocument {
  readonly version: 1;
  readonly appliedIds: readonly string[];
}

export function observationLedgerPath(stateRoot: string, projectRoot: string): string {
  return join(
    adaptationRoot(stateRoot),
    "learning",
    "projects",
    stableProjectKey(projectRoot),
    "observation-ledger.json"
  );
}

/**
 * Stable identity for a learning signal. Prefer explicit evidence + run/task
 * binding; fall back to a content hash over the reward-relevant fields so a
 * repeated ingest of the same observation cannot re-apply.
 */
export function observationIdentity(signal: ObservedSignal): string {
  const evidenceKey = [...signal.evidenceIds].sort().join(",");
  const payload = {
    criterion: signal.criterion ?? "",
    outcomeKind: signal.outcomeKind ?? "",
    failureClass: signal.failureClass ?? "",
    modelId: signal.modelId ?? "",
    modelVersion: signal.modelVersion ?? "",
    projectId: signal.projectId,
    episodeId: signal.episodeId ?? "",
    runId: signal.runId ?? "",
    taskId: signal.taskId ?? "",
    evidenceIds: evidenceKey,
    kind: signal.kind,
    source: signal.source,
    boundary: signal.boundary,
    summary: signal.summary,
    score: signal.score
  };
  return `obs_${createHash("sha256").update(stableStringify(payload), "utf8").digest("hex")}`;
}

async function readLedger(path: string): Promise<ObservationLedgerDocument> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, appliedIds: [] };
    }
    throw error;
  }
  if (raw.trim() === "") {
    throw new DomainValidationError(`observation ledger at ${path} is empty`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DomainValidationError(`observation ledger at ${path} is not valid JSON`);
  }
  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.appliedIds)) {
    throw new DomainValidationError(`observation ledger at ${path} has invalid shape`);
  }
  if (!parsed.appliedIds.every((id): id is string => typeof id === "string" && id.trim() !== "")) {
    throw new DomainValidationError(`observation ledger at ${path} has invalid appliedIds`);
  }
  return { version: 1, appliedIds: parsed.appliedIds };
}

export interface DedupeResult {
  readonly novel: readonly ObservedSignal[];
  readonly duplicates: readonly ObservedSignal[];
  readonly novelIds: readonly string[];
}

export function partitionNovelSignals(
  signals: readonly ObservedSignal[],
  appliedIds: ReadonlySet<string>
): DedupeResult {
  const novel: ObservedSignal[] = [];
  const duplicates: ObservedSignal[] = [];
  const novelIds: string[] = [];
  const seenThisBatch = new Set<string>();
  for (const signal of signals) {
    const id = observationIdentity(signal);
    if (appliedIds.has(id) || seenThisBatch.has(id)) {
      duplicates.push(signal);
      continue;
    }
    seenThisBatch.add(id);
    novel.push(signal);
    novelIds.push(id);
  }
  return { novel, duplicates, novelIds };
}

export async function loadObservationLedger(
  stateRoot: string,
  projectRoot: string
): Promise<ObservationLedgerDocument> {
  return readLedger(observationLedgerPath(stateRoot, projectRoot));
}

/**
 * Update the project bandit only with observations that have not already been
 * applied. Marks novel identities in the ledger under the same exclusive lock
 * family as the bandit write (ledger lock wraps the bandit update).
 */
export async function updateProjectBanditDeduped(
  stateRoot: string,
  projectRoot: string,
  signals: readonly ObservedSignal[]
): Promise<{
  readonly state: Awaited<ReturnType<typeof updateProjectBandit>>;
  readonly applied: number;
  readonly skippedDuplicates: number;
}> {
  const ledgerPath = observationLedgerPath(stateRoot, projectRoot);
  return withExclusiveFileLock(`${ledgerPath}.lock`, async () => {
    const ledger = await readLedger(ledgerPath);
    const appliedSet = new Set(ledger.appliedIds);
    const { novel, duplicates, novelIds } = partitionNovelSignals(signals, appliedSet);
    const state = await updateProjectBandit(stateRoot, projectRoot, novel);
    if (novelIds.length > 0) {
      const next: ObservationLedgerDocument = {
        version: 1,
        appliedIds: [...ledger.appliedIds, ...novelIds]
      };
      await writeFileAtomic(ledgerPath, `${JSON.stringify(next, null, 2)}\n`);
    }
    return {
      state,
      applied: novel.length,
      skippedDuplicates: duplicates.length
    };
  });
}
