import { createHash } from "node:crypto";
import { DomainValidationError } from "../domain/errors.js";
import {
  type Flowchart,
  type FlowNode
} from "../domain/flowchart.js";
import { isTaskId, type TaskId } from "../domain/ids.js";
import { isRecord } from "../domain/record.js";
import { isAgentRole, type AgentRole } from "../domain/roles.js";
import {
  compileChildrenToFlowchart,
  flowchartRoleForAgentRole,
  type CompilableChild
} from "../graph/compile-children.js";
import type { ModelDescriptor } from "../routing/capability-registry.js";
import { validateModelDescriptor } from "../routing/capability-registry.js";
import type { OutcomeObservation } from "../routing/outcomes.js";
import type { RouteRequest } from "../routing/policy.js";
import { routeR0, type R0Config, type R0Decision } from "../routing/r0.js";
import { routeR1, type R1Decision } from "../routing/r1.js";
import { stableStringify } from "./manifest.js";

/**
 * PS-P4: equivalent R0/R1 task compilation.
 *
 * Both arms share one fully compiled taskSpec (all tasks, deps, roles,
 * acceptance/limits carried on the children). Only the routing policy / pinned
 * preferred model may differ. Forbidden shortcuts — tasks[0]-only flowcharts,
 * placeholder prices, wall-clock Date.now(), hardcoded fake taskFamily — are
 * rejected here so the holdout script stays thin and testable.
 */

export const HOLDOUT_TASK_SPEC_SCHEMA = "f6-taskSpec-v1" as const;

export interface HoldoutTaskNode {
  readonly id: TaskId;
  readonly role: AgentRole;
  readonly objective: string;
  readonly dependsOn?: readonly TaskId[] | undefined;
}

export interface HoldoutTaskSpec {
  readonly schema: typeof HOLDOUT_TASK_SPEC_SCHEMA;
  readonly id: string;
  /** Becomes RouteRequest.taskFamily — never a hardcoded "holdout". */
  readonly family: string;
  readonly tasks: readonly HoldoutTaskNode[];
  readonly allowedModels: readonly string[];
  readonly baseCommit?: string | undefined;
  readonly oracle?:
    | {
        readonly kind: string;
        readonly custodianRef?: string | undefined;
        readonly notes?: string | undefined;
      }
    | undefined;
  readonly privacyRequired?: RouteRequest["privacyRequired"] | undefined;
  readonly requiredCapabilities?: readonly string[] | undefined;
  readonly contextNeeded?: number | undefined;
  readonly outputNeeded?: number | undefined;
  readonly budgetUsd?: number | undefined;
  readonly deadlineMs?: number | undefined;
  readonly highRisk?: boolean | undefined;
  readonly notes?: string | undefined;
}

export interface HoldoutPriceEntry {
  readonly modelId: string;
  readonly providerId: string;
  readonly version: string;
  readonly inputCostPerMTok: number;
  readonly outputCostPerMTok: number;
  readonly latencyMsPer1K: number;
  readonly capabilities?: readonly string[] | undefined;
  readonly providerPolicy?: ModelDescriptor["providerPolicy"] | undefined;
  readonly approvedForHighRisk?: boolean | undefined;
  readonly privacyClass?: ModelDescriptor["privacyClass"] | undefined;
  readonly contextWindow?: number | undefined;
  readonly maxOutputTokens?: number | undefined;
}

export interface CompileEquivalentArmsInput {
  readonly spec: HoldoutTaskSpec;
  /**
   * Real catalog descriptors (or resolved price-table entries). Missing ids
   * fail closed — this path never invents placeholder prices.
   */
  readonly catalog: readonly ModelDescriptor[];
  /** Injectable clock. Sealed paths must not call Date.now(). */
  readonly nowMs: number;
  readonly observations?: readonly OutcomeObservation[] | undefined;
  readonly featureVersion?: string | undefined;
  readonly r0Config?: R0Config | undefined;
  readonly preferredModel?: string | undefined;
}

export interface CompiledArmShared {
  readonly specId: string;
  readonly specHash: string;
  readonly taskFamily: string;
  readonly tasks: readonly HoldoutTaskNode[];
  readonly models: readonly ModelDescriptor[];
  readonly routeRequest: RouteRequest;
  /** Full multi-task flowchart — never tasks[0] alone. */
  readonly flowchart: Flowchart;
  readonly nowMs: number;
}

