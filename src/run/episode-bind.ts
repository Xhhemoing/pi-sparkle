import { join } from "node:path";
import { validateRequirementContract, type RequirementContract } from "../domain/contract.js";
import {
  createEpisodeId,
  createEvidenceId,
  type EpisodeId,
  type IdGenerator,
  type ProjectId,
  type RunId
} from "../domain/ids.js";
import { hash32 } from "../domain/hash.js";
import { decideClosure } from "../episode/closure.js";
import { attachRun, closeEpisode, openEpisode, waitForUser } from "../episode/manager.js";
import { EpisodeEventStore } from "../episode/store.js";
import { withExclusiveFileLock, type FileLockOptions } from "../persist/file-lock.js";
import { runtimeRoot } from "../privacy/state-layout.js";
import type { RunStatus } from "../domain/status.js";
import type { Event } from "./events.js";
import { EpisodeStore } from "./episode-store.js";

/**
 * The cooperative lock guarding a single episode's read-decide-append.
 * Must stay byte-identical to the path `episode close` takes (`src/cli/episode.ts`),
 * otherwise the CLI and the run side would serialize against different files.
 */
export function episodeLockPath(stateRoot: string, episodeId: EpisodeId): string {
  return join(runtimeRoot(stateRoot), "episodes", `${episodeId}.lock`);
}

export function contractFromObjective(objective: string, skipped: boolean): RequirementContract {
  return validateRequirementContract({
    schemaVersion: 1,
    objective,
    deliverables: [],
    constraints: [],
    nonGoals: skipped ? ["unspecified-scope"] : [],
    acceptanceCriteria: [
      {
        id: "run-complete",
        description: "The run reaches a terminal status",
        observableCheck: "run.status is COMPLETED, FAILED, or CANCELLED"
      }
    ],
    assumptions: skipped
      ? [{ id: "skip-contract", statement: "Caller did not supply a versioned contract", source: "cli" }]
      : [],
    questions: [],
    authority: [],
    sourceRefs: [
      {
        kind: "message",
        ref: skipped ? "skip-contract" : "cli-objective",
        excerpt: objective.slice(0, 200)
      }
    ]
  });
}

export async function bindEpisodeToRun(opts: {
  stateRoot: string;
  runId: RunId;
  projectId: ProjectId;
  objective: string;
  contract?: RequirementContract;
  skipContract?: boolean;
  append: (event: Event) => Promise<void>;
  make: (type: Event["type"], payload: unknown) => Event;
  generateId?: IdGenerator;
}): Promise<{ episodeId: EpisodeId; contract: RequirementContract }> {
  const contract =
    opts.contract ?? contractFromObjective(opts.objective, opts.skipContract !== false);
  const episodeId = createEpisodeId(opts.generateId);
  const opened = openEpisode({
    id: episodeId,
    projectId: opts.projectId,
    objective: opts.objective,
    contractVersion: contract.schemaVersion,
    acceptance: contract.acceptanceCriteria
  });
  const attached = attachRun(opened.episode, opts.runId, opts.projectId);
  // No episode lock here: `episodeId` was just generated, so no other writer can
  // know it yet. The lock only matters once the id is reachable from the run log
  // (see settleBoundEpisode and `episode close`).
  const snapshots = new EpisodeStore(opts.stateRoot, episodeId);
  const episodeEvents = new EpisodeEventStore(opts.stateRoot, episodeId);
  await snapshots.append(opened.episode);
  await snapshots.append(attached.episode);
  await episodeEvents.append(opened.event);
  await episodeEvents.append(attached.event);
  await opts.append(opts.make("EPISODE_OPENED", { episode: opened.episode }));
  await opts.append(
    opts.make("RUN_ATTACHED", {
      episodeId,
      runId: opts.runId,
      attachedAt: attached.event.attachedAt
    })
  );
  return { episodeId, contract };
}

export function episodeIdFromEvents(events: readonly Event[]): EpisodeId | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === "RUN_ATTACHED") return event.payload.episodeId;
  }
  return undefined;
}

function episodeCloseStatus(
  status: RunStatus
): "COMPLETED" | "FAILED" | "ABANDONED" | "WAITING" | undefined {
  switch (status) {
    case "COMPLETED":
      return "COMPLETED";
    case "FAILED":
      return "FAILED";
    case "CANCELLED":
      return "ABANDONED";
    case "WAITING_FOR_USER":
    case "PAUSED":
    case "BLOCKED":
      return "WAITING";
    default:
      return undefined;
  }
}

