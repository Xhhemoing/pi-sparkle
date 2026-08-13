import {
  createEventId,
  createRunId,
  createTaskId,
  type IdGenerator,
  type RunId,
  type TaskId
} from "../domain/ids.js";
import { defaultRunLimits, type RunLimits } from "../domain/limits.js";
import type { ProjectSnapshot } from "../domain/project.js";
import type { Run } from "../domain/run.js";
import type { RunStatus, TaskStatus } from "../domain/status.js";
import { nowIso, type IsoTimestamp } from "../domain/timestamp.js";
import type { AgentProfileRegistry } from "../agents/registry.js";
import type { AgentExecutor } from "../execution/contract.js";
import type { JudgeAdapter, JudgeDecision } from "../graph/judge.js";
import { DeterministicJudge } from "../graph/judge.js";
import { validateTaskGraph, type TaskGraph } from "../graph/validate.js";
import { discoverProject } from "../project/discovery.js";
import { advanceLedgerRound, classifyRoundProgress, createLedger, type LedgerRoundEvent } from "../supervisor/ledger.js";
import { CheckpointStore } from "./checkpoint-store.js";
import { ChildCoordinator, type ChildRunOutcome } from "./child-coordinator.js";
import { EventStore } from "./event-store.js";
import type { Event } from "./events.js";
import { materializeCheckpoint, replayRun, validateCheckpoint } from "./replay.js";
import { applyTaskOutcome, LeaseRegistry, planRound, type TaskOutcome } from "./scheduler.js";

export interface SupervisorDeps {
  stateRoot: string;
  executor: AgentExecutor;
  registry: AgentProfileRegistry;
  judge?: JudgeAdapter;
  now?: () => IsoTimestamp;
  generateId?: IdGenerator;
}

export interface SupervisedRunInput {
  projectRoot: string;
  objective: string;
  tasks: import("../domain/task.js").TaskNode[];
  limits?: RunLimits;
}

export interface SupervisedRunHandle {
  runId: RunId;
  done: Promise<{
    runId: RunId;
    status: RunStatus;
    events: Event[];
    checkpoint: ReturnType<typeof validateCheckpoint>;
    project: ProjectSnapshot;
  }>;
  cancel(): void;
}

const LEASE_MS = 300_000;

function toTaskOutcome(outcome: ChildRunOutcome["outcome"]): TaskOutcome {
  switch (outcome) {
    case "SUCCESS":
    case "PARTIAL":
      return "SUCCESS";
    case "FAILURE":
      return "FAILURE";
    case "TIMEOUT":
      return "TIMEOUT";
    case "CANCELLED":
      return "CANCELLED";
  }
}

/**
 * M2: a supervisor that schedules a validated task graph in bounded rounds,
 * leases tasks to child executors, applies judge decisions through declared
 * transitions, and blocks the run after repeated no-progress rounds.
 */