export interface CompiledEquivalentArms {
  readonly shared: CompiledArmShared;
  readonly r0: {
    readonly decision: R0Decision;
    readonly flowchart: Flowchart;
  };
  readonly r1: {
    readonly decision: R1Decision;
    readonly flowchart: Flowchart;
  };
}

const DEFAULT_R0_CONFIG: R0Config = {
  confidenceGate: 0.7,
  cascade: false,
  policyVersion: "holdout-r0-v1"
};

export function validateHoldoutTaskSpec(value: unknown): HoldoutTaskSpec {
  if (!isRecord(value)) {
    throw new DomainValidationError("holdout taskSpec must be an object");
  }
  const schema = value.$schema ?? value.schema;
  if (schema !== undefined && schema !== HOLDOUT_TASK_SPEC_SCHEMA) {
    throw new DomainValidationError(
      `holdout taskSpec schema must be ${HOLDOUT_TASK_SPEC_SCHEMA}, got ${JSON.stringify(schema)}`
    );
  }
  if (typeof value.id !== "string" || value.id.trim() === "") {
    throw new DomainValidationError("holdout taskSpec.id is required");
  }
  if (typeof value.family !== "string" || value.family.trim() === "") {
    throw new DomainValidationError(
      "holdout taskSpec.family is required (becomes taskFamily; hardcoded 'holdout' is forbidden)"
    );
  }
  if (value.family.trim() === "holdout") {
    throw new DomainValidationError(
      "holdout taskSpec.family must be a real catalog family (implementation|testing|review|research|…); fixed fake 'holdout' is forbidden"
    );
  }
  if (!Array.isArray(value.tasks) || value.tasks.length === 0) {
    throw new DomainValidationError("holdout taskSpec.tasks must be a non-empty array");
  }
  if (!Array.isArray(value.allowedModels) || value.allowedModels.length === 0) {
    throw new DomainValidationError("holdout taskSpec.allowedModels must be a non-empty array");
  }
  for (const [index, modelId] of value.allowedModels.entries()) {
    if (typeof modelId !== "string" || modelId.trim() === "") {
      throw new DomainValidationError(`allowedModels[${index}] must be a non-empty catalog id`);
    }
  }

  const tasks: HoldoutTaskNode[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of value.tasks.entries()) {
    if (!isRecord(raw)) {
      throw new DomainValidationError(`tasks[${index}] must be an object`);
    }
    if (!isTaskId(raw.id)) {
      throw new DomainValidationError(
        `tasks[${index}].id ${JSON.stringify(raw.id)} is not a TaskId (needs the tsk_ prefix)`
      );
    }
    if (seen.has(raw.id)) {
      throw new DomainValidationError(`duplicate task id: ${raw.id}`);
    }
    seen.add(raw.id);
    if (!isAgentRole(raw.role)) {
      throw new DomainValidationError(
        `tasks[${index}].role ${JSON.stringify(raw.role)} is not a known AgentRole`
      );
    }
    if (typeof raw.objective !== "string" || raw.objective.trim() === "") {
      throw new DomainValidationError(`tasks[${index}].objective is empty`);
    }
    let dependsOn: readonly TaskId[] | undefined;
    if (raw.dependsOn !== undefined) {
      if (!Array.isArray(raw.dependsOn) || !raw.dependsOn.every((id) => isTaskId(id))) {
        throw new DomainValidationError(`tasks[${index}].dependsOn must be TaskId[]`);
      }
      dependsOn = raw.dependsOn as TaskId[];
    }
    tasks.push({
      id: raw.id,
      role: raw.role,
      objective: raw.objective,
      ...(dependsOn !== undefined ? { dependsOn } : {})
    });
  }

  return {
    schema: HOLDOUT_TASK_SPEC_SCHEMA,
    id: value.id.trim(),
    family: value.family.trim(),
    tasks,
    allowedModels: value.allowedModels.map((id) => String(id).trim()),
    ...(typeof value.baseCommit === "string" ? { baseCommit: value.baseCommit } : {}),
    ...(isRecord(value.oracle)
      ? {
          oracle: {
            kind: String(value.oracle.kind ?? ""),
            ...(typeof value.oracle.custodianRef === "string"
              ? { custodianRef: value.oracle.custodianRef }
              : {}),
            ...(typeof value.oracle.notes === "string" ? { notes: value.oracle.notes } : {})
          }
        }
      : {}),
    ...(value.privacyRequired === "local" ||
    value.privacyRequired === "cloud-approved" ||
    value.privacyRequired === "cloud-general"
      ? { privacyRequired: value.privacyRequired }
      : {}),
    ...(Array.isArray(value.requiredCapabilities)
      ? { requiredCapabilities: value.requiredCapabilities.map(String) }
      : {}),
    ...(typeof value.contextNeeded === "number" ? { contextNeeded: value.contextNeeded } : {}),
    ...(typeof value.outputNeeded === "number" ? { outputNeeded: value.outputNeeded } : {}),
    ...(typeof value.budgetUsd === "number" ? { budgetUsd: value.budgetUsd } : {}),
    ...(typeof value.deadlineMs === "number" ? { deadlineMs: value.deadlineMs } : {}),
    ...(typeof value.highRisk === "boolean" ? { highRisk: value.highRisk } : {}),
    ...(typeof value.notes === "string" ? { notes: value.notes } : {})
  };
}

