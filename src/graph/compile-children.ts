import { DomainValidationError } from "../domain/errors.js";
import {
  DEFAULT_HUMAN_CONFIDENCE,
  validateConfidenceScore,
  validateFlowchart,
  type FlowEdge,
  type FlowNode,
  type Flowchart,
  type FlowchartNodeRole
} from "../domain/flowchart.js";
import { isAgentRole, type AgentRole } from "../domain/roles.js";
import type { TaskId } from "../domain/ids.js";

const DEFAULT_ALLOWED_MODELS = ["cheap", "premium"] as const;
const DEFAULT_PREFERRED_MODEL = "cheap";

export interface CompilableChild {
  readonly taskId: TaskId;
  readonly role: AgentRole;
  readonly objective: string;
  readonly dependsOn?: readonly TaskId[];
  readonly preferredModel?: string;
  readonly allowedModels?: readonly string[];
}

export interface CompileChildrenOptions {
  readonly flowchartId?: string;
  readonly allowedModels?: readonly string[];
  readonly preferredModel?: string;
  readonly confidenceThreshold?: number;
}

export function compilableChildFrom(input: {
  readonly taskId: TaskId;
  readonly role: string;
  readonly objective: string;
  readonly dependsOn?: readonly TaskId[];
}): CompilableChild {
  if (!isAgentRole(input.role)) {
    throw new DomainValidationError(`role must be a known AgentRole: ${input.role}`);
  }
  return {
    taskId: input.taskId,
    role: input.role,
    objective: input.objective,
    ...(input.dependsOn !== undefined ? { dependsOn: input.dependsOn } : {})
  };
}

export function flowchartRoleForAgentRole(role: AgentRole): FlowchartNodeRole {
  return role === "reviewer" ? "critic" : "actor";
}

/** Inverse used by live flowchart routing so analyzeTask sees a real AgentRole. */
export function agentRoleForFlowchartRole(role: FlowchartNodeRole): AgentRole {
  if (role === "critic" || role === "judge") return "reviewer";
  if (role === "router") return "planner";
  if (role === "tool") return "tester";
  return "implementer";
}

function nodeIdOf(taskId: TaskId): string {
  return taskId;
}

/**
 * Compiles a `--children` task spec into the canonical flowchart orchestrator.
 * Independent roots share parallelGroup `children`. Sequential `dependsOn`
 * becomes success edges; two or more deps become an all-join.
 */
export function compileChildrenToFlowchart(
  children: readonly CompilableChild[],
  options: CompileChildrenOptions = {}
): Flowchart {
  if (children.length === 0) {
    throw new DomainValidationError("children spec must contain at least one task");
  }

  const byId = new Map<TaskId, CompilableChild>();
  for (const child of children) {
    if (byId.has(child.taskId)) {
      throw new DomainValidationError(`Duplicate child task id: ${child.taskId}`);
    }
    byId.set(child.taskId, child);
  }

  const allowedModels = options.allowedModels ?? DEFAULT_ALLOWED_MODELS;
  const preferredModel = options.preferredModel ?? DEFAULT_PREFERRED_MODEL;
  if (!allowedModels.includes(preferredModel)) {
    throw new DomainValidationError(`preferredModel ${preferredModel} must be in allowedModels`);
  }
  const confidenceThreshold = validateConfidenceScore(
    options.confidenceThreshold ?? DEFAULT_HUMAN_CONFIDENCE,
    "confidenceThreshold"
  );

  const edges: FlowEdge[] = [];
  for (const child of children) {
    const deps = child.dependsOn ?? [];
    const seen = new Set<TaskId>();
    for (const dep of deps) {
      if (dep === child.taskId) {
        throw new DomainValidationError(`Task ${child.taskId} depends on itself`);
      }
      if (!byId.has(dep)) {
        throw new DomainValidationError(`Task ${child.taskId} references missing dependency ${dep}`);
      }
      if (seen.has(dep)) {
        throw new DomainValidationError(`Task ${child.taskId} has a duplicate dependency ${dep}`);
      }
      seen.add(dep);
      edges.push({
        from: nodeIdOf(dep),
        to: nodeIdOf(child.taskId),
        condition: { type: "success", expected: true }
      });
    }
  }

  const rootCount = children.filter((child) => (child.dependsOn ?? []).length === 0).length;

  const nodes: FlowNode[] = children.map((child) => {
    const deps = child.dependsOn ?? [];
    const isRoot = deps.length === 0;
    const nodeAllowed = child.allowedModels ?? allowedModels;
    const nodePreferred = child.preferredModel ?? preferredModel;
    if (!nodeAllowed.includes(nodePreferred)) {
      throw new DomainValidationError(
        `preferredModel ${nodePreferred} must be in allowedModels for ${child.taskId}`
      );
    }
    const node: FlowNode = {
      id: nodeIdOf(child.taskId),
      taskId: child.taskId,
      role: flowchartRoleForAgentRole(child.role),
      objective: child.objective,
      modelPolicy: { allowedModels: nodeAllowed, preferredModel: nodePreferred },
      confidenceThreshold,
      approvalRequired: false,
      ...(isRoot && rootCount > 1 ? { parallelGroup: "children" } : {}),
      ...(deps.length >= 2
        ? { joinPolicy: { mode: "all" as const, requiredNodeIds: deps.map(nodeIdOf) } }
        : {})
    };
    return node;
  });

  return validateFlowchart({
    id: options.flowchartId ?? "children",
    nodes,
    edges
  });
}
