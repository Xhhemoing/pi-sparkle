import { DomainValidationError } from "../domain/errors.js";
import {
  DEFAULT_HUMAN_CONFIDENCE,
  defaultDecisionPolicy,
  validateConfidenceScore,
  type ApprovalPlan,
  type ConfidenceScore,
  type FlowNode,
  type FlowchartNodeRole,
  type ModelPolicy,
  type TaskComplexity
} from "../domain/flowchart.js";
import type { TaskId } from "../domain/ids.js";

export interface RoutableModel {
  readonly id: string;
  readonly roles: readonly FlowchartNodeRole[];
  readonly maxComplexity: TaskComplexity;
  readonly estimatedCostUsd: number;
  readonly estimatedDurationMs: number;
}

export interface ModelRouterConfig {
  readonly models: readonly RoutableModel[];
  readonly policyVersion: string;
  readonly defaultThreshold?: ConfidenceScore;
}

export interface RoutingLimits {
  readonly remainingCostUsd?: number;
  readonly remainingTimeMs: number;
  readonly minHumanConfidence?: ConfidenceScore;
}

export interface RouteTaskInput {
  readonly taskId: TaskId;
  readonly role: FlowchartNodeRole;
  readonly complexity: TaskComplexity;
  readonly modelPolicy: ModelPolicy;
  readonly confidenceThreshold?: ConfidenceScore;
  readonly approvalRequired?: boolean;
  readonly limits: RoutingLimits;
}

export type RoutingStatusAfter = "RUNNING" | "WAITING_FOR_USER";

export interface RoutingDecision {
  readonly eventType: "MODEL_ROUTED";
  readonly taskId: TaskId;
  readonly role: FlowchartNodeRole;
  readonly complexity: TaskComplexity;
  readonly model: string;
  readonly justification: string;
  readonly confidence: ConfidenceScore;
  readonly approvalPlan: ApprovalPlan;
  readonly statusAfterRoute: RoutingStatusAfter;
  readonly policyVersion: string;
  readonly estimatedCostUsd: number;
  readonly estimatedDurationMs: number;
}

export interface ModelRouter {
  readonly config: ModelRouterConfig;
  route(input: RouteTaskInput): RoutingDecision;
}

const COMPLEXITY_RANK: Record<TaskComplexity, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2
};

const ROLES: readonly FlowchartNodeRole[] = ["actor", "critic", "router", "judge", "tool", "human"];

/**
 * The effective gate is the strictest of every declared threshold, so a lax
 * node policy can never weaken a run-level or default floor.
 */
export function effectiveConfidenceThreshold(
  thresholds: {
    readonly nodeThreshold?: ConfidenceScore;
    readonly runMinHumanConfidence?: ConfidenceScore;
    readonly routerDefaultThreshold?: ConfidenceScore;
  },
  floor: ConfidenceScore = DEFAULT_HUMAN_CONFIDENCE
): ConfidenceScore {
  validateConfidenceScore(floor, "confidence floor");
  const candidates = [floor];
  if (thresholds.nodeThreshold !== undefined) {
    candidates.push(validateConfidenceScore(thresholds.nodeThreshold, "confidenceThreshold"));
  }
  if (thresholds.runMinHumanConfidence !== undefined) {
    candidates.push(validateConfidenceScore(thresholds.runMinHumanConfidence, "minHumanConfidence"));
  }
  if (thresholds.routerDefaultThreshold !== undefined) {
    candidates.push(validateConfidenceScore(thresholds.routerDefaultThreshold, "defaultThreshold"));
  }
  return Math.max(...candidates);
}

