import { DomainValidationError, RoutingRefusalError, type RoutingRefusal } from "../domain/errors.js";
import {
  DEFAULT_HUMAN_CONFIDENCE,
  type ApprovalPlan,
  type ConfidenceScore,
  type FlowNode,
  type FlowchartNodeRole,
  type ModelPolicy,
  type TaskComplexity
} from "../domain/flowchart.js";
import type { TaskId } from "../domain/ids.js";
import type { AgentRole } from "../domain/roles.js";
import type { PrivacyClass } from "../routing/capability-registry.js";
import { catalogModel, oneHotDistribution, type CatalogModel, type CatalogModelInput } from "../routing/catalog-model.js";
import { FLOWCHART_FEATURE_VERSION } from "../routing/feature-version.js";
import { liveRefusalMessage, selectLiveModel } from "../routing/live-selection.js";
import { evaluateLiveCandidate } from "../routing/policy.js";

/** Live catalog entry. Alias of the unified CatalogModel. */
export type RoutableModel = CatalogModel;

export interface ModelRouterConfig {
  readonly models: readonly CatalogModelInput[];
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
  /** Flowchart / contract human gate. Independent of high-risk whitelist. */
  readonly approvalRequired?: boolean;
  /** Hard-filters to approvedForHighRisk models when true. */
  readonly highRisk?: boolean;
  readonly family?: string;
  readonly featureVersion?: string;
  readonly agentRole?: AgentRole;
  readonly requiredCapabilities?: readonly string[];
  readonly privacyRequired?: PrivacyClass;
  readonly contextNeeded?: number;
  readonly outputNeeded?: number;
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
  /** Event-compat alias of coldStartRoutingScore. Not a calibrated probability. */
  readonly confidence: ConfidenceScore;
  readonly coldStartRoutingScore: ConfidenceScore;
  readonly approvalPlan: ApprovalPlan;
  readonly statusAfterRoute: RoutingStatusAfter;
  readonly policyVersion: string;
  readonly estimatedCostUsd: number;
  readonly estimatedDurationMs: number;
  readonly family: string;
  readonly featureVersion: string;
  readonly modelVersion: string;
  readonly highRisk: boolean;
  readonly eligibleModels: readonly string[];
  readonly rejections: readonly RoutingRefusal[];
  readonly behaviorDistribution: Readonly<Record<string, number>>;
  readonly agentRole?: AgentRole | undefined;
  readonly preferredConstraint?: string | undefined;
}

export interface ModelRouter {
  readonly config: ModelRouterConfig & { readonly models: readonly CatalogModel[] };
  /**
   * Live static routing. Hard filter is evaluateLiveCandidate (same matrix as
   * library R0). Ranking is preferred constraint then cheapest eligible.
   * Adaptive R1/bandit routers must stay in shadow experiments, not this path.
   */
  route(input: RouteTaskInput): RoutingDecision;
}

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
  validateScore(floor, "confidence floor");
  const candidates = [floor];
  if (thresholds.nodeThreshold !== undefined) {
    candidates.push(validateScore(thresholds.nodeThreshold, "confidenceThreshold"));
  }
  if (thresholds.runMinHumanConfidence !== undefined) {
    candidates.push(validateScore(thresholds.runMinHumanConfidence, "minHumanConfidence"));
  }
  if (thresholds.routerDefaultThreshold !== undefined) {
    candidates.push(validateScore(thresholds.routerDefaultThreshold, "defaultThreshold"));
  }
  return Math.max(...candidates) as ConfidenceScore;
}

function validateScore(value: number, label: string): ConfidenceScore {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new DomainValidationError(`${label} must be a finite number between 0 and 1`);
  }
  return value as ConfidenceScore;
}

