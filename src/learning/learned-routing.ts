import { join } from "node:path";
import { adaptationRoot } from "../privacy/state-layout.js";
import { DomainValidationError } from "../domain/errors.js";
import { parseProjectId } from "../domain/ids.js";
import { hash32 } from "../domain/hash.js";
import { isRecord } from "../domain/record.js";
import { hashCandidateContent } from "../adaptation/candidate.js";
import { loadAdaptationRegistry } from "../adaptation/promotion.js";
import type { ResourceRegistry } from "../adaptation/registry.js";
import type { ResourceIdentity, ResourceVersion } from "../adaptation/resource.js";

export const ROUTING_POLICY_NAME = "smart-assign";

export interface LearnedAvoid {
  readonly modelId: string;
  readonly family?: string | undefined;
  readonly reason: string;
}

export interface LearnedPrefer {
  readonly family: string;
  readonly modelId: string;
}

export interface LearnedRoutingPolicy {
  readonly primaryModelId: string;
  readonly avoid: readonly LearnedAvoid[];
  readonly prefer: readonly LearnedPrefer[];
  readonly assignments?: readonly { role: string; model: string; family: string }[] | undefined;
}

export function stableProjectKey(projectRoot: string): string {
  const normalized = projectRoot.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return `p${hash32(normalized)}`;
}

export function routingPolicyIdentity(projectRoot: string): ResourceIdentity {
  return {
    kind: "routing-policy",
    name: ROUTING_POLICY_NAME,
    scope: {
      kind: "project",
      projectId: parseProjectId(`prj_${stableProjectKey(projectRoot)}`)
    }
  };
}

export function learnedRoutingPath(stateRoot: string, projectRoot: string): string {
  return join(adaptationRoot(stateRoot), "learning", "projects", stableProjectKey(projectRoot), "routing.json");
}

export function parseLearnedRoutingPolicy(content: string): LearnedRoutingPolicy {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new DomainValidationError("routing-policy content is not JSON");
  }
  if (!isRecord(parsed) || typeof parsed.primaryModelId !== "string" || parsed.primaryModelId.trim() === "") {
    throw new DomainValidationError("routing-policy primaryModelId is required");
  }
  if (!Array.isArray(parsed.avoid) || !Array.isArray(parsed.prefer)) {
    throw new DomainValidationError("routing-policy avoid and prefer must be arrays");
  }
  const avoid: LearnedAvoid[] = parsed.avoid.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.modelId !== "string" || entry.modelId.trim() === "") {
      throw new DomainValidationError(`routing-policy avoid[${index}] requires modelId`);
    }
    if (typeof entry.reason !== "string") {
      throw new DomainValidationError(`routing-policy avoid[${index}] requires reason`);
    }
    return {
      modelId: entry.modelId,
      reason: entry.reason,
      ...(typeof entry.family === "string" ? { family: entry.family } : {})
    };
  });
  const prefer: LearnedPrefer[] = parsed.prefer.map((entry, index) => {
    if (
      !isRecord(entry) ||
      typeof entry.family !== "string" ||
      typeof entry.modelId !== "string" ||
      entry.family.trim() === "" ||
      entry.modelId.trim() === ""
    ) {
      throw new DomainValidationError(`routing-policy prefer[${index}] requires family and modelId`);
    }
    return { family: entry.family, modelId: entry.modelId };
  });
  const assignments = Array.isArray(parsed.assignments)
    ? parsed.assignments.flatMap((entry) => {
        if (
          !isRecord(entry) ||
          typeof entry.role !== "string" ||
          typeof entry.model !== "string" ||
          typeof entry.family !== "string"
        ) {
          return [];
        }
        return [{ role: entry.role, model: entry.model, family: entry.family }];
      })
    : undefined;
  return {
    primaryModelId: parsed.primaryModelId,
    avoid,
    prefer,
    ...(assignments !== undefined ? { assignments } : {})
  };
}

/**
 * Live policy loader. Reads the versioned active routing-policy pointer.
 * A leftover learning/.../routing.json is never consulted.
 */
export async function loadLearnedRouting(
  stateRoot: string,
  projectRoot: string
): Promise<LearnedRoutingPolicy | undefined> {
  let registry;
  try {
    registry = await loadAdaptationRegistry(stateRoot);
  } catch (error) {
    if (error instanceof DomainValidationError && /no registry snapshot/.test(error.message)) {
      return undefined;
    }
    throw error;
  }
  const active = registry.getActiveContent(routingPolicyIdentity(projectRoot));
  if (active === undefined) return undefined;
  if (hashCandidateContent(active.content) !== active.version.contentHash) {
    throw new DomainValidationError("active routing-policy content hash mismatch");
  }
  return parseLearnedRoutingPolicy(active.content);
}

/** @deprecated Live policy is the registry pointer. Writing routing.json is refused. */
export async function saveLearnedRouting(
  _stateRoot: string,
  _projectRoot: string,
  _policy: LearnedRoutingPolicy
): Promise<void> {
  throw new DomainValidationError(
    "routing.json is not a live policy store; promote a routing-policy resource instead"
  );
}

export function routingPolicyContent(policy: LearnedRoutingPolicy): string {
  return JSON.stringify(policy, null, 2);
}

/**
 * Active routing-policy version for the project, registering the empty
 * baseline (no avoid/prefer) first when the identity has no active pointer.
 * Never moves an existing pointer.
 */
export function ensureRoutingBaseline(
  registry: ResourceRegistry,
  identity: ResourceIdentity,
  primaryModelId: string,
  detectorIdentity: string
): ResourceVersion {
  const active = registry.getActiveVersion(identity);
  if (active !== undefined) return active;
  return registry.registerBaseline({
    identity,
    content: routingPolicyContent({ primaryModelId, avoid: [], prefer: [] }),
    author: { kind: "detector", identity: detectorIdentity }
  });
}

export function policyFromAssignments(
  primaryModelId: string,
  assignments: readonly {
    role: string;
    decision: { model: string };
    analysis: { family: string };
  }[],
  extra?: { avoid?: readonly LearnedAvoid[]; prefer?: readonly LearnedPrefer[] }
): LearnedRoutingPolicy {
  return {
    primaryModelId,
    avoid: extra?.avoid ?? [],
    prefer: extra?.prefer ?? [],
    assignments: assignments.map((item) => ({
      role: item.role,
      model: item.decision.model,
      family: item.analysis.family
    }))
  };
}

export function applyLearnedRouting(
  family: string,
  catalogIds: readonly string[],
  preferredModel: string,
  learned: LearnedRoutingPolicy
): { allowedModels: readonly string[]; preferredModel: string } {
  const avoided = new Set(
    learned.avoid
      .filter((entry) => entry.family === undefined || entry.family === family)
      .map((entry) => entry.modelId)
  );
  const kept = catalogIds.filter((id) => !avoided.has(id));
  const allowedModels = kept.length > 0 ? kept : catalogIds;
  const prefer = learned.prefer.find((entry) => entry.family === family)?.modelId;
  if (prefer !== undefined && allowedModels.includes(prefer)) {
    return { allowedModels, preferredModel: prefer };
  }
  if (allowedModels.includes(preferredModel)) {
    return { allowedModels, preferredModel };
  }
  if (allowedModels.includes(learned.primaryModelId)) {
    return { allowedModels, preferredModel: learned.primaryModelId };
  }
  return { allowedModels, preferredModel: allowedModels[0] ?? preferredModel };
}