/**
 * Aligns the bound episode with the run's inspectable status.
 * Terminal runs close the episode; waiting/paused/blocked runs mark it waiting.
 * Missing attachments and already-settled episodes are no-ops.
 *
 * The decision runs under the episode's cooperative lock, the same one
 * `episode close` holds, so a concurrent operator close cannot interleave into a
 * second terminal snapshot or a WAITING appended after CLOSED. A lock we cannot
 * acquire fails closed: the caller sees the timeout and nothing is appended.
 */
export async function settleBoundEpisode(opts: {
  stateRoot: string;
  events: readonly Event[];
  status: RunStatus;
  append: (event: Event) => Promise<void>;
  make: (type: Event["type"], payload: unknown) => Event;
  lockOptions?: FileLockOptions;
}): Promise<void> {
  const action = episodeCloseStatus(opts.status);
  if (action === undefined) return;
  if (opts.events.some((event) => event.type === "EPISODE_CLOSED")) return;
  const episodeId = episodeIdFromEvents(opts.events);
  if (episodeId === undefined) return;

  await withExclusiveFileLock(
    episodeLockPath(opts.stateRoot, episodeId),
    () => settleLockedEpisode({ ...opts, episodeId, action }),
    opts.lockOptions ?? {}
  );
}

/** Runs with the episode lock held; every read below must stay inside it. */
async function settleLockedEpisode(opts: {
  stateRoot: string;
  events: readonly Event[];
  status: RunStatus;
  append: (event: Event) => Promise<void>;
  make: (type: Event["type"], payload: unknown) => Event;
  episodeId: EpisodeId;
  action: "COMPLETED" | "FAILED" | "ABANDONED" | "WAITING";
}): Promise<void> {
  const { episodeId, action } = opts;
  // Re-read under the lock: whatever we saw before acquiring it may be stale.
  const snapshots = new EpisodeStore(opts.stateRoot, episodeId);
  const latest = (await snapshots.readAll()).episodes.at(-1);
  if (latest === undefined) return;
  if (latest.status === "COMPLETED" || latest.status === "FAILED" || latest.status === "ABANDONED") {
    return;
  }

  const episodeEvents = new EpisodeEventStore(opts.stateRoot, episodeId);
  if (action === "WAITING") {
    if (latest.status === "WAITING_FOR_USER") return;
    if (opts.events.some((event) => event.type === "EPISODE_WAITING")) return;
    const reason =
      opts.status === "BLOCKED" ? "run blocked" : opts.status === "PAUSED" ? "run paused" : "run waiting for user";
    const waiting = waitForUser(latest, reason, []);
    await snapshots.append(waiting.episode);
    await episodeEvents.append(waiting.event);
    await opts.append(
      opts.make("EPISODE_WAITING", {
        episodeId,
        reason,
        requiredEvidence: []
      })
    );
    return;
  }

  let closable = latest;
  if (action === "COMPLETED") {
    const runComplete = latest.acceptance.find((criterion) => criterion.id === "run-complete");
    const latestRunId = latest.runIds.at(-1);
    if (runComplete !== undefined && latestRunId !== undefined) {
      const evidenceId = createEvidenceId(() => `run-${hash32(latestRunId)}`);
      closable = {
        ...latest,
        evidenceRefs: latest.evidenceRefs.includes(evidenceId)
          ? latest.evidenceRefs
          : [...latest.evidenceRefs, evidenceId],
        acceptanceEvidence: [
          ...(latest.acceptanceEvidence ?? []).filter(
            (evidence) => evidence.criterionId !== runComplete.id
          ),
          {
            criterionId: runComplete.id,
            evidenceId,
            result: "PASSED",
            sourceRef: `run-status:${latestRunId}:COMPLETED`
          }
        ]
      };
    }
    const decision = decideClosure(closable, closable.runIds);
    if (!decision.canClose) {
      if (latest.status === "WAITING_FOR_USER") return;
      if (opts.events.some((event) => event.type === "EPISODE_WAITING")) return;
      const waiting = waitForUser(closable, decision.reason, decision.requiredEvidence);
      await snapshots.append(waiting.episode);
      await episodeEvents.append(waiting.event);
      await opts.append(
        opts.make("EPISODE_WAITING", {
          episodeId,
          reason: decision.reason,
          requiredEvidence: decision.requiredEvidence
        })
      );
      return;
    }
  }

  const closed = closeEpisode(closable, action, opts.status);
  await snapshots.append(closed.episode);
  await episodeEvents.append(closed.event);
  await opts.append(
    opts.make("EPISODE_CLOSED", {
      episodeId,
      status: action,
      closedAt: closed.event.closedAt,
      ...(closed.event.outcomeId !== undefined ? { outcomeId: closed.event.outcomeId } : {})
    })
  );
}