function validateConfig(config: ModelRouterConfig): readonly CatalogModel[] {
  if (typeof config.policyVersion !== "string" || config.policyVersion.trim() === "") {
    throw new DomainValidationError("ModelRouter policyVersion must be non-empty");
  }
  if (!Array.isArray(config.models) || config.models.length === 0) {
    throw new DomainValidationError("ModelRouter requires an explicit non-empty model catalog");
  }
  const models = config.models.map((model) => catalogModel(model));
  const ids = new Set<string>();
  for (const model of models) {
    if (ids.has(model.id)) {
      throw new DomainValidationError("ModelRouter model ids must be unique and non-empty");
    }
    ids.add(model.id);
    if (!Array.isArray(model.roles) || model.roles.length === 0) {
      throw new DomainValidationError(`ModelRouter model ${model.id} must declare roles`);
    }
    if (new Set(model.roles).size !== model.roles.length) {
      throw new DomainValidationError(`ModelRouter model ${model.id} declares duplicate roles`);
    }
    const unknownRole = model.roles.find((role) => !ROLES.includes(role));
    if (unknownRole !== undefined) {
      throw new DomainValidationError(`ModelRouter model ${model.id} declares unknown role: ${String(unknownRole)}`);
    }
  }
  if (config.defaultThreshold !== undefined) {
    validateScore(config.defaultThreshold, "ModelRouter defaultThreshold");
  }
  return models;
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
  if (!["LOW", "MEDIUM", "HIGH"].includes(input.complexity)) {
    throw new DomainValidationError("Route complexity is invalid");
  }
  if (!Number.isFinite(input.limits.remainingTimeMs) || input.limits.remainingTimeMs < 0) {
    throw new DomainValidationError("remainingTimeMs must be a non-negative finite number");
  }
  if (input.limits.remainingCostUsd !== undefined &&
      (!Number.isFinite(input.limits.remainingCostUsd) || input.limits.remainingCostUsd < 0)) {
    throw new DomainValidationError("remainingCostUsd must be a non-negative finite number");
  }
  if (input.confidenceThreshold !== undefined) validateScore(input.confidenceThreshold, "confidenceThreshold");
  if (input.limits.minHumanConfidence !== undefined) {
    validateScore(input.limits.minHumanConfidence, "minHumanConfidence");
  }
}

/** Cold-start lookup. Not a calibrated probability and not an approval gate. */
export function coldStartRoutingScore(complexity: TaskComplexity, preferred: boolean): ConfidenceScore {
  const base = complexity === "LOW" ? 0.9 : complexity === "MEDIUM" ? 0.8 : 0.68;
  return Math.min(1, base + (preferred ? 0.04 : 0)) as ConfidenceScore;
}

function makeApprovalPlan(taskId: TaskId, model: CatalogModel): ApprovalPlan {
  return {
    id: `approval:${taskId}:${model.id}`,
    items: [
      { id: `route:${model.id}`, label: `Use ${model.id}`, selectable: true, defaultSelected: true },
      { id: "route:cancel", label: "Do not run this task", selectable: true, defaultSelected: false }
    ]
  };
}

/** RouteTaskInput with every documented default resolved exactly once. */
interface ResolvedRouteRequest {
  readonly highRisk: boolean;
  readonly family: string;
  readonly featureVersion: string;
  readonly privacyRequired: PrivacyClass;
  readonly requiredCapabilities: readonly string[];
  readonly contextNeeded: number;
  readonly outputNeeded: number;
  readonly budgetUsd: number;
  readonly deadlineMs: number;
}

function resolveRouteDefaults(input: RouteTaskInput): ResolvedRouteRequest {
  return {
    highRisk: input.highRisk === true,
    family: input.family ?? "unknown",
    featureVersion: input.featureVersion ?? FLOWCHART_FEATURE_VERSION,
    privacyRequired: input.privacyRequired ?? "cloud-general",
    requiredCapabilities: input.requiredCapabilities ?? ["tool-use"],
    contextNeeded: input.contextNeeded ?? 0,
    outputNeeded: input.outputNeeded ?? 0,
    budgetUsd: input.limits.remainingCostUsd ?? Number.POSITIVE_INFINITY,
    deadlineMs: input.limits.remainingTimeMs
  };
}

/**
 * Hard filter over the in-policy catalog slice, in catalog order. Eligibility
 * is evaluateLiveCandidate — the same matrix as library R0 — and every failure
 * is kept so nothing is dropped silently.
 */
