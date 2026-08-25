import { join } from "node:path";
import { writeFileAtomic } from "../persist/atomic-file.js";
import type { FileLockOptions } from "../persist/file-lock.js";
import { runtimeRoot } from "../privacy/state-layout.js";
import { createAgentProfileRegistry, defaultAgentProfiles } from "../agents/registry.js";
import {
  createEventId,
  createMessageId,
  createRunId,
  createTaskId,
  type IdGenerator,
  type RunId
} from "../domain/ids.js";
import { defaultRunLimits } from "../domain/limits.js";
import type { RequirementContract } from "../domain/contract.js";
import type { ProjectSnapshot } from "../domain/project.js";
import { nowIso } from "../domain/timestamp.js";
import { calibrateCatalogFromState } from "../routing/cost-calibration.js";
import { buildLiveCatalogConfig } from "../cli/model-catalog.js";
import { type TaskAssignment } from "../routing/assign.js";
import { compileChildrenToFlowchart } from "../graph/compile-children.js";
import { isAgentRole } from "../domain/roles.js";
import { liveCascadePlanFromAssignment } from "../routing/live-cascade.js";
import { loadLearnedRouting } from "../learning/learned-routing.js";
import type { PublicPriorSnapshot } from "../routing/public-prior.js";
import { runAutoAdaptLoop } from "../learning/auto-loop.js";
import { withRunLifecycleLock, type RunOutcome } from "../run/coordinator.js";
import type { ChildTaskInput } from "../run/child-coordinator.js";
import { startFlowchartRun } from "../run/flowchart-run.js";
import type { PauseController } from "../run/pause-controller.js";
import { createModelRouter } from "../supervisor/model-router.js";
import { bindEpisodeToRun, episodeIdFromEvents, settleBoundEpisode } from "../run/episode-bind.js";
import { EventStore } from "../run/event-store.js";
import { CheckpointStore } from "../run/checkpoint-store.js";
import { materializeCheckpoint, replayRun, validateCheckpoint } from "../run/replay.js";
import type { Event } from "../run/events.js";
import type { AgentExecutor } from "../execution/contract.js";
import { discoverProject } from "../project/discovery.js";
import { applyAnswers, clarifyObjective } from "./clarify.js";
import { acceptanceForRole } from "./plan.js";
import { splitAndAssignForPrimary } from "./primary-split.js";
import { applyPrecedence } from "../requirement/precedence.js";

export interface TrackRunInput {
  readonly projectRoot: string;
  readonly objective: string;
  readonly stateRoot: string;
  readonly executor: AgentExecutor;
  readonly primaryModelId: string;
  readonly fastModelId?: string;
  readonly assumeDefaults?: boolean;
  readonly answers?: Readonly<Record<string, string>>;
  readonly generateId?: IdGenerator;
  readonly prior?: PublicPriorSnapshot;
  /**
   * Observes pause requests for the run this input starts, at the flowchart
   * loop's round boundaries.
   *
   * Optional, and absence is not a no-op detail: `pauseIfRequested` returns
   * immediately when the loop context carries no controller, so a tracked run
   * started without one cannot be paused at all — its `pause.json` is written
   * and never read. Every other command path already supplies the file
   * controller, which is why this is the seam the tracked path was missing
   * rather than a new capability.
   */
  readonly pause?: PauseController;
  /**
   * Discloses the flowchart run's id as soon as that run exists, before it can
   * be paused for the first time.
   *
   * Forwarded verbatim to `startFlowchartRun`, which documents the guarantee.
   * The clarification path deliberately does not fire it: that run never
   * reaches the flowchart loop, is `WAITING_FOR_USER` before it returns, and
   * has nothing to pause.
   */
  readonly onRunStarted?: (runId: RunId) => void;
  /** Bounds the clarification run's acquisition of {@link withRunLifecycleLock}. */
  readonly runLock?: FileLockOptions;
}

export interface TrackRunOutcome extends RunOutcome {
  readonly assignments: readonly TaskAssignment[];
  readonly questions: readonly { id: string; question: string }[];
  readonly split?: {
    readonly source: "primary-schema";
  };
  readonly learn?: {
    created: boolean;
    candidateId?: string;
    reason: string;
    promoted?: boolean;
    collected?: number;
  };
}

