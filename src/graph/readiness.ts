import type { TaskId } from "../domain/ids.js";
import type { TaskNode } from "../domain/task.js";
import type { TaskStatus } from "../domain/status.js";
import type { TaskGraph } from "./validate.js";

/** A dependency is satisfied when it completed or was explicitly skipped. */
function isSatisfied(status: TaskStatus): boolean {
  return status === "COMPLETED" || status === "SKIPPED";
}

export function allDependenciesSatisfied(
  task: TaskNode,
  statusOf: (id: TaskId) => TaskStatus
): boolean {
  return task.dependencies.every((dep) => isSatisfied(statusOf(dep)));
}

/**
 * Returns the PENDING tasks whose dependencies are all satisfied, in
 * deterministic topological order, capped at `maxConcurrentTasks`.
 */
export function computeReadyTasks(
  graph: TaskGraph,
  statusOf: (id: TaskId) => TaskStatus,
  maxConcurrentTasks = Number.POSITIVE_INFINITY
): TaskId[] {
  const ready: TaskId[] = [];
  for (const id of graph.topoOrder) {
    if (ready.length >= maxConcurrentTasks) break;
    const node = graph.byId.get(id);
    if (node === undefined) continue;
    if (statusOf(id) !== "PENDING") continue;
    if (!allDependenciesSatisfied(node, statusOf)) continue;
    ready.push(id);
  }
  return ready;
}
