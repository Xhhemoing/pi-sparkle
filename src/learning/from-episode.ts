import { DomainValidationError } from "../domain/errors.js";
import type { ProjectId, RunId } from "../domain/ids.js";
import { isAgentRole } from "../domain/roles.js";
import { hashCandidateContent } from "../adaptation/candidate.js";
import { ResourceRegistry } from "../adaptation/registry.js";
import {
  loadAdaptationRegistry,
  saveAdaptationRegistry,
  withAdaptationRegistryLock
} from "../adaptation/promotion.js";
import { EventStore } from "../run/event-store.js";
import type { Event, ModelRoutedPayload } from "../run/events.js";
import type { TaskFamily } from "../task/taxonomy.js";
import { oneHotDistribution } from "../routing/catalog-model.js";
import { classifyTaskFailure } from "../routing/failure-class.js";
import {
  observationsForR1,
  parseOutcomeObservation,
  type OutcomeObservation
} from "../routing/outcomes.js";
import {
  routingPolicyContent,
  routingPolicyIdentity,
  type LearnedAvoid,
  type LearnedRoutingPolicy
} from "./learned-routing.js";

const LEARN_EVALUATION_PLAN = {
  stages: ["static", "replay"],
  metrics: ["task-success", "cost"],
  planVersion: 1
} as const;

const FAMILIES: readonly TaskFamily[] = [
  "edit",
  "test",
  "review",
  "plan",
  "research",
  "refactor",
  "deploy",
  "unknown"
];

export interface LearnFromOutcomesInput {
  readonly stateRoot: string;
  readonly projectRoot: string;
  readonly projectId: ProjectId;
  readonly primaryModelId: string;
  readonly outcomes: readonly OutcomeObservation[];
}

export interface LearnFromAssignmentsResult {
  readonly candidateId?: string;
  readonly parentVersionId?: string;
  readonly created: boolean;
  readonly reason: string;
}

/** @deprecated Use LearnFromOutcomesInput. Assignments without outcomes cannot create a policy. */
export interface LearnFromAssignmentsInput extends LearnFromOutcomesInput {
  readonly assignments?: readonly unknown[];
}

function policyFromOutcomes(
  primaryModelId: string,
  outcomes: readonly OutcomeObservation[]
): LearnedRoutingPolicy | undefined {
  const usable = observationsForR1(outcomes);
  if (usable.length === 0) return undefined;
  const avoid: LearnedAvoid[] = [];
  const seen = new Set<string>();
  for (const row of usable) {
    if (row.outcome !== "FAIL") continue;
    const key = `${row.modelId}|${row.taskFamily}`;
    if (seen.has(key)) continue;
    seen.add(key);
    avoid.push({
      modelId: row.modelId,
      family: row.taskFamily,
      reason: "deterministic-check taskSuccess FAIL (failureClass=model)"
    });
  }
  if (avoid.length === 0) return undefined;
  return { primaryModelId, avoid, prefer: [] };
}

/**
 * Proposal-first learning: write a routing-policy candidate from bound
 * taskSuccess outcomes. Selections without outcomes are not labels.
 *
 * The candidate is the only thing this writes. It also used to call
 * `recordInferredPreference` for the run's episode, which no CLI invocation
 * could ever keep: `adapt learn` does not bind the preference store, so the
 * observation was discarded at process exit, and one-shot commands can never
 * accumulate `MIN_INFERRED_RECURRENCE_DEFAULT` anyway. The CLI's
 * inferred-preference plane is not live, and re-adding the call would not make
 * it live. `recordInferredPreference` stays an embedder API for hosts that bind
 * the store themselves; such a host is a preference-snapshot writer and owes
 * `preferenceSnapshotLockPath` across bind, mutate and persist.
 */
export async function proposeRoutingFromOutcomes(
  input: LearnFromOutcomesInput
): Promise<LearnFromAssignmentsResult> {
  const policy = policyFromOutcomes(input.primaryModelId, input.outcomes);
  if (policy === undefined) {
    return { created: false, reason: "no bound taskSuccess outcomes" };
  }
  const content = routingPolicyContent(policy);
  const contentHash = hashCandidateContent(content);
  const identity = routingPolicyIdentity(input.projectRoot);
  const result = await withAdaptationRegistryLock(input.stateRoot, async () => {
    let registry: ResourceRegistry;
    try {
      registry = await loadAdaptationRegistry(input.stateRoot);
    } catch (error) {
      if (!(error instanceof DomainValidationError) || !/no registry snapshot/.test(error.message)) {
        throw error;
      }
      registry = new ResourceRegistry();
    }
    let parent = registry.getActiveVersion(identity);
    if (parent === undefined) {
      parent = registry.registerBaseline({
        identity,
        content: routingPolicyContent({
          primaryModelId: input.primaryModelId,
          avoid: [],
          prefer: []
        }),
        author: { kind: "detector", identity: "pi-sparkle-learn" }
      });
    }
    const existing = registry
      .candidatesFor(identity)
      .find((candidate) => candidate.contentHash === contentHash);
    if (existing !== undefined) {
      return {
        created: false,
        reason: "identical candidate already proposed",
        candidateId: existing.candidateId,
        parentVersionId: parent.versionId
      };
    }
    if (parent.contentHash === contentHash) {
      return {
        created: false,
        reason: "observed policy matches the active baseline",
        parentVersionId: parent.versionId
      };
    }
    const candidate = registry.createCandidate({
      identity,
      content,
      parentVersionId: parent.versionId,
      author: { kind: "detector", identity: "pi-sparkle-learn" },
      evaluationPlan: LEARN_EVALUATION_PLAN
    });
    await saveAdaptationRegistry(input.stateRoot, registry);
    return {
      created: true,
      reason: "proposed routing-policy candidate",
      candidateId: candidate.candidateId,
      parentVersionId: parent.versionId
    };
  });
  return result;
}

