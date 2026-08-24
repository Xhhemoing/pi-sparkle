import type { FlowchartNodeRole, TaskComplexity } from "../domain/flowchart.js";
import type { ModelDescriptor } from "./capability-registry.js";
import {
  estimateCostUsd,
  estimateLatencyMs,
  hasCapability,
  satisfiesPrivacy,
} from "./capability-registry.js";
import type { PrivacyClass } from "./capability-registry.js";
import { toModelDescriptor, type CatalogModel } from "./catalog-model.js";

export interface RouteRequest {
  readonly taskFamily: string;
  readonly privacyRequired: PrivacyClass;
  readonly requiredCapabilities: readonly string[];
  readonly contextNeeded: number;
  readonly outputNeeded: number;
  readonly budgetUsd: number;
  readonly deadlineMs: number;
  readonly highRisk: boolean;
  /** Used when token sizes are 0 so live static catalog costs still gate. */
  readonly fixedCostUsd?: number | undefined;
  readonly fixedLatencyMs?: number | undefined;
}

export interface ConstraintFailure {
  readonly modelId: string;
  readonly constraint: string;
  readonly detail: string;
}

export interface CandidateCheck {
  readonly modelId: string;
  readonly eligible: boolean;
  readonly failures: readonly ConstraintFailure[];
}

/**
 * Every hard constraint is evaluated independently so the full rejection
 * matrix is attributable: provider policy, privacy class, capabilities,
 * context, tool needs (capabilities), budget, and deadline.
 */
export function evaluateCandidate(model: ModelDescriptor, request: RouteRequest): CandidateCheck {
  const failures: ConstraintFailure[] = [];

  if (model.providerPolicy === "forbidden") {
    failures.push({
      modelId: model.modelId,
      constraint: "provider-policy",
      detail: `provider ${model.providerId} is not approved`,
    });
  }

  if (!satisfiesPrivacy(model, request.privacyRequired)) {
    failures.push({
      modelId: model.modelId,
      constraint: "privacy-class",
      detail:
        model.privacyClass === undefined
          ? `undeclared privacy class cannot serve ${request.privacyRequired}`
          : `${model.privacyClass} cannot serve ${request.privacyRequired}`,
    });
  }

  for (const capability of request.requiredCapabilities) {
    if (!hasCapability(model, capability)) {
      failures.push({
        modelId: model.modelId,
        constraint: "capability",
        detail: `capability not declared: ${capability}`,
      });
      break;
    }
  }

  if (model.contextWindow !== undefined && model.contextWindow < request.contextNeeded) {
    failures.push({
      modelId: model.modelId,
      constraint: "context-window",
      detail: `${model.contextWindow} < ${request.contextNeeded}`,
    });
  }

  if (model.maxOutputTokens !== undefined && model.maxOutputTokens < request.outputNeeded) {
    failures.push({
      modelId: model.modelId,
      constraint: "max-output",
      detail: `${model.maxOutputTokens} < ${request.outputNeeded}`,
    });
  }

  const useTokens = request.contextNeeded > 0 || request.outputNeeded > 0;
  const cost = useTokens
    ? estimateCostUsd(model, request.contextNeeded, request.outputNeeded)
    : (request.fixedCostUsd ?? estimateCostUsd(model, request.contextNeeded, request.outputNeeded));
  if (cost > request.budgetUsd) {
    failures.push({
      modelId: model.modelId,
      constraint: "budget",
      detail: `estimated $${cost.toFixed(4)} > budget $${request.budgetUsd}`,
    });
  }

  const latency = useTokens
    ? estimateLatencyMs(model, request.outputNeeded)
    : (request.fixedLatencyMs ?? estimateLatencyMs(model, request.outputNeeded));
  if (latency > request.deadlineMs) {
    failures.push({
      modelId: model.modelId,
      constraint: "deadline",
      detail: `estimated ${latency.toFixed(0)}ms > deadline ${request.deadlineMs}ms`,
    });
  }

  if (request.highRisk && model.approvedForHighRisk !== true) {
    failures.push({
      modelId: model.modelId,
      constraint: "high-risk-approval",
      detail: "model is not approved for high-risk tasks",
    });
  }

  return { modelId: model.modelId, eligible: failures.length === 0, failures };
}

const COMPLEXITY_RANK: Record<TaskComplexity, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2
};

export interface LiveRouteRequest extends RouteRequest {
  readonly role: FlowchartNodeRole;
  readonly complexity: TaskComplexity;
}

/** Live + library hard filter: flowchart role/complexity then evaluateCandidate. */
export function evaluateLiveCandidate(model: CatalogModel, request: LiveRouteRequest): CandidateCheck {
  const failures: ConstraintFailure[] = [];
  if (!model.roles.includes(request.role)) {
    failures.push({
      modelId: model.id,
      constraint: "role",
      detail: `role ${request.role} not declared`
    });
  }
  if (COMPLEXITY_RANK[model.maxComplexity] < COMPLEXITY_RANK[request.complexity]) {
    failures.push({
      modelId: model.id,
      constraint: "complexity",
      detail: `maxComplexity ${model.maxComplexity} < ${request.complexity}`
    });
  }
  // LiveRouteRequest extends RouteRequest, so the shared matrix reads the same
  // request object directly. A per-candidate field copy here would silently
  // drop any future RouteRequest constraint from the live path.
  const rest = evaluateCandidate(toModelDescriptor(model), request);
  const merged = [...failures, ...rest.failures];
  return { modelId: model.id, eligible: merged.length === 0, failures: merged };
}
