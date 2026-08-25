import { readFile } from "node:fs/promises";
import { createAgentProfileRegistry, defaultAgentProfiles } from "../agents/registry.js";
import { DomainValidationError } from "../domain/errors.js";
import { isArtifactId, parseTaskId, type TaskId } from "../domain/ids.js";
import { isAgentRole } from "../domain/roles.js";
import type { ChildTaskInput } from "../run/child-coordinator.js";

/**
 * A declared per-child USD ceiling is load-bearing: the child coordinator
 * forwards the tighter of it and the run-level cap to the executor and stamps
 * it into the child's RUN_CREATED. Dropping it would give the operator a
 * silent exit 0 with no ceiling anywhere on disk; copying an invalid one would
 * surface as a protocol-validation failure far from the file they wrote. So
 * anything present that is not a positive finite number is refused here, by
 * task.
 */
export function parseChildCostCeiling(taskId: TaskId, value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new DomainValidationError(
      `Child task ${taskId}: limits.maxCostUsd must be a positive finite number`
    );
  }
  return value;
}

/** Parses a --children spec file into validated ChildTaskInput values. */
export async function parseChildSpec(path: string): Promise<ChildTaskInput[]> {
  const raw = await readFile(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new DomainValidationError(
      `Invalid child spec ${path}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { tasks?: unknown }).tasks)) {
    throw new DomainValidationError("Child spec must be { \"tasks\": [...] }");
  }
  const registry = createAgentProfileRegistry(defaultAgentProfiles());
  const tasks = (parsed as { tasks: unknown[] }).tasks;
  const seen = new Set<TaskId>();
  return tasks.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new DomainValidationError(`Child task ${index} must be an object`);
    }
    const task = entry as Record<string, unknown>;
    const taskId = parseTaskId(task.id);
    if (seen.has(taskId)) throw new DomainValidationError(`Duplicate child task id: ${taskId}`);
    seen.add(taskId);
    if (typeof task.role !== "string" || !isAgentRole(task.role)) {
      throw new DomainValidationError(`Child task ${taskId}: role must be a known AgentRole`);
    }
    if (typeof task.objective !== "string" || task.objective.trim() === "") {
      throw new DomainValidationError(`Child task ${taskId}: objective must be a non-empty string`);
    }
    const acceptanceCriteria = Array.isArray(task.acceptanceCriteria)
      ? task.acceptanceCriteria.map((criterion) => {
          if (typeof criterion !== "object" || criterion === null) {
            throw new DomainValidationError(`Child task ${taskId}: acceptanceCriteria must be objects`);
          }
          const c = criterion as Record<string, unknown>;
          if (typeof c.id !== "string" || c.id === "" || typeof c.description !== "string" || c.description === "") {
            throw new DomainValidationError(`Child task ${taskId}: acceptanceCriteria need {id, description}`);
          }
          return { id: c.id, description: c.description };
        })
      : [];
    const inputArtifactIds = Array.isArray(task.inputArtifactIds)
      ? task.inputArtifactIds.map((id) => {
          if (!isArtifactId(id)) throw new DomainValidationError(`Child task ${taskId}: invalid inputArtifactId`);
          return id;
        })
      : [];
    const limits = task.limits as Record<string, unknown> | undefined;
    const maxCostUsd = parseChildCostCeiling(taskId, limits?.maxCostUsd);
    const profile = registry.resolve(task.role);
    const dependsOn = Array.isArray(task.dependsOn)
      ? task.dependsOn.map((id) => parseTaskId(id))
      : undefined;
    return {
      taskId,
      role: task.role,
      objective: task.objective,
      profile,
      inputArtifactIds,
      acceptanceCriteria,
      limits: {
        maxAttempts: typeof limits?.maxAttempts === "number" ? limits.maxAttempts : 1,
        timeoutMs: typeof limits?.timeoutMs === "number" ? limits.timeoutMs : 60_000,
        maxWallTimeMs: typeof limits?.maxWallTimeMs === "number" ? limits.maxWallTimeMs : 3_600_000,
        ...(maxCostUsd !== undefined ? { maxCostUsd } : {})
      },
      ...(dependsOn !== undefined ? { dependsOn } : {})
    };
  });
}
