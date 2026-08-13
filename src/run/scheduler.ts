import { DomainValidationError } from "../domain/errors.js";
import { isRunId, type RunId, type TaskId } from "../domain/ids.js";
import type { TaskNode } from "../domain/task.js";
import type { TaskStatus } from "../domain/status.js";
import type { IsoTimestamp } from "../domain/timestamp.js";
import type { TaskGraph } from "../graph/validate.js";
import { allDependenciesSatisfied } from "../graph/readiness.js";

export const TASK_OUTCOMES = ["SUCCESS", "FAILURE", "TIMEOUT", "CANCELLED"] as const;
export type TaskOutcome = (typeof TASK_OUTCOMES)[number];

export interface TaskLease {
  taskId: TaskId;
  runId: RunId;
  leasedAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
}

/** Exactly one active lease per task; expiry never silently duplicates work. */
export class LeaseRegistry {
  private readonly leases = new Map<TaskId, TaskLease>();
  private readonly nowMs: () => number;

  constructor(nowMs: () => number = () => Date.now()) {
    this.nowMs = nowMs;
  }

  lease(taskId: TaskId, runId: RunId, durationMs: number): TaskLease {
    if (this.leases.has(taskId)) {
      throw new DomainValidationError(`Task ${taskId} is already leased`);
    }
    if (!isRunId(runId)) {
      throw new DomainValidationError(`Invalid run id in lease: ${String(runId)}`);
    }
    if (!Number.isInteger(durationMs) || durationMs <= 0) {
      throw new DomainValidationError("Lease duration must be a positive integer");
    }
    const leasedMs = this.nowMs();
    const leasedAt = new Date(leasedMs).toISOString() as IsoTimestamp;
    const expiresAt = new Date(leasedMs + durationMs).toISOString() as IsoTimestamp;
    const lease: TaskLease = { taskId, runId, leasedAt, expiresAt };
    this.leases.set(taskId, lease);
    return lease;
  }

  release(taskId: TaskId): void {
    if (!this.leases.delete(taskId)) {
      throw new DomainValidationError(`Task ${taskId} is not leased`);
    }
  }

  active(taskId: TaskId): TaskLease | undefined {
    return this.leases.get(taskId);
  }

  isExpired(lease: TaskLease): boolean {
    return this.nowMs() >= Date.parse(lease.expiresAt);
  }

  /** Returns leases whose expiry time has passed, without releasing them. */
  expired(): TaskLease[] {
    return Array.from(this.leases.values()).filter((lease) => this.isExpired(lease));
  }

  list(): TaskLease[] {
    return Array.from(this.leases.values());
  }
}

/**
 * Plans one scheduling round: ready tasks in deterministic topological order,
 * capped at maxConcurrentTasks, excluding currently leased tasks. Both PENDING
 * and READY (retried) tasks are schedulable.
 */
export function planRound(
  graph: TaskGraph,
  statusOf: ReadonlyMap<TaskId, TaskStatus> | ((id: TaskId) => TaskStatus),
  maxConcurrentTasks: number,
  _leaseDurationMs: number,
  leases?: LeaseRegistry
): TaskId[] {
  const lookup = (id: TaskId): TaskStatus => {
    if (typeof statusOf === "function") return statusOf(id);
    return statusOf.get(id) ?? "PENDING";
  };
  const ready: TaskId[] = [];
  for (const id of graph.topoOrder) {
    if (ready.length >= maxConcurrentTasks) break;
    const node = graph.byId.get(id);
    if (node === undefined) continue;
    const status = lookup(id);
    if (status !== "PENDING" && status !== "READY") continue;
    if (!allDependenciesSatisfied(node, lookup)) continue;
    if (leases !== undefined && leases.active(id) !== undefined) continue;
    ready.push(id);
  }
  return ready;
}

export interface TaskTransition {
  status: TaskStatus;
  attempt: number;
}

/**
 * Applies a terminal task outcome through the declared state machine:
 * SUCCESS -> COMPLETED; CANCELLED -> CANCELLED; FAILURE/TIMEOUT -> BLOCKED
 * with the attempt incremented, or FAILED when attempts are exhausted
 * (the supervisor may then apply a retry via applyRetry).
 */
export function applyTaskOutcome(
  task: TaskNode,
  outcome: TaskOutcome
): TaskTransition {
  if (!(TASK_OUTCOMES as readonly string[]).includes(outcome)) {
    throw new DomainValidationError(`Unknown task outcome: ${String(outcome)}`);
  }
  switch (outcome) {
    case "SUCCESS":
      return { status: "COMPLETED", attempt: task.attempt };
    case "CANCELLED":
      return { status: "CANCELLED", attempt: task.attempt };
    case "FAILURE":
    case "TIMEOUT": {
      const attempt = task.attempt + 1;
      if (attempt >= task.maxAttempts) {
        return { status: "FAILED", attempt };
      }
      return { status: "BLOCKED", attempt };
    }
  }
}

/** Declared retry transition: BLOCKED -> READY (supervisor decision). */
export function applyRetry(task: TaskNode): TaskTransition {
  if (task.status !== "BLOCKED") {
    throw new DomainValidationError(`Cannot retry task in status ${task.status}`);
  }
  return { status: "READY", attempt: task.attempt };
}

/** Declared skip rule: a task becomes SKIPPED only through this transition. */
export function applySkipped(task: TaskNode): TaskTransition {
  return { status: "SKIPPED", attempt: task.attempt };
}
