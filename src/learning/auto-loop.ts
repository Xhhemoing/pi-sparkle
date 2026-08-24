import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DomainValidationError } from "../domain/errors.js";
import { createEvidenceId, isEvidenceId, type EpisodeId, type ProjectId } from "../domain/ids.js";
import { hash32 } from "../domain/hash.js";
import {
  hashCandidateContent
} from "../adaptation/candidate.js";
import {
  loadAdaptationRegistry,
  saveAdaptationRegistry,
  withAdaptationRegistryLock
} from "../adaptation/promotion.js";
import { ResourceRegistry } from "../adaptation/registry.js";
import type { FeedbackRecord } from "../feedback/types.js";
import { appendFeedbackWithRetry, type FeedbackAppendRetryOptions } from "../feedback/store.js";
import type { Event } from "../run/events.js";
import type { TaskAssignment } from "../routing/assign.js";
import { updateProjectBandit } from "./bandit-store.js";
import { diagnoseModelProjectIssues, type ModelProjectIssue } from "./diagnostics.js";
import { isAutoAdaptEnabled } from "../adaptation/approval-profile.js";
import {
  routingPolicyContent,
  routingPolicyIdentity,
  type LearnedAvoid,
  type LearnedPrefer,
  type LearnedRoutingPolicy
} from "./learned-routing.js";
import {
  collectSignalsFromEvents,
  collectSignalsFromSubagentRun,
  parseObservedSignal,
  type ObservedSignal,
  type SignalContext
} from "./signals.js";

const LEARN_EVALUATION_PLAN = {
  stages: ["static", "replay"],
  metrics: ["task-success", "cost"],
  planVersion: 1
} as const;

const AUTO_ACTOR = "pi-sparkle-auto-loop";

export interface AutoAdaptInput {
  readonly stateRoot: string;
  readonly projectRoot: string;
  readonly projectId: ProjectId;
  readonly primaryModelId: string;
  readonly episodeId?: EpisodeId | undefined;
  readonly events?: readonly Event[] | undefined;
  readonly extraSignals?: readonly ObservedSignal[] | undefined;
  readonly assignments?: readonly TaskAssignment[] | undefined;
  readonly subagentRunsDir?: string | undefined;
  readonly autoPromote?: boolean | undefined;
  /**
   * Retry budget and disclosure hook for the feedback persist step. Defaults
   * to `appendFeedbackWithRetry`'s; tests inject the sleep seam to make the
   * lock-timeout window deterministic.
   */
  readonly feedbackPersist?: FeedbackAppendRetryOptions | undefined;
}

export interface AutoAdaptResult {
  readonly collected: number;
  readonly issues: readonly ModelProjectIssue[];
  readonly created: boolean;
  readonly promoted: boolean;
  /** True when this call wrote the project's bandit file. False whenever the kill switch is off. */
  readonly banditUpdated: boolean;
  readonly candidateId?: string | undefined;
  readonly promotedVersionId?: string | undefined;
  readonly reason: string;
  /** Collected signals whose feedback row reached the log on this call. */
  readonly feedbackPersisted: number;
  /**
   * Collected signals whose feedback row was given up on after the bounded
   * lock-timeout retry. `collected` counts what was observed; this counts what
   * observation failed to keep, so the two are not silently conflated.
   */
  readonly feedbackDropped: number;
  /** One line per dropped row, in drop order, naming the record and the lock. */
  readonly feedbackDropReasons: readonly string[];
}

interface FeedbackPersistSummary {
  readonly persisted: number;
  readonly dropped: number;
  readonly reasons: readonly string[];
}

/**
 * A terminal feedback drop **warns**: the loop iteration still succeeds.
 *
 * The alternative — failing the iteration — was rejected because the run is
 * already over by the time this loop runs, the diagnosis is already computed
 * from the in-memory signals, and the only cause of a terminal drop is another
 * writer (the episode-deletion cascade) holding the log's lock longer than the
 * retry budget. Failing would throw away the bandit update and the candidate
 * proposal to punish a contention window nobody can act on, and `pi run`
 * would print "adapt skipped" for a run that adapted fine.
 *
 * Warning is only honest if the warning is unmissable, so the loss is reported
 * three ways: `feedbackDropped` counts it, `feedbackDropReasons` names each
 * row and the lock that blocked it, and `reason` — the one field both CLI
 * surfaces print — carries the count. Silence is the option that is not
 * available.
 */
function discloseDrops(reason: string, persist: FeedbackPersistSummary): string {
  if (persist.dropped === 0) return reason;
  const rows = persist.dropped === 1 ? "row" : "rows";
  return `${reason} (warning: ${persist.dropped} feedback ${rows} dropped, feedback-log lock timeout)`;
}

