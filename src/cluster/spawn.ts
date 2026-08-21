import { DomainValidationError } from "../domain/errors.js";
import { isAgentRole, type AgentRole } from "../domain/roles.js";

export const MAX_SPAWN_DEPTH = 2;
export const MAX_SPAWNS_PER_PARENT = 4;

const PARENT_SPAWN_ALLOWLIST: Record<AgentRole, readonly AgentRole[]> = {
  planner: ["scout", "implementer", "reviewer", "tester", "debugger", "worker"],
  worker: ["scout", "tester", "reviewer"],
  debugger: ["scout", "tester"],
  scout: [],
  implementer: [],
  reviewer: [],
  tester: []
};

export interface SpawnRequest {
  readonly parentRole: AgentRole;
  readonly parentCanDelegate: boolean;
  readonly childRole: string;
  readonly objective: string;
  readonly depth: number;
  readonly spawnsByParent: number;
  readonly liveTaskCount: number;
  readonly maxTasks: number;
}

export function validateSpawn(request: SpawnRequest): AgentRole {
  if (!request.parentCanDelegate) {
    throw new DomainValidationError(`role ${request.parentRole} cannot delegate`);
  }
  if (!isAgentRole(request.childRole)) {
    throw new DomainValidationError(`unknown spawn role: ${request.childRole}`);
  }
  const allowed = PARENT_SPAWN_ALLOWLIST[request.parentRole] ?? [];
  if (!allowed.includes(request.childRole)) {
    throw new DomainValidationError(
      `role ${request.parentRole} cannot spawn ${request.childRole}`
    );
  }
  if (typeof request.objective !== "string" || request.objective.trim() === "") {
    throw new DomainValidationError("spawn objective must be non-empty");
  }
  if (request.depth >= MAX_SPAWN_DEPTH) {
    throw new DomainValidationError(`spawn depth ${request.depth} exceeds max ${MAX_SPAWN_DEPTH}`);
  }
  if (request.spawnsByParent >= MAX_SPAWNS_PER_PARENT) {
    throw new DomainValidationError(`parent already spawned ${MAX_SPAWNS_PER_PARENT} children`);
  }
  if (request.liveTaskCount >= request.maxTasks) {
    throw new DomainValidationError(`cluster is at maxTasks ${request.maxTasks}`);
  }
  return request.childRole;
}