export async function startTrackedRun(input: TrackRunInput): Promise<TrackRunOutcome> {
  const clarify = await clarifyObjective({
    objective: input.objective,
    projectKey: input.projectRoot,
    assumeDefaults: input.assumeDefaults === true || input.answers !== undefined
  });
  const answers = input.answers ?? {};
  const applied = applyAnswers(clarify.questions, answers);
  if (clarify.waiting && applied.unanswered.length > 0) {
    return waitForClarification(input, clarify.candidate.contract, applied.unanswered);
  }

  const contract = applyPrecedence(clarify.candidate.contract, "user-first");
  const catalog = await calibrateCatalogFromState(
    await buildLiveCatalogConfig(input.stateRoot, {
      primaryModelId: input.primaryModelId,
      ...(input.fastModelId !== undefined ? { fastModelId: input.fastModelId } : {})
    }),
    input.stateRoot
  );
  const learned = await loadLearnedRouting(input.stateRoot, input.projectRoot);
  const split = splitAndAssignForPrimary({
    contract,
    catalog,
    habits: clarify.habits,
    answers: applied.resolved,
    ...(input.generateId !== undefined ? { generateId: input.generateId } : {}),
    ...(learned !== undefined ? { learned } : {}),
    ...(input.prior !== undefined ? { prior: input.prior } : {})
  });
  const planned = split.children;
  const assignments = split.assignments;
  const registry = createAgentProfileRegistry(defaultAgentProfiles());
  const resolvedQuestionIds =
    input.assumeDefaults === true || applied.unanswered.length === 0
      ? contract.questions.map((question) => question.id)
      : Object.keys(applied.resolved);
  const children: ChildTaskInput[] = planned.map((child) => {
    const assignment = assignments.find((item) => item.taskId === child.taskId);
    const profile = registry.resolve(child.role);
    return {
      taskId: child.taskId,
      role: child.role,
      objective: child.objective,
      profile,
      inputArtifactIds: [],
      acceptanceCriteria: acceptanceForRole(child.role, contract),
      limits: { maxAttempts: 2, timeoutMs: 60_000, maxWallTimeMs: 3_600_000 },
      dependsOn: child.dependsOn,
      ...(assignment !== undefined
        ? {
            assignedModel: assignment.decision.model,
            cascade: liveCascadePlanFromAssignment(assignment, catalog)
          }
        : {})
    };
  });

  const catalogIds = catalog.models.map((model) => model.id);
  const preferredFast =
    input.fastModelId !== undefined && catalogIds.includes(input.fastModelId)
      ? input.fastModelId
      : catalogIds[0]!;
  const flowchart = compileChildrenToFlowchart(
    children.flatMap((child) => {
      if (!isAgentRole(child.role)) return [];
      return [
        {
          taskId: child.taskId,
          role: child.role,
          objective: child.objective,
          ...(child.dependsOn !== undefined ? { dependsOn: child.dependsOn } : {}),
          allowedModels: catalogIds,
          ...(child.assignedModel !== undefined ? { preferredModel: child.assignedModel } : {})
        }
      ];
    }),
    {
      flowchartId: "track",
      allowedModels: catalogIds,
      preferredModel: preferredFast
    }
  );

  const outcome = await startFlowchartRun(
    {
      stateRoot: input.stateRoot,
      router: createModelRouter(catalog),
      executor: input.executor,
      registry,
      cluster: true,
      ...(input.generateId !== undefined ? { generateId: input.generateId } : {}),
      ...(input.pause !== undefined ? { pause: input.pause } : {}),
      ...(input.onRunStarted !== undefined ? { onRunStarted: input.onRunStarted } : {})
    },
    {
      projectRoot: input.projectRoot,
      flowchart,
      objective: input.objective,
      childTasks: children,
      contract,
      assignments,
      resolvedQuestionIds
    }
  );
  const episodeId = episodeIdFromEvents(outcome.events);
  const adapt = await runAutoAdaptLoop({
    stateRoot: input.stateRoot,
    projectRoot: input.projectRoot,
    projectId: outcome.project.id,
    primaryModelId: input.primaryModelId,
    events: outcome.events,
    assignments,
    ...(episodeId !== undefined ? { episodeId } : {})
  });
  const learn = {
    created: adapt.created,
    reason: adapt.reason,
    ...(adapt.candidateId !== undefined ? { candidateId: adapt.candidateId } : {}),
    promoted: adapt.promoted,
    collected: adapt.collected
  };
  return {
    ...outcome,
    assignments,
    questions: [],
    split: { source: split.source },
    learn
  };
}

