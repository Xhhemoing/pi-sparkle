import { join } from "node:path";
import { assignTasks, type TaskAssignment } from "../routing/assign.js";
import { runAutoAdaptLoop } from "../learning/auto-loop.js";
import type { LearnedRoutingPolicy } from "../learning/learned-routing.js";
import { episodeIdFromEvents } from "../run/episode-bind.js";
import { runtimeRoot } from "../persist/state-layout.js";
import type { NativeRoutingCatalog } from "./routing-catalog.js";
import {
  CoreNativeSession, resolveNativeModel as resolveCoreNativeModel,
  type NativeModel, type NativeCoreDelegateInput, type NativeDelegateResult
} from "./core-session.js";

export type { NativeModel, NativeTask, NativeDelegateResult } from "./core-session.js";

/** Legacy compatibility default; the product entry uses an explicit host ref. */
export function resolveNativeModel<T extends NativeModel>(available: readonly T[], preferred = "grok-4.7"): T {
  return resolveCoreNativeModel(available, preferred);
}
export interface NativeRoutingInput {
  readonly catalog: NativeRoutingCatalog;
  readonly learned?: LearnedRoutingPolicy | undefined;
}
export interface NativeDelegateInput extends NativeCoreDelegateInput {
  readonly routing?: NativeRoutingInput | undefined;
}
function canonicalModel(catalog: NativeRoutingCatalog, modelId: string): string {
  return catalog.aliases[modelId] ?? modelId;
}

function canonicalLearnedPolicy(
  catalog: NativeRoutingCatalog,
  learned: LearnedRoutingPolicy | undefined
): LearnedRoutingPolicy | undefined {
  if (learned === undefined) return undefined;
  return {
    primaryModelId: canonicalModel(catalog, learned.primaryModelId),
    avoid: learned.avoid.map((entry) => ({ ...entry, modelId: canonicalModel(catalog, entry.modelId) })),
    prefer: learned.prefer.map((entry) => ({ ...entry, modelId: canonicalModel(catalog, entry.modelId) })),
    ...(learned.assignments !== undefined ? {
      assignments: learned.assignments.map((entry) => ({ ...entry, model: canonicalModel(catalog, entry.model) }))
    } : {})
  };
}

function canonicalAssignment(catalog: NativeRoutingCatalog, assignment: TaskAssignment): TaskAssignment {
  return {
    ...assignment,
    allowedModels: assignment.allowedModels.map((model) => canonicalModel(catalog, model)),
    preferredModel: canonicalModel(catalog, assignment.preferredModel),
    decision: {
      ...assignment.decision,
      model: canonicalModel(catalog, assignment.decision.model),
      eligibleModels: assignment.decision.eligibleModels.map((model) => canonicalModel(catalog, model))
    }
  };
}

/** Explicit legacy/lab adapter. Execution ownership belongs to the shared core. */
export class NativeSession {
  private readonly core = new CoreNativeSession();
  get activeCount(): number { return this.core.activeCount; }

  delegate(input: NativeDelegateInput): Promise<NativeDelegateResult> {
    const { routing, ...coreInput } = input;
    return this.core.delegate(coreInput, {
      ...(routing !== undefined ? { plan: (tasks) => ({
        assignments: assignTasks({
          tasks, catalog: routing.catalog.config,
          ...(routing.learned !== undefined ? { learned: canonicalLearnedPolicy(routing.catalog, routing.learned) } : {})
        }).map((assignment) => canonicalAssignment(routing.catalog, assignment)),
        requiredModelIds: routing.catalog.config.models.map((model) => model.id)
      }) } : {}),
      analyze: async ({ outcome, modelId }) => {
        const episodeId = episodeIdFromEvents(outcome.events);
        const adapted = await runAutoAdaptLoop({
          stateRoot: input.stateRoot, projectRoot: input.projectRoot, projectId: outcome.project.id,
          primaryModelId: modelId, events: outcome.events,
          // Explicit run-local input only; never ingest ambient transcripts.
          subagentRunsDir: join(runtimeRoot(input.stateRoot), "runs", outcome.runId, "native-signals"),
          ...(episodeId !== undefined ? { episodeId } : {})
        });
        return adapted.reason;
      }
    });
  }

  shutdown(): Promise<void> { return this.core.shutdown(); }
}