function validateConfig(config: ModelRouterConfig): void {
  if (typeof config.policyVersion !== "string" || config.policyVersion.trim() === "") {
    throw new DomainValidationError("ModelRouter policyVersion must be non-empty");
  }
  if (!Array.isArray(config.models) || config.models.length === 0) {
    throw new DomainValidationError("ModelRouter requires an explicit non-empty model catalog");
  }
  const ids = new Set<string>();
  for (const model of config.models) {
    if (typeof model.id !== "string" || model.id.trim() === "" || ids.has(model.id)) {
      throw new DomainValidationError("ModelRouter model ids must be unique and non-empty");
    }
    ids.add(model.id);
    if (!Array.isArray(model.roles) || model.roles.length === 0) {
      throw new DomainValidationError(`ModelRouter model ${model.id} must declare roles`);
    }
    if (new Set(model.roles).size !== model.roles.length) {
      throw new DomainValidationError(`ModelRouter model ${model.id} declares duplicate roles`);
    }
    const unknownRole = (model.roles as readonly FlowchartNodeRole[]).find((role) => !ROLES.includes(role));
    if (unknownRole !== undefined) {
      throw new DomainValidationError(`ModelRouter model ${model.id} declares unknown role: ${String(unknownRole)}`);
    }
    if (!(model.maxComplexity in COMPLEXITY_RANK)) {
      throw new DomainValidationError(`ModelRouter model ${model.id} has invalid maxComplexity`);
    }
    if (!Number.isFinite(model.estimatedCostUsd) || model.estimatedCostUsd < 0) {
      throw new DomainValidationError(`ModelRouter model ${model.id} has invalid estimatedCostUsd`);
    }
    if (!Number.isFinite(model.estimatedDurationMs) || model.estimatedDurationMs <= 0) {
      throw new DomainValidationError(`ModelRouter model ${model.id} has invalid estimatedDurationMs`);
    }
  }
  if (config.defaultThreshold !== undefined) {
    validateConfidenceScore(config.defaultThreshold, "ModelRouter defaultThreshold");
  }
}

function validateInput(input: RouteTaskInput): void {
  if (!Array.isArray(input.modelPolicy.allowedModels) || input.modelPolicy.allowedModels.length === 0 ||
      !input.modelPolicy.allowedModels.every((id) => typeof id === "string" && id.trim() !== "")) {
    throw new DomainValidationError("Route modelPolicy.allowedModels must be a non-empty string array");
  }
  if (input.modelPolicy.preferredModel !== undefined &&
      !input.modelPolicy.allowedModels.includes(input.modelPolicy.preferredModel)) {
    throw new DomainValidationError("Route preferredModel must be in allowedModels");
  }
  if (!(input.complexity in COMPLEXITY_RANK)) throw new DomainValidationError("Route complexity is invalid");
  if (!Number.isFinite(input.limits.remainingTimeMs) || input.limits.remainingTimeMs < 0) {
    throw new DomainValidationError("remainingTimeMs must be a non-negative finite number");
  }
  if (input.limits.remainingCostUsd !== undefined &&
      (!Number.isFinite(input.limits.remainingCostUsd) || input.limits.remainingCostUsd < 0)) {
    throw new DomainValidationError("remainingCostUsd must be a non-negative finite number");
  }
  if (input.confidenceThreshold !== undefined) validateConfidenceScore(input.confidenceThreshold);
  if (input.limits.minHumanConfidence !== undefined) {
    validateConfidenceScore(input.limits.minHumanConfidence, "minHumanConfidence");
  }
}

function routeConfidence(complexity: TaskComplexity, preferred: boolean): ConfidenceScore {
  const base = complexity === "LOW" ? 0.9 : complexity === "MEDIUM" ? 0.8 : 0.68;
  return Math.min(1, base + (preferred ? 0.04 : 0)) as ConfidenceScore;
}

function makeApprovalPlan(taskId: TaskId, model: RoutableModel): ApprovalPlan {
  return {
    id: `approval:${taskId}:${model.id}`,
    items: [
      { id: `route:${model.id}`, label: `Use ${model.id}`, selectable: true, defaultSelected: true },
      { id: "route:cancel", label: "Do not run this task", selectable: true, defaultSelected: false }
    ]
  };
}