/**
 * The clarification path is a run lifecycle like any other — it mints a run id
 * and writes that run's whole record set — so it holds the run's cooperative
 * lock for all of it, the way `startRun`, `startParentRun` and the flowchart
 * embedders do. Without the acquisition it wrote a discovery event, a bound
 * episode and a `RUN_WAITING_FOR_USER` straight past a `delete --run` already
 * removing that subtree, and only then failed closed at the questions write —
 * leaving a half-written run behind. It was the last CLI-reachable embedder the
 * survivors error's "an embedder that does not take the lifecycle lock" clause
 * described.
 *
 * Discovery stays outside, per the helper's rules: a run refused there must not
 * create `runtime/runs/` for a run that never happened.
 */
async function waitForClarification(
  input: TrackRunInput,
  contract: RequirementContract,
  questions: readonly { id: string; question: string }[]
): Promise<TrackRunOutcome> {
  const generateId = input.generateId;
  const runId = createRunId(generateId);
  const now = nowIso;
  const project = await discoverProject(input.projectRoot, {
    now,
    ...(generateId !== undefined ? { generateId } : {})
  });
  return withRunLifecycleLock(
    input.stateRoot,
    runId,
    () => recordClarificationRun(input, contract, questions, runId, project),
    input.runLock
  );
}

async function recordClarificationRun(
  input: TrackRunInput,
  contract: RequirementContract,
  questions: readonly { id: string; question: string }[],
  runId: RunId,
  project: ProjectSnapshot
): Promise<TrackRunOutcome> {
  const generateId = input.generateId;
  const now = nowIso;
  const eventStore = new EventStore(input.stateRoot, runId);
  const checkpointStore = new CheckpointStore(input.stateRoot, runId);
  const rootTaskId = createTaskId(generateId);
  const make = (type: Event["type"], payload: unknown): Event =>
    ({
      id: createEventId(generateId),
      schemaVersion: 1,
      occurredAt: now(),
      runId,
      type,
      actor: "coordinator",
      payload
    }) as Event;
  const append = (event: Event) => eventStore.append(event);
  await append(
    make("PROJECT_DISCOVERED", { project })
  );
  await append(
    make("RUN_CREATED", {
      run: {
        id: runId,
        projectId: project.id,
        rootTaskId,
        status: "PLANNING",
        limits: defaultRunLimits(),
        createdAt: now(),
        updatedAt: now()
      }
    })
  );
  await bindEpisodeToRun({
    stateRoot: input.stateRoot,
    runId,
    projectId: project.id,
    objective: input.objective,
    contract,
    skipContract: false,
    append,
    make: (type, payload) => make(type, payload),
    ...(generateId !== undefined ? { generateId } : {})
  });
  await append(make("RUN_STARTED", {}));
  const messageId = createMessageId(generateId);
  await append(make("RUN_WAITING_FOR_USER", { messageId }));
  // Crash-atomic: the questions file holds the objective (and is scanned for
  // residual episode text), and writing it creates the run directory, so a
  // plain write here could tear. `writeFileAtomic` creates the directory
  // itself. Its own run-lock acquisition is gone — the whole run holds that
  // lock now, and the lock is not reentrant, so keeping it would self-deadlock.
  // The exclusion it bought against `delete --run` is unchanged and wider.
  await writeFileAtomic(
    join(runtimeRoot(input.stateRoot), "runs", runId, "track-questions.json"),
    `${JSON.stringify({ questions, objective: input.objective, contract }, null, 2)}\n`
  );
  await settleBoundEpisode({
    stateRoot: input.stateRoot,
    events: (await eventStore.readAll()).events,
    status: "WAITING_FOR_USER",
    append,
    make: (type, payload) => make(type, payload)
  });
  const read = await eventStore.readAll();
  const state = replayRun(read.events);
  const checkpoint = validateCheckpoint(materializeCheckpoint(state, now()));
  await checkpointStore.write(checkpoint);
  return {
    runId,
    status: "WAITING_FOR_USER",
    events: read.events,
    checkpoint,
    project,
    assignments: [],
    questions: questions.map((question) => ({ id: question.id, question: question.question }))
  };
}
