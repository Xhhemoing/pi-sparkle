import type { ModelDescriptor } from "./capability-registry.js";
import {
  estimateCostUsd,
  estimateLatencyMs,
  hasCapability,
  satisfiesPrivacy,
} from "./capability-registry.js";
import type { PrivacyClass } from "./capability-registry.js";

export interface RouteRequest {
  readonly taskFamily: string;
  readonly privacyRequired: PrivacyClass;
  readonly requiredCapabilities: readonly string[];
  readonly contextNeeded: number;
  readonly outputNeeded: number;
  readonly budgetUsd: number;
  readonly deadlineMs: number;
  readonly highRisk: boolean;
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

export const CONSTRAINT_NAMES = [
  "provider-policy",
  "privacy-class",
  "capability",
  "context-window",
  "max-output",
  "budget",
  "deadline",
  "high-risk-approval",
] as const;

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
      detail: `${model.privacyClass} cannot serve ${request.privacyRequired}`,
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

  if (model.contextWindow < request.contextNeeded) {
    failures.push({
      modelId: model.modelId,
      constraint: "context-window",
      detail: `${model.contextWindow} < ${request.contextNeeded}`,
    });
  }

  if (model.maxOutputTokens < request.outputNeeded) {
    failures.push({
      modelId: model.modelId,
      constraint: "max-output",
      detail: `${model.maxOutputTokens} < ${request.outputNeeded}`,
    });
  }

  const cost = estimateCostUsd(model, request.contextNeeded, request.outputNeeded);
  if (cost > request.budgetUsd) {
    failures.push({
      modelId: model.modelId,
      constraint: "budget",
      detail: `estimated $${cost.toFixed(4)} > budget $${request.budgetUsd}`,
    });
  }

  const latency = estimateLatencyMs(model, request.outputNeeded);
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