/** Assignments without bound outcomes never create a routing-policy candidate. */
export async function proposeRoutingFromAssignments(
  input: LearnFromAssignmentsInput
): Promise<LearnFromAssignmentsResult> {
  return proposeRoutingFromOutcomes(input);
}

export async function proposeRoutingFromRoutedEvents(input: {
  readonly stateRoot: string;
  readonly runId: RunId;
  readonly primaryModelId: string;
}): Promise<LearnFromAssignmentsResult> {
  const store = new EventStore(input.stateRoot, input.runId);
  const read = await store.readAll();
  let projectId: ProjectId | undefined;
  let projectRoot: string | undefined;
  for (const event of read.events) {
    if (event.type === "PROJECT_DISCOVERED") {
      projectId = event.payload.project.id;
      projectRoot = event.payload.project.rootPath;
    }
  }
  if (projectId === undefined || projectRoot === undefined) {
    return { created: false, reason: "run has no project snapshot" };
  }
  const outcomes = outcomesFromRoutedRun(read.events);
  return proposeRoutingFromOutcomes({
    stateRoot: input.stateRoot,
    projectRoot,
    projectId,
    outcomes,
    primaryModelId: input.primaryModelId
  });
}

export function outcomesFromRoutedRun(events: readonly Event[]): OutcomeObservation[] {
  const routes = new Map<string, ModelRoutedPayload>();
  const out: OutcomeObservation[] = [];
  for (const event of events) {
    if (event.type === "MODEL_ROUTED") {
      const payload = event.payload;
      if (isCompleteRoute(payload)) routes.set(payload.taskId, payload);
      continue;
    }
    if (event.type === "TASK_RETRY") {
      applyCascadeRetry(routes, event.taskId, event.payload.nextModel, event.payload.nextModelVersion);
      continue;
    }
    if (event.type !== "CHILD_MESSAGE") continue;
    const message = event.payload.message;
    if (message.type !== "TASK_RESULT") continue;
    const route = routes.get(message.taskId);
    if (route === undefined) continue;
    const family = familyFromRouted(route.family);
    if (family === undefined) continue;
    const role = route.agentRole;
    if (role === undefined || !isAgentRole(role)) continue;
    const kind = outcomeKindFromResult(message.outcome, message.verification.kind);
    if (kind === undefined) continue;
    const failureClass =
      kind === "FAIL"
        ? classifyTaskFailure({
            outcome: message.outcome,
            verificationKind: message.verification.kind,
            summary: message.summary,
            ...(message.failure !== undefined ? { failure: message.failure } : {})
          })
        : undefined;
    try {
      out.push(
        parseOutcomeObservation({
          taskFamily: family,
          role,
          modelId: route.model,
          modelVersion: route.modelVersion,
          featureVersion: route.featureVersion,
          criterion: "taskSuccess",
          outcome: kind,
          occurredAtMs: Date.parse(event.occurredAt),
          source: "deterministic-check",
          ...(failureClass !== undefined ? { failureClass } : {}),
          taskId: message.taskId,
          runId: event.runId,
          evidenceIds: message.evidenceIds
        })
      );
    } catch {
      continue;
    }
  }
  return out;
}

function applyCascadeRetry(
  routes: Map<string, ModelRoutedPayload>,
  taskId: string | undefined,
  nextModel: string | undefined,
  nextModelVersion: string | undefined
): void {
  if (taskId === undefined || nextModel === undefined || nextModel.trim() === "") return;
  const current = routes.get(taskId);
  if (current === undefined) return;
  const eligible = current.eligibleModels.includes(nextModel)
    ? current.eligibleModels
    : [...current.eligibleModels, nextModel];
  routes.set(taskId, {
    ...current,
    model: nextModel,
    modelVersion:
      nextModelVersion !== undefined && nextModelVersion.trim() !== ""
        ? nextModelVersion
        : current.modelVersion,
    behaviorDistribution: oneHotDistribution(eligible, nextModel)
  });
}

function isCompleteRoute(payload: ModelRoutedPayload): boolean {
  return (
    typeof payload.family === "string" &&
    payload.family.trim() !== "" &&
    typeof payload.featureVersion === "string" &&
    payload.featureVersion.trim() !== "" &&
    typeof payload.modelVersion === "string" &&
    payload.modelVersion.trim() !== "" &&
    typeof payload.agentRole === "string"
  );
}

function familyFromRouted(value: string): TaskFamily | undefined {
  return (FAMILIES as readonly string[]).includes(value) ? (value as TaskFamily) : undefined;
}

function outcomeKindFromResult(
  outcome: string,
  verification: string
): "PASS" | "FAIL" | undefined {
  if (verification === "PASSED") return "PASS";
  if (verification === "FAILED") return "FAIL";
  return undefined;
}
