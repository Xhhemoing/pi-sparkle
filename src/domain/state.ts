import { DomainValidationError } from "./errors.js";
import type { RunStatus, TaskStatus } from "./status.js";

export const RUN_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  PLANNING: ["RUNNING"],
  RUNNING: ["WAITING_FOR_USER", "PAUSED", "BLOCKED", "COMPLETED", "FAILED", "CANCELLED"],
  WAITING_FOR_USER: ["RUNNING", "PAUSED", "BLOCKED", "CANCELLED"],
  PAUSED: ["RUNNING", "WAITING_FOR_USER", "CANCELLED"],
  BLOCKED: ["RUNNING", "CANCELLED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: []
};

// RUNNING -> CANCELLED amends the spec diagram: the coordinator settles an
// in-flight child task as CANCELLED when its run is cancelled (M1-AC2).
export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  PENDING: ["READY", "CANCELLED"],
  READY: ["RUNNING", "CANCELLED"],
  RUNNING: ["COMPLETED", "SKIPPED", "BLOCKED", "CANCELLED"],
  BLOCKED: ["READY", "FAILED", "CANCELLED"],
  COMPLETED: [],
  SKIPPED: [],
  FAILED: [],
  CANCELLED: []
};

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  const allowed = RUN_TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}

export function assertTransitionRun(from: RunStatus, to: RunStatus): void {
  if (!canTransitionRun(from, to)) {
    throw new DomainValidationError(`Illegal RunStatus transition: ${from} -> ${to}`);
  }
}

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  const allowed = TASK_TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}

export function assertTransitionTask(from: TaskStatus, to: TaskStatus): void {
  if (!canTransitionTask(from, to)) {
    throw new DomainValidationError(`Illegal TaskStatus transition: ${from} -> ${to}`);
  }
}

/**
 * Shortest legal path from `from` to `to`. Direct edges stay one step;
 * PENDING → RUNNING expands through READY, and RUNNING → FAILED through BLOCKED.
 */
export function expandTaskTransition(from: TaskStatus, to: TaskStatus): TaskStatus[] {
  if (from === to) return [];
  if (canTransitionTask(from, to)) return [to];
  const queue: TaskStatus[][] = [[from]];
  const seen = new Set<TaskStatus>([from]);
  while (queue.length > 0) {
    const path = queue.shift();
    if (path === undefined) break;
    const current = path[path.length - 1];
    if (current === undefined) continue;
    for (const next of TASK_TRANSITIONS[current]) {
      if (seen.has(next)) continue;
      const nextPath = [...path, next];
      if (next === to) return nextPath.slice(1);
      seen.add(next);
      queue.push(nextPath);
    }
  }
  throw new DomainValidationError(`Illegal TaskStatus transition: ${from} -> ${to}`);
}