export function startSupervisedRun(deps: SupervisorDeps, input: SupervisedRunInput): SupervisedRunHandle {
  const controller = new AbortController();
  const now = deps.now ?? nowIso;
  const generateId = deps.generateId;
  const judge = deps.judge ?? new DeterministicJudge();
  const runId = createRunId(generateId);

  const done = (async () => {
    const project = await discoverProject(input.projectRoot, {
      now,
      ...(generateId !== undefined ? { generateId } : {})
    });
    const eventStore = new EventStore(deps.stateRoot, runId);
    const checkpointStore = new CheckpointStore(deps.stateRoot, runId);
    const limits = input.limits ?? defaultRunLimits();
    const rootTaskId = createTaskId(generateId);

    const run: Run = {
      id: runId,
      projectId: project.id,
      rootTaskId,
      status: "PLANNING",
      limits,
      createdAt: now(),
      updatedAt: now()
    };

    const make = (type: Event["type"], payload: unknown, taskId?: TaskId): Event =>
      ({
        id: createEventId(generateId),
        schemaVersion: 1,
        occurredAt: now(),
        runId,
        ...(taskId !== undefined ? { taskId } : {}),
        type,
        actor: "supervisor",
        payload
      }) as Event;

    const append = (event: Event) => eventStore.append(event);

    // Validate before any worker starts.
    const graph: TaskGraph = validateTaskGraph(input.tasks);
    await append(make("PROJECT_DISCOVERED", { project }));
    await append(make("RUN_CREATED", { run }));
    await append(make("RUN_STARTED", {}));
    await append(make("TASK_GRAPH_ACCEPTED", { tasks: [...graph.tasks] }));

    const childCoordinator = new ChildCoordinator({
      stateRoot: deps.stateRoot,
      executor: deps.executor,
      parentRunId: runId,
      project,
      registry: deps.registry,
      maxConcurrentTasks: limits.maxConcurrentTasks,
      now,
      ...(generateId !== undefined ? { generateId } : {})
    });

    const statuses = new Map<TaskId, TaskStatus>();
    for (const node of graph.tasks) statuses.set(node.id, "PENDING");
    const attempts = new Map<TaskId, number>();
    const leases = new LeaseRegistry(() => Date.parse(now()));
    let ledger = createLedger(input.objective, limits.maxConsecutiveStalls);
    let finalStatus: RunStatus = "RUNNING";
    let finalReason: string | undefined;

    const recordStatus = async (taskId: TaskId, status: TaskStatus, attempt: number): Promise<void> => {
      statuses.set(taskId, status);
      attempts.set(taskId, attempt);
      await append(make("TASK_STATUS_CHANGED", { taskId, status, attempt }, taskId));
    };

    outer: for (let round = 1; round <= limits.maxRounds; round += 1) {
      if (controller.signal.aborted) {
        finalStatus = "CANCELLED";
        await append(make("RUN_CANCEL_REQUESTED", {}));
        break;
      }

      const ready = planRound(graph, statuses, limits.maxConcurrentTasks, LEASE_MS, leases);
      if (ready.length === 0) {
        // Nothing schedulable: either everything is terminal or the run stalls.
        const open = graph.tasks.filter((node) => {
          const status = statuses.get(node.id);
          return status === "PENDING" || status === "READY" || status === "RUNNING" || status === "BLOCKED";
        });
        if (open.length === 0) {
          finalStatus = "COMPLETED";
          await append(make("RUN_COMPLETED", {}));
          break;
        }
        if (open.every((node) => statuses.get(node.id) === "FAILED")) {
          finalStatus = "FAILED";
          finalReason = "all open tasks failed";
          await append(make("RUN_FAILED", { reason: finalReason }));
          break;
        }
        // A stalled round: no admissible progress evidence.
        const roundEvent: LedgerRoundEvent = {
          completedTasks: [],
          newEvidenceIds: [],
          newFacts: [],
          resolvedBlockers: [],
          userDecision: false
        };
        const progress = classifyRoundProgress(roundEvent, ledger);
        ledger = advanceLedgerRound(ledger, progress, limits.maxConsecutiveStalls, {
          event: roundEvent,
          timestamp: now()
        });
        await append(
          make(
            "LEDGER_UPDATED",
            {
              revision: ledger.revision,
              round: ledger.round,
              consecutiveStalls: ledger.consecutiveStalls,
              isBlocked: ledger.isBlocked
            },
            ready[0]
          )
        );
        if (ledger.isBlocked) {
          finalStatus = "BLOCKED";
          const requiredEvidence = ledger.requiredEvidence.map((entry) => entry.description);
          await append(make("STALL_DETECTED", { round, consecutiveStalls: ledger.consecutiveStalls, requiredEvidence }));
          await append(make("RUN_BLOCKED", { reason: "no progress for too many rounds", requiredEvidence }));
          break;
        }
        continue;
      }

      // Execute the round's ready tasks.
      const roundEvent: LedgerRoundEvent = {
        completedTasks: [],
        newEvidenceIds: [],
        newFacts: [],
        resolvedBlockers: [],
        userDecision: false
      };

      for (const taskId of ready) {
        const node = graph.byId.get(taskId);
        if (node === undefined) continue;
        const childRunId = createRunId(generateId);
        leases.lease(taskId, childRunId, LEASE_MS);
        await append(
          make(
            "TASK_LEASED",
            { taskId, childRunId, expiresAt: new Date(Date.parse(now()) + LEASE_MS).toISOString() as IsoTimestamp },
            taskId
          )
        );
        await recordStatus(taskId, "RUNNING", attempts.get(taskId) ?? 0);

        const outcome = await childCoordinator.startChildTask(
          {
            taskId,
            role: node.role,
            objective: node.objective,
            profile: deps.registry.resolve(node.role),
            inputArtifactIds: [],
            acceptanceCriteria: node.acceptanceCriteria,
            limits: { maxAttempts: node.maxAttempts, timeoutMs: node.timeoutMs, maxWallTimeMs: limits.maxWallTimeMs }
          },
          controller.signal
        ).done;

        leases.release(taskId);

        if (controller.signal.aborted) {
          finalStatus = "CANCELLED";
          await append(make("RUN_CANCEL_REQUESTED", {}));
          break outer;
        }

        const terminal = outcome.terminalResult;
        const verification = terminal?.verification ?? { kind: "UNOBSERVED" as const, evidenceIds: [] };
        const evidenceIds = terminal?.evidenceIds ?? [];
        const decision: JudgeDecision = judge.decide({
          taskId,
          task: node,
          verification,
          evidenceIds
        });
        await append(
          make(
            "JUDGE_DECISION",
            {
              taskId,
              verdict: decision.verdict,
              evidenceIds: decision.evidenceIds,
              ...(decision.reason !== undefined ? { reason: decision.reason } : {})
            },
            taskId
          )
        );

        const attempt = (attempts.get(taskId) ?? 0) + 1;
        switch (decision.verdict) {
          case "APPROVED":
            await recordStatus(taskId, "COMPLETED", attempt);
            roundEvent.completedTasks.push(taskId);
            roundEvent.newEvidenceIds.push(...evidenceIds);
            break;
          case "REJECTED": {
            const transition = applyTaskOutcome({ ...node, attempt: attempt - 1 }, toTaskOutcome(outcome.outcome));
            await recordStatus(taskId, transition.status, transition.attempt);
            if (transition.status === "BLOCKED") {
              // Supervisor-owned retry: BLOCKED -> READY when attempts remain.
              // Retrying without new evidence is NOT progress (spec: stalls).
              await recordStatus(taskId, "READY", transition.attempt);
            }
            break;
          }
          case "NEEDS_USER_DECISION":
            await recordStatus(taskId, "BLOCKED", attempt);
            roundEvent.userDecision = true;
            break;
        }
      }

      const progress = classifyRoundProgress(roundEvent, ledger);
      ledger = advanceLedgerRound(ledger, progress, limits.maxConsecutiveStalls, {
        event: roundEvent,
        timestamp: now()
      });
      await append(
        make(
          "LEDGER_UPDATED",
          {
            revision: ledger.revision,
            round: ledger.round,
            consecutiveStalls: ledger.consecutiveStalls,
            isBlocked: ledger.isBlocked
          },
          ready[0]
        )
      );
      if (ledger.isBlocked) {
        finalStatus = "BLOCKED";
        const requiredEvidence = ledger.requiredEvidence.map((entry) => entry.description);
        await append(make("STALL_DETECTED", { round, consecutiveStalls: ledger.consecutiveStalls, requiredEvidence }));
        await append(make("RUN_BLOCKED", { reason: "no progress for too many rounds", requiredEvidence }));
        break;
      }
    }

    if (finalStatus === "RUNNING") {
      // Rounds exhausted without a terminal decision.
      finalStatus = "FAILED";
      finalReason = `maxRounds (${limits.maxRounds}) exhausted without completion`;
      await append(make("RUN_FAILED", { reason: finalReason }));
    }

    const read = await eventStore.readAll();
    const state = replayRun(read.events);
    const checkpoint = validateCheckpoint(materializeCheckpoint(state, now()));
    await checkpointStore.write(checkpoint);
    return { runId, status: finalStatus, events: read.events, checkpoint, project };
  })();

  return {
    runId,
    done,
    cancel: () => controller.abort()
  };
}