export function createModelRouter(config: ModelRouterConfig): ModelRouter {
  validateConfig(config);
  return {
    config,
    route(input): RoutingDecision {
      validateInput(input);
      const catalogIds = new Set(config.models.map((model) => model.id));
      const unknownPolicyModel = input.modelPolicy.allowedModels.find((id) => !catalogIds.has(id));
      if (unknownPolicyModel !== undefined) {
        throw new DomainValidationError(`Model policy references unavailable model: ${unknownPolicyModel}`);
      }

      const roleAndComplexity = config.models.filter((model) =>
        input.modelPolicy.allowedModels.includes(model.id) &&
        model.roles.includes(input.role) &&
        COMPLEXITY_RANK[model.maxComplexity] >= COMPLEXITY_RANK[input.complexity]
      );
      if (roleAndComplexity.length === 0) {
        throw new DomainValidationError(`No allowed model satisfies role ${input.role} and complexity ${input.complexity}`);
      }

      const withinLimits = roleAndComplexity.filter((model) =>
        model.estimatedDurationMs <= input.limits.remainingTimeMs &&
        (input.limits.remainingCostUsd === undefined || model.estimatedCostUsd <= input.limits.remainingCostUsd)
      );
      if (withinLimits.length === 0) {
        throw new DomainValidationError("No allowed model fits the remaining cost and time limits");
      }

      const preferredModel = input.modelPolicy.preferredModel;
      const selected = [...withinLimits].sort((left, right) => {
        const preferredDifference =
          Number(right.id === preferredModel) - Number(left.id === preferredModel);
        if (preferredDifference !== 0) return preferredDifference;
        const complexityDifference =
          COMPLEXITY_RANK[left.maxComplexity] - COMPLEXITY_RANK[right.maxComplexity];
        if (complexityDifference !== 0) return complexityDifference;
        const costDifference = left.estimatedCostUsd - right.estimatedCostUsd;
        if (costDifference !== 0) return costDifference;
        return left.id.localeCompare(right.id);
      })[0]!;

      const confidence = routeConfidence(input.complexity, selected.id === preferredModel);
      const threshold = effectiveConfidenceThreshold({
        ...(input.confidenceThreshold !== undefined ? { nodeThreshold: input.confidenceThreshold } : {}),
        ...(input.limits.minHumanConfidence !== undefined
          ? { runMinHumanConfidence: input.limits.minHumanConfidence }
          : {}),
        ...(config.defaultThreshold !== undefined ? { routerDefaultThreshold: config.defaultThreshold } : {})
      });
      const decisionPolicy = defaultDecisionPolicy(threshold);
      const approvalRequired = input.approvalRequired ?? false;
      const statusAfterRoute = decisionPolicy.requiresApproval(confidence, approvalRequired)
        ? "WAITING_FOR_USER"
        : "RUNNING";
      const justification =
        `${selected.id} is allowed for role ${input.role} and ${input.complexity} complexity; ` +
        `estimated cost ${selected.estimatedCostUsd} USD and duration ${selected.estimatedDurationMs} ms fit remaining limits`;

      return {
        eventType: "MODEL_ROUTED",
        taskId: input.taskId,
        role: input.role,
        complexity: input.complexity,
        model: selected.id,
        justification,
        confidence,
        approvalPlan: makeApprovalPlan(input.taskId, selected),
        statusAfterRoute,
        policyVersion: config.policyVersion,
        estimatedCostUsd: selected.estimatedCostUsd,
        estimatedDurationMs: selected.estimatedDurationMs
      };
    }
  };
}

export function routeTask(router: ModelRouter, input: RouteTaskInput): RoutingDecision {
  return router.route(input);
}

export function routeFlowNode(
  router: ModelRouter,
  node: FlowNode,
  complexity: TaskComplexity,
  limits: RoutingLimits
): RoutingDecision {
  return router.route({
    taskId: node.taskId,
    role: node.role,
    complexity,
    modelPolicy: node.modelPolicy,
    confidenceThreshold: node.confidenceThreshold,
    approvalRequired: node.approvalRequired,
    limits
  });
}