/**
 * Post-run adaptation: collect user + subagent feedback, diagnose (model, project)
 * issues, update the project bandit, and propose a routing-policy candidate.
 * Never CAS-promotes (`autoPromote` is ignored). Use `adapt promote --approve`.
 *
 * Does not mutate a live run.
 *
 * Feedback persistence degrades rather than fails: a feedback-log lock held
 * past the retry budget (a long episode-deletion cascade) drops the row and is
 * disclosed through `feedbackDropped` / `feedbackDropReasons` / `reason`
 * instead of rejecting — see `discloseDrops`. Every other persist failure
 * still rejects.
 *
 * Kill switch (`SPARKLE_AUTO_ADAPT=0|false|off`): collection still happens —
 * signals are parsed, persisted as feedback, and diagnosed, because that is
 * observation, not adaptation. Everything that *learns* stops: no bandit
 * update, no candidate proposal. The bandit is on the adaptation side of that
 * line even though nothing live reads it back: it is per-project state that
 * survives the run and shapes later analysis, so an operator who turned the
 * switch off must not keep finding their reward aggregates moving.
 */
export async function runAutoAdaptLoop(input: AutoAdaptInput): Promise<AutoAdaptResult> {
  const context: SignalContext = {
    projectId: input.projectId,
    projectRoot: input.projectRoot,
    ...(input.episodeId !== undefined ? { episodeId: input.episodeId } : {})
  };
  const fromEvents = collectSignalsFromEvents(input.events ?? [], context);
  const fromExtra = (input.extraSignals ?? []).map((signal) => parseObservedSignal(signal));
  const fromPi = await ingestSubagentDirectory(
    input.subagentRunsDir ?? join(input.projectRoot, ".pi", "subagents", "runs"),
    context
  );
  const signals = [...fromEvents, ...fromExtra, ...fromPi];
  const persist = await persistSignals(input.stateRoot, signals, input.feedbackPersist);
  const disclosure = {
    feedbackPersisted: persist.persisted,
    feedbackDropped: persist.dropped,
    feedbackDropReasons: persist.reasons
  };

  const issues = diagnoseModelProjectIssues(signals);
  if (!isAutoAdaptEnabled()) {
    return {
      collected: signals.length,
      issues,
      created: false,
      promoted: false,
      banditUpdated: false,
      reason: discloseDrops(
        "auto-adapt disabled; collected and diagnosed only, bandit not updated",
        persist
      ),
      ...disclosure
    };
  }

  const banditUpdated = signals.some((signal) => signal.modelId !== undefined);
  if (banditUpdated) {
    await updateProjectBandit(input.stateRoot, input.projectRoot, signals);
  }
  const failing = issues.filter(
    (issue) => issue.actionable && issue.modelId !== input.primaryModelId
  );

  if (failing.length > 0) {
    const policy = optimizedPolicy(input.primaryModelId, failing);
    const proposed = await proposeAndMaybePromote({
      stateRoot: input.stateRoot,
      projectRoot: input.projectRoot,
      policy
    });
    return {
      collected: signals.length,
      issues,
      created: proposed.created,
      promoted: proposed.promoted,
      banditUpdated,
      reason: discloseDrops(proposed.reason, persist),
      ...(proposed.candidateId !== undefined ? { candidateId: proposed.candidateId } : {}),
      ...(proposed.promotedVersionId !== undefined
        ? { promotedVersionId: proposed.promotedVersionId }
        : {}),
      ...disclosure
    };
  }

  return {
    collected: signals.length,
    issues,
    created: false,
    promoted: false,
    banditUpdated,
    reason: discloseDrops(
      signals.length === 0 ? "no feedback to learn from" : "no actionable model-project issue",
      persist
    ),
    ...disclosure
  };
}

function optimizedPolicy(
  primaryModelId: string,
  failing: readonly ModelProjectIssue[]
): LearnedRoutingPolicy {
  const avoid: LearnedAvoid[] = failing.map((issue) => ({
    modelId: issue.modelId,
    reason: `meanScore ${issue.meanScore.toFixed(2)} over ${issue.samples} samples`,
    ...(issue.family !== undefined ? { family: issue.family } : {})
  }));
  const prefer: LearnedPrefer[] = failing
    .filter((issue) => issue.family !== undefined)
    .map((issue) => ({ family: issue.family!, modelId: primaryModelId }));
  return { primaryModelId, avoid, prefer };
}