/**
 * Resolve allowed model ids against a price catalog. Missing prices fail
 * closed — never synthesize placeholder inputCostPerMTok/outputCostPerMTok.
 */
export function resolveCatalogModels(
  allowedModels: readonly string[],
  catalog: readonly ModelDescriptor[]
): readonly ModelDescriptor[] {
  const byId = new Map(catalog.map((model) => [model.modelId, validateModelDescriptor(model)]));
  const resolved: ModelDescriptor[] = [];
  for (const id of allowedModels) {
    const model = byId.get(id);
    if (model === undefined) {
      throw new DomainValidationError(
        `catalog price missing for allowed model ${JSON.stringify(id)}; refusing placeholder`
      );
    }
    if (
      !Number.isFinite(model.inputCostPerMTok) ||
      !Number.isFinite(model.outputCostPerMTok) ||
      model.inputCostPerMTok < 0 ||
      model.outputCostPerMTok < 0
    ) {
      throw new DomainValidationError(
        `catalog price for ${id} is non-finite or negative; refusing sealed compile`
      );
    }
    resolved.push(model);
  }
  return resolved;
}

/** Build ModelDescriptors from the F6 owner-frozen price table shape. */
export function modelDescriptorsFromPriceTable(
  allowedModels: readonly string[],
  priceTable: {
    readonly models: Readonly<
      Record<string, { readonly inputPerMTok: number; readonly outputPerMTok: number }>
    >;
  },
  defaults?: {
    readonly latencyMsPer1K?: number;
    readonly versionSuffix?: string;
  }
): readonly ModelDescriptor[] {
  const latencyMsPer1K = defaults?.latencyMsPer1K ?? 1000;
  const versionSuffix = defaults?.versionSuffix ?? "v1";
  const entries: ModelDescriptor[] = [];
  for (const id of allowedModels) {
    const price = priceTable.models[id];
    if (price === undefined) {
      throw new DomainValidationError(
        `price table missing entry for ${JSON.stringify(id)}; refusing placeholder`
      );
    }
    if (
      !Number.isFinite(price.inputPerMTok) ||
      !Number.isFinite(price.outputPerMTok) ||
      price.inputPerMTok < 0 ||
      price.outputPerMTok < 0
    ) {
      throw new DomainValidationError(`price table entry for ${id} is invalid`);
    }
    entries.push(
      validateModelDescriptor({
        modelId: id,
        providerId: id.includes("/") ? id.split("/")[0]! : id,
        version: `${id}-${versionSuffix}`,
        capabilities: [],
        providerPolicy: "approved",
        inputCostPerMTok: price.inputPerMTok,
        outputCostPerMTok: price.outputPerMTok,
        latencyMsPer1K,
        approvedForHighRisk: true,
        privacyClass: "cloud-general"
      })
    );
  }
  return entries;
}

export function holdoutSpecHash(spec: HoldoutTaskSpec): string {
  return createHash("sha256").update(stableStringify(spec), "utf8").digest("hex");
}

