import type { ModelPolicy, ConfidenceScore } from "../domain/flowchart.js";
import type { TaskId } from "../domain/ids.js";
import { DomainValidationError, RoutingRefusalError } from "../domain/errors.js";
import { parseModelRef, formatModelRef } from "../config/model-ref.js";
import { estimateTokens } from "../context/packet.js";
import { applyLearnedRouting, type LearnedRoutingSnapshot } from "../learning/learned-routing.js";
import { createModelRouter, type ModelRouterConfig } from "../supervisor/model-router.js";
import { analyzeTask } from "./analyze-task.js";
import type { TaskAssignment } from "./assign.js";
import type { CatalogModel } from "./catalog-model.js";
import { PRIVACY_ORDER, type PrivacyClass } from "./capability-registry.js";
import { ASSIGN_FEATURE_VERSION } from "./feature-version.js";
import { selectLiveModel, liveRefusalMessage } from "./live-selection.js";
import { evaluateLiveCandidate } from "./policy.js";

/** Host-only opt-in. Reservations are estimates, not tokenizer or dollar caps. */
export interface StaticWriteRoutingInput {
  readonly catalog: ModelRouterConfig;
  readonly modelPolicy: ModelPolicy;
  readonly inputTokenReserve: number;
  readonly outputTokens: number;
  readonly requiredCapabilities?: readonly string[];
  readonly privacyRequired?: PrivacyClass;
}
export interface StaticWriteRouting extends StaticWriteRoutingInput {
  readonly catalog: Omit<ModelRouterConfig, "models"> & { readonly models: readonly CatalogModel[] };
}
export interface StaticWriteSelection {
  readonly assignment: TaskAssignment;
  readonly model: CatalogModel;
  readonly inputTokenReserve: number;
  readonly outputTokens: number;
}

function invalid(message: string): never { throw new DomainValidationError(`static write routing: ${message}`); }
function data(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) invalid(`${label} must be a plain data object`);
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string") || Object.values(fields).some((field) => !("value" in field))) invalid(`${label} must use own data properties, not accessors`);
  return Object.fromEntries(Object.entries(fields).map(([key, descriptor]) => [key, descriptor.value]));
}
function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) invalid(`${label} must be an array`);
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string") || Object.values(fields).some((field) => !("value" in field))) invalid(`${label} must use own data properties`);
  return Array.from({ length: value.length }, (_, index) => fields[String(index)]?.value as unknown);
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "" || value !== value.trim() || value.includes("\0")) invalid(`${label} must be a nonempty trimmed string`);
  return value;
}
function strings(value: unknown, label: string): readonly string[] {
  const result = array(value, label).map((entry) => text(entry, label));
  if (new Set(result).size !== result.length) invalid(`${label} contains duplicates`);
  return Object.freeze(result);
}
function number(value: unknown, label: string, integer = false, minimum = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || (integer && !Number.isSafeInteger(value))) invalid(`${label} must be an explicit finite ${integer ? "integer" : "number"} >= ${minimum}`);
  return value;
}
function privacy(value: unknown): PrivacyClass {
  if (!PRIVACY_ORDER.includes(value as PrivacyClass)) invalid("privacy class must be explicit and valid");
  return value as PrivacyClass;
}

/** Detach host data before the first await; never fill missing prices/capacity. */
export function snapshotStaticWriteRouting(input: StaticWriteRoutingInput | undefined): StaticWriteRouting | undefined {
  if (input === undefined) return undefined;
  const value = data(input, "configuration"), catalog = data(value.catalog, "catalog"), policy = data(value.modelPolicy, "modelPolicy");
  const models = array(catalog.models, "models").map((entry): CatalogModel => {
    const model = data(entry, "model");
    const id = text(model.id, "model id"), ref = parseModelRef(id), providerId = text(model.providerId, "providerId");
    if (formatModelRef(ref.providerId, ref.modelId) !== id || ref.providerId !== providerId) invalid("model must declare a matching canonical provider/model identity");
    if (model.providerPolicy !== "approved" && model.providerPolicy !== "forbidden") invalid("provider policy must be explicit");
    if (model.approvedForHighRisk !== undefined && typeof model.approvedForHighRisk !== "boolean") invalid("approvedForHighRisk must be boolean");
    return Object.freeze({ id, providerId, version: text(model.version, "version"),
      roles: strings(model.roles, "roles") as CatalogModel["roles"], maxComplexity: model.maxComplexity as CatalogModel["maxComplexity"],
      capabilities: strings(model.capabilities, "capabilities"), providerPolicy: model.providerPolicy,
      privacyClass: privacy(model.privacyClass), contextWindow: number(model.contextWindow, "contextWindow", true, 1),
      maxOutputTokens: number(model.maxOutputTokens, "maxOutputTokens", true, 1),
      inputCostPerMTok: number(model.inputCostPerMTok, "inputCostPerMTok"), outputCostPerMTok: number(model.outputCostPerMTok, "outputCostPerMTok"),
      latencyMsPer1K: number(model.latencyMsPer1K, "latencyMsPer1K"), estimatedCostUsd: number(model.estimatedCostUsd, "estimatedCostUsd"),
      estimatedDurationMs: number(model.estimatedDurationMs, "estimatedDurationMs"),
      ...(model.approvedForHighRisk === undefined ? {} : { approvedForHighRisk: model.approvedForHighRisk as boolean }) });
  });
  const threshold = catalog.defaultThreshold === undefined ? undefined : number(catalog.defaultThreshold, "defaultThreshold");
  const router = createModelRouter({ models: Object.freeze(models), policyVersion: text(catalog.policyVersion, "policyVersion"),
    ...(threshold === undefined ? {} : { defaultThreshold: threshold as ConfidenceScore }) });
  for (const model of models) if (!["LOW", "MEDIUM", "HIGH"].includes(model.maxComplexity)) invalid("model maxComplexity is invalid");
  const allowedModels = strings(policy.allowedModels, "allowedModels");
  if (allowedModels.length === 0 || allowedModels.some((id) => !models.some((model) => model.id === id))) invalid("allowedModels must name available canonical models");
  const preferredModel = policy.preferredModel === undefined ? undefined : text(policy.preferredModel, "preferredModel");
  if (preferredModel !== undefined && !allowedModels.includes(preferredModel)) invalid("preferredModel must be allowed");
  return Object.freeze({ catalog: Object.freeze({ ...router.config, models: Object.freeze(models) }),
    modelPolicy: Object.freeze({ allowedModels, ...(preferredModel === undefined ? {} : { preferredModel }) }),
    inputTokenReserve: number(value.inputTokenReserve, "inputTokenReserve", true), outputTokens: number(value.outputTokens, "outputTokens", true, 1),
    ...(value.requiredCapabilities === undefined ? {} : { requiredCapabilities: strings(value.requiredCapabilities, "requiredCapabilities") }),
    ...(value.privacyRequired === undefined ? {} : { privacyRequired: privacy(value.privacyRequired) }) });
}