async function proposeAndMaybePromote(input: {
  readonly stateRoot: string;
  readonly projectRoot: string;
  readonly policy: LearnedRoutingPolicy;
}): Promise<{
  created: boolean;
  promoted: boolean;
  candidateId?: string;
  promotedVersionId?: string;
  reason: string;
}> {
  const content = routingPolicyContent(input.policy);
  const contentHash = hashCandidateContent(content);
  const identity = routingPolicyIdentity(input.projectRoot);

  return withAdaptationRegistryLock(input.stateRoot, async () => {
    let registry: ResourceRegistry;
    try {
      registry = await loadAdaptationRegistry(input.stateRoot);
    } catch (error) {
      if (!(error instanceof DomainValidationError) || !/no registry snapshot/.test(error.message)) {
        throw error;
      }
      registry = new ResourceRegistry();
    }
    let parent = registry.getActiveVersion(identity);
    if (parent === undefined) {
      parent = registry.registerBaseline({
        identity,
        content: routingPolicyContent({
          primaryModelId: input.policy.primaryModelId,
          avoid: [],
          prefer: []
        }),
        author: { kind: "detector", identity: AUTO_ACTOR }
      });
    }
    const existing = registry
      .candidatesFor(identity)
      .find((candidate) => candidate.contentHash === contentHash);
    let candidateId = existing?.candidateId;
    let created = false;
    if (existing === undefined && parent.contentHash !== contentHash) {
      const candidate = registry.createCandidate({
        identity,
        content,
        parentVersionId: parent.versionId,
        author: { kind: "detector", identity: AUTO_ACTOR },
        evaluationPlan: LEARN_EVALUATION_PLAN
      });
      candidateId = candidate.candidateId;
      created = true;
    }
    if (candidateId === undefined) {
      await saveAdaptationRegistry(input.stateRoot, registry);
      return { created: false, promoted: false, reason: "observed policy matches the active baseline" };
    }
    await saveAdaptationRegistry(input.stateRoot, registry);
    return {
      created,
      promoted: false,
      candidateId,
      reason: created ? "proposed routing-policy candidate" : "identical candidate already proposed"
    };
  });
}

/**
 * Write one feedback row per episode-bound signal.
 *
 * Appends go through `appendFeedbackWithRetry`, so a deletion cascade holding
 * the log's lock costs a bounded wait rather than the whole loop: a lock
 * timeout is retried, a terminal give-up is counted and reported, and any
 * other failure (malformed record, unwritable state root) still propagates.
 */
async function persistSignals(
  stateRoot: string,
  signals: readonly ObservedSignal[],
  options: FeedbackAppendRetryOptions | undefined
): Promise<FeedbackPersistSummary> {
  let persisted = 0;
  const reasons: string[] = [];
  for (const signal of signals) {
    if (signal.episodeId === undefined) continue;
    const record: FeedbackRecord = {
      id: `fbk_${hash32(`${signal.summary}:${signal.score}:${signal.modelId ?? ""}`)}`,
      episodeId: signal.episodeId,
      kind: signal.kind,
      rubricVersion: "auto-loop-v1",
      score: signal.score,
      evidenceRefs: signal.evidenceIds.filter(isEvidenceId).length > 0
        ? signal.evidenceIds.filter(isEvidenceId)
        : [createEvidenceId(() => hash32(signal.summary).padStart(8, "0"))],
      redacted: false,
      createdAt: signal.createdAt,
      summary: signal.summary,
      ...(signal.runId !== undefined ? { runId: signal.runId } : {}),
      ...(signal.taskId !== undefined ? { taskId: signal.taskId } : {})
    };
    const outcome = await appendFeedbackWithRetry(stateRoot, record, options ?? {});
    if (outcome.status === "persisted") {
      persisted += 1;
      continue;
    }
    reasons.push(outcome.reason);
  }
  return { persisted, dropped: reasons.length, reasons };
}

async function ingestSubagentDirectory(
  dir: string,
  context: SignalContext
): Promise<ObservedSignal[]> {
  const names = await readdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return [];
    throw error;
  });
  const signals: ObservedSignal[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const rawText = await readFile(join(dir, name), "utf8").catch(() => "");
    if (rawText === "") continue;
    try {
      signals.push(...collectSignalsFromSubagentRun(JSON.parse(rawText) as unknown, context));
    } catch {
      // skip malformed Pi run files
    }
  }
  return signals;
}

export async function runAutoAdaptFromEvents(input: {
  readonly stateRoot: string;
  readonly events: readonly Event[];
  readonly primaryModelId: string;
  readonly projectRoot?: string | undefined;
  readonly autoPromote?: boolean | undefined;
  readonly feedbackPersist?: FeedbackAppendRetryOptions | undefined;
}): Promise<AutoAdaptResult> {
  let projectId: ProjectId | undefined;
  let projectRoot = input.projectRoot;
  let episodeId: EpisodeId | undefined;
  for (const event of input.events) {
    if (event.type === "PROJECT_DISCOVERED") {
      projectId = event.payload.project.id;
      projectRoot = projectRoot ?? event.payload.project.rootPath;
    }
    if (event.type === "EPISODE_OPENED") {
      episodeId = event.payload.episode.id;
    }
  }
  if (projectId === undefined || projectRoot === undefined) {
    return {
      collected: 0,
      issues: [],
      created: false,
      promoted: false,
      banditUpdated: false,
      reason: "run has no project snapshot",
      feedbackPersisted: 0,
      feedbackDropped: 0,
      feedbackDropReasons: []
    };
  }
  return runAutoAdaptLoop({
    stateRoot: input.stateRoot,
    projectRoot,
    projectId,
    primaryModelId: input.primaryModelId,
    events: input.events,
    ...(episodeId !== undefined ? { episodeId } : {}),
    ...(input.autoPromote !== undefined ? { autoPromote: input.autoPromote } : {}),
    ...(input.feedbackPersist !== undefined ? { feedbackPersist: input.feedbackPersist } : {})
  });}