function toCompilableChildren(
  tasks: readonly HoldoutTaskNode[],
  allowedModels: readonly string[],
  preferredModel?: string
): readonly CompilableChild[] {
  return tasks.map((task) => ({
    taskId: task.id,
    role: task.role,
    objective: task.objective,
    ...(task.dependsOn !== undefined ? { dependsOn: task.dependsOn } : {}),
    allowedModels,
    ...(preferredModel !== undefined ? { preferredModel } : {})
  }));
}

function routeRequestFromSpec(spec: HoldoutTaskSpec): RouteRequest {
  const privacy =
    spec.privacyRequired === "local" ||
    spec.privacyRequired === "cloud-approved" ||
    spec.privacyRequired === "cloud-general"
      ? spec.privacyRequired
      : "cloud-general";
  return {
    taskFamily: spec.family,
    privacyRequired: privacy,
    requiredCapabilities: spec.requiredCapabilities ?? [],
    contextNeeded: spec.contextNeeded ?? 0,
    outputNeeded: spec.outputNeeded ?? 0,
    budgetUsd: spec.budgetUsd ?? Number.MAX_SAFE_INTEGER,
    deadlineMs: spec.deadlineMs ?? Number.MAX_SAFE_INTEGER,
    highRisk: spec.highRisk ?? false,
    fixedCostUsd: 1,
    fixedLatencyMs: 1000
  };
}

function pinPreferredModel(flowchart: Flowchart, preferredModel: string): Flowchart {
  return {
    ...flowchart,
    nodes: flowchart.nodes.map(
      (node): FlowNode => ({
        ...node,
        modelPolicy: {
          ...node.modelPolicy,
          preferredModel
        }
      })
    )
  };
}

/**
 * Compile one shared taskSpec into equivalent R0/R1 arm artifacts.
 * R1 flowchart contains **every** task node (not tasks[0]).
 */
export function compileEquivalentArms(input: CompileEquivalentArmsInput): CompiledEquivalentArms {
  if (!Number.isFinite(input.nowMs)) {
    throw new DomainValidationError("compileEquivalentArms requires an injectable finite nowMs (no Date.now)");
  }
  const models = resolveCatalogModels(input.spec.allowedModels, input.catalog);
  const routeRequest = routeRequestFromSpec(input.spec);
  const r0Config = input.r0Config ?? DEFAULT_R0_CONFIG;
  const children = toCompilableChildren(
    input.spec.tasks,
    input.spec.allowedModels,
    input.preferredModel
  );
  const baseFlowchart = compileChildrenToFlowchart(children, {
    flowchartId: `flw_holdout_${input.spec.id}`,
    allowedModels: input.spec.allowedModels,
    ...(input.preferredModel !== undefined ? { preferredModel: input.preferredModel } : {})
  });

  if (baseFlowchart.nodes.length !== input.spec.tasks.length) {
    throw new DomainValidationError(
      `compiled flowchart node count ${baseFlowchart.nodes.length} !== tasks.length ${input.spec.tasks.length}`
    );
  }

  const r0Decision = routeR0(r0Config, models, routeRequest);
  // R1 uses the primary (first) task's agent role mapped to flowchart role for
  // posterior keying, but the flowchart itself still carries every task.
  const primaryRole = flowchartRoleForAgentRole(input.spec.tasks[0]!.role);
  const r1Decision = routeR1({
    r0: r0Decision,
    role: primaryRole,
    featureVersion: input.featureVersion ?? "holdout-block-v1",
    models,
    observations: input.observations ?? [],
    nowMs: input.nowMs
  });
  const chosen = r1Decision.selection ?? r0Decision.selection;
  if (chosen === undefined) {
    throw new DomainValidationError("no eligible model for the R1 arm");
  }
  const r1Flowchart = pinPreferredModel(baseFlowchart, chosen);

  const shared: CompiledArmShared = {
    specId: input.spec.id,
    specHash: holdoutSpecHash(input.spec),
    taskFamily: input.spec.family,
    tasks: input.spec.tasks,
    models,
    routeRequest,
    flowchart: baseFlowchart,
    nowMs: input.nowMs
  };

  return {
    shared,
    r0: { decision: r0Decision, flowchart: baseFlowchart },
    r1: { decision: r1Decision, flowchart: r1Flowchart }
  };
}