function contextNeeded(prompt: string, inputTokenReserve: number, outputTokens: number): number {
  return estimateTokens(prompt) + inputTokenReserve + outputTokens;
}

export function selectStaticWriteModel(config: StaticWriteRouting, task: { readonly taskId: TaskId; readonly objective: string; readonly prompt: string },
  learned: LearnedRoutingSnapshot, remainingTimeMs: number): StaticWriteSelection {
  const inferred = analyzeTask(task.objective, "implementer");
  const privacyRequired = config.privacyRequired !== undefined && PRIVACY_ORDER.indexOf(config.privacyRequired) < PRIVACY_ORDER.indexOf(inferred.privacyRequired)
    ? config.privacyRequired : inferred.privacyRequired;
  const requiredCapabilities = [...new Set([...inferred.requiredCapabilities, ...(config.requiredCapabilities ?? [])])];
  const analysis = analyzeTask(task.objective, "implementer", { requiredCapabilities, privacyRequired });
  let allowedModels = config.modelPolicy.allowedModels, preferredModel = config.modelPolicy.preferredModel;
  if (learned.policy !== undefined) {
    const cheapest = selectLiveModel(config.catalog.models.filter((model) => allowedModels.includes(model.id)), undefined).id;
    const applied = applyLearnedRouting(analysis.family, allowedModels, preferredModel ?? cheapest, learned.policy);
    allowedModels = applied.allowedModels; preferredModel = applied.preferredModel;
  }
  const decision = createModelRouter(config.catalog).route({ taskId: task.taskId, role: "actor", agentRole: "implementer",
    complexity: analysis.complexity, family: analysis.family, featureVersion: ASSIGN_FEATURE_VERSION,
    modelPolicy: { allowedModels, ...(preferredModel === undefined ? {} : { preferredModel }) },
    highRisk: analysis.highRisk, approvalRequired: analysis.highRisk, requiredCapabilities, privacyRequired,
    contextNeeded: contextNeeded(task.prompt, config.inputTokenReserve, config.outputTokens), outputNeeded: config.outputTokens,
    limits: { remainingTimeMs },
    ...(learned.resourceVersionId === undefined ? {} : { routingPolicyResourceVersionId: learned.resourceVersionId }) });
  if (decision.statusAfterRoute === "WAITING_FOR_USER") invalid("selected task requires human approval; no model was dispatched");
  const model = config.catalog.models.find((entry) => entry.id === decision.model)!;
  const assignment: TaskAssignment = Object.freeze({ taskId: task.taskId, role: "implementer", analysis, decision: Object.freeze(decision),
    allowedModels, preferredModel: preferredModel ?? decision.model });
  return Object.freeze({ assignment, model, inputTokenReserve: config.inputTokenReserve, outputTokens: config.outputTokens });
}

/** Recheck the fixed choice against current prompt growth; never choose another. */
export function assertStaticWriteAdmission(selection: StaticWriteSelection, prompt: string, remainingTimeMs: number): void {
  const { model, assignment: { analysis } } = selection;
  const check = evaluateLiveCandidate(model, { role: "actor", complexity: analysis.complexity, taskFamily: analysis.family,
    highRisk: analysis.highRisk, requiredCapabilities: analysis.requiredCapabilities, privacyRequired: analysis.privacyRequired,
    contextNeeded: contextNeeded(prompt, selection.inputTokenReserve, selection.outputTokens), outputNeeded: selection.outputTokens,
    budgetUsd: Number.POSITIVE_INFINITY, deadlineMs: remainingTimeMs, fixedCostUsd: model.estimatedCostUsd, fixedLatencyMs: model.estimatedDurationMs });
  if (!check.eligible) throw new RoutingRefusalError(`static write routing: ${liveRefusalMessage({ role: "actor", complexity: analysis.complexity, highRisk: analysis.highRisk }, check.failures)}`, check.failures);
}
