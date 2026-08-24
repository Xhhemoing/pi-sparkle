import { DomainValidationError } from "../domain/errors.js";
import { isTaskId, type TaskId } from "../domain/ids.js";
import type { TaskNode } from "../domain/task.js";

export interface TaskGraph {
  tasks: readonly TaskNode[];
  byId: ReadonlyMap<TaskId, TaskNode>;
  /** Deterministic topological order (dependencies first). */
  topoOrder: readonly TaskId[];
}

function orderLabel(id: TaskId): string {
  return id;
}

/** Validates a task collection as a DAG before any worker starts. */
export function validateTaskGraph(tasks: readonly TaskNode[]): TaskGraph {
  if (tasks.length === 0) {
    throw new DomainValidationError("Task graph must contain at least one task");
  }

  const byId = new Map<TaskId, TaskNode>();
  for (const node of tasks) {
    if (byId.has(node.id)) {
      throw new DomainValidationError(`Duplicate TaskId in graph: ${node.id}`);
    }
    byId.set(node.id, node);
  }

  for (const node of tasks) {
    if (node.dependencies.includes(node.id)) {
      throw new DomainValidationError(`Task ${orderLabel(node.id)} depends on itself`);
    }
    for (const dep of node.dependencies) {
      if (!isTaskId(dep) || !byId.has(dep)) {
        throw new DomainValidationError(`Task ${orderLabel(node.id)} references missing dependency ${orderLabel(dep)}`);
      }
    }
  }

  // Kahn's algorithm: deterministic (input order) topological sort; leftover
  // nodes indicate a cycle.
  const inDegree = new Map<TaskId, number>();
  const dependents = new Map<TaskId, TaskId[]>();
  for (const node of tasks) {
    inDegree.set(node.id, node.dependencies.length);
    dependents.set(node.id, []);
  }
  for (const node of tasks) {
    for (const dep of node.dependencies) {
      dependents.get(dep)?.push(node.id);
    }
  }

  const queue: TaskId[] = tasks.filter((node) => (inDegree.get(node.id) ?? 0) === 0).map((node) => node.id);
  const order: TaskId[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const dependent of dependents.get(id) ?? []) {
      const remaining = (inDegree.get(dependent) ?? 1) - 1;
      inDegree.set(dependent, remaining);
      if (remaining === 0) queue.push(dependent);
    }
  }

  if (order.length !== tasks.length) {
    const cyclic = tasks.filter((node) => (inDegree.get(node.id) ?? 0) > 0).map((node) => orderLabel(node.id));
    throw new DomainValidationError(`Task graph contains a cycle involving: ${cyclic.join(", ")}`);
  }

  return { tasks: [...tasks], byId, topoOrder: order };
}