function partitionLiveCandidates(
  models: readonly CatalogModel[],
  input: RouteTaskInput,
  resolved: ResolvedRouteRequest
): { readonly eligible: readonly CatalogModel[]; readonly refusals: readonly RoutingRefusal[] } {
  const allowed = new Set(input.modelPolicy.allowedModels);
  const eligible: CatalogModel[] = [];
  const refusals: RoutingRefusal[] = [];
  for (const model of models) {
    if (!allowed.has(model.id)) continue;
    const check = evaluateLiveCandidate(model, {
      role: input.role,
      complexity: input.complexity,
      taskFamily: resolved.family,
      privacyRequired: resolved.privacyRequired,
      requiredCapabilities: resolved.requiredCapabilities,
      contextNeeded: resolved.contextNeeded,
      outputNeeded: resolved.outputNeeded,
      budgetUsd: resolved.budgetUsd,
      deadlineMs: resolved.deadlineMs,
      highRisk: resolved.highRisk,
      fixedCostUsd: model.estimatedCostUsd,
      fixedLatencyMs: model.estimatedDurationMs
    });
    if (check.eligible) {
      eligible.push(model);
    } else {
      refusals.push(...check.failures);
    }
  }
  return { eligible, refusals };
}

function buildDecision(
  policyVersion: string,
  input: RouteTaskInput,
  resolved: ResolvedRouteRequest,
  selected: CatalogModel,
  eligible: readonly CatalogModel[],
  refusals: readonly RoutingRefusal[]
): RoutingDecision {
  const preferredModel = input.modelPolicy.preferredModel;
  const preferred = selected.id === preferredModel;
  const score = coldStartRoutingScore(input.complexity, preferred);
  const approvalRequired = input.approvalRequired ?? false;
  const statusAfterRoute: RoutingStatusAfter = approvalRequired ? "WAITING_FOR_USER" : "RUNNING";
  const preferredNote = preferred
    ? `; preferred constraint ${preferredModel}`
    : "";
  const justification =
    `${selected.id} is allowed for role ${input.role} and ${input.complexity} complexity; ` +
    `estimated cost ${selected.estimatedCostUsd} USD and duration ${selected.estimatedDurationMs} ms fit remaining limits` +
    preferredNote;

  const eligibleModels = eligible.map((model) => model.id);
  return {
    eventType: "MODEL_ROUTED",
    taskId: input.taskId,
    role: input.role,
    complexity: input.complexity,
    model: selected.id,
    justification,
    confidence: score,
    coldStartRoutingScore: score,
    approvalPlan: makeApprovalPlan(input.taskId, selected),
    statusAfterRoute,
    policyVersion,
    estimatedCostUsd: selected.estimatedCostUsd,
    estimatedDurationMs: selected.estimatedDurationMs,
    family: resolved.family,
    featureVersion: resolved.featureVersion,
    modelVersion: selected.version,
    highRisk: resolved.highRisk,
    eligibleModels,
    rejections: refusals,
    behaviorDistribution: oneHotDistribution(eligibleModels, selected.id),
    ...(input.agentRole !== undefined ? { agentRole: input.agentRole } : {}),
    ...(preferred && preferredModel !== undefined ? { preferredConstraint: preferredModel } : {})
  };
}

export function createModelRouter(config: ModelRouterConfig): ModelRouter {
  const models = validateConfig(config);
  const catalogIds = new Set(models.map((model) => model.id));
  return {
    config: { ...config, models },
    route(input): RoutingDecision {
      validateInput(input);
      const unknownPolicyModel = input.modelPolicy.allowedModels.find((id) => !catalogIds.has(id));
      if (unknownPolicyModel !== undefined) {
        throw new DomainValidationError(`Model policy references unavailable model: ${unknownPolicyModel}`);
      }
      const resolved = resolveRouteDefaults(input);
      const { eligible, refusals } = partitionLiveCandidates(models, input, resolved);
      if (eligible.length === 0) {
        throw new RoutingRefusalError(
          liveRefusalMessage({ role: input.role, complexity: input.complexity, highRisk: resolved.highRisk }, refusals),
          refusals
        );
      }
      const selected = selectLiveModel(eligible, input.modelPolicy.preferredModel);
      return buildDecision(config.policyVersion, input, resolved, selected, eligible, refusals);
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
    family: "unknown",
    featureVersion: FLOWCHART_FEATURE_VERSION,
    limits
  });
}
