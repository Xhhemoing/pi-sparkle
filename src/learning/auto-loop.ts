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
import { appendFeedback } from "../feedback/store.js";
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
}

/**
 * Post-run adaptation: collect user + subagent feedback, diagnose (model, project)
 * issues, update the project bandit, and propose a routing-policy candidate.
 * Never CAS-promotes (`autoPromote` is ignored). Use `adapt promote --approve`.
 *
 * Does not mutate a live run.
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
  await persistSignals(input.stateRoot, signals);

  const issues = diagnoseModelProjectIssues(signals);
  if (!isAutoAdaptEnabled()) {
    return {
      collected: signals.length,
      issues,
      created: false,
      promoted: false,
      banditUpdated: false,
      reason: "auto-adapt disabled; collected and diagnosed only, bandit not updated"
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
      reason: proposed.reason,
      ...(proposed.candidateId !== undefined ? { candidateId: proposed.candidateId } : {}),
      ...(proposed.promotedVersionId !== undefined
        ? { promotedVersionId: proposed.promotedVersionId }
        : {})
    };
  }

  return {
    collected: signals.length,
    issues,
    created: false,
    promoted: false,
    banditUpdated,
    reason: signals.length === 0 ? "no feedback to learn from" : "no actionable model-project issue"
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

async function persistSignals(stateRoot: string, signals: readonly ObservedSignal[]): Promise<void> {
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
    try {
      await appendFeedback(stateRoot, record);
    } catch (error: unknown) {
      // Lock timeout is a dropped adaptation sample, never a failed run.
      // Other store failures (corrupt log, malformed tombstones) still abort
      // the pass: those are not "one row could not serialize".
      if (
        error instanceof DomainValidationError &&
        error.message.includes("timed out waiting for lock")
      ) {
        continue;
      }
      throw error;
    }
  }
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
      reason: "run has no project snapshot"
    };
  }
  return runAutoAdaptLoop({
    stateRoot: input.stateRoot,
    projectRoot,
    projectId,
    primaryModelId: input.primaryModelId,
    events: input.events,
    ...(episodeId !== undefined ? { episodeId } : {}),
    ...(input.autoPromote !== undefined ? { autoPromote: input.autoPromote } : {})
  });}
