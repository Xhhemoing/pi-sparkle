import type { EpisodeId, ProjectId } from "../domain/ids.js";
import type { Event } from "../run/events.js";
import type { FlowchartRunDeps } from "../run/flowchart-run.js";
import type { StaticAssignTasksInput, TaskAssignment } from "../routing/static-assign.js";
import { createModelRouter } from "../supervisor/model-router.js";

/** Trusted repository-local composition, never populated from CLI flags or model input. */
export interface CliLabBehavior {
  readonly assignChildren: (input: StaticAssignTasksInput & { readonly stateRoot: string; readonly projectRoot: string }) => Promise<readonly TaskAssignment[]>;
  readonly flowchartRouting: (deps: CliFlowchartRoutingInput) => Pick<FlowchartRunDeps, "loadModelPolicyTransform">;
  readonly afterChildren: (input: {
    readonly stateRoot: string;
    readonly projectRoot: string;
    readonly projectId: ProjectId;
    readonly primaryModelId: string;
    readonly events: readonly Event[];
    readonly assignments: readonly TaskAssignment[];
    readonly episodeId?: EpisodeId;
  }) => Promise<{ readonly reason: string; readonly promoted: boolean; readonly candidateId?: string | undefined }>;
}

/** Policy composition receives no host cancellation, authorization or execution handles. */
export type CliFlowchartRoutingInput = Pick<FlowchartRunDeps, "stateRoot" | "router">;

export function composeCliFlowchartDeps(
  deps: FlowchartRunDeps,
  flowchartRouting?: CliLabBehavior["flowchartRouting"]
): FlowchartRunDeps {
  if (flowchartRouting === undefined) return deps;
  // Detach the router and its config too: a callback must not mutate the host's
  // route method or catalog while returning an otherwise harmless empty result.
  const input: CliFlowchartRoutingInput = {
    stateRoot: deps.stateRoot,
    router: createModelRouter(structuredClone(deps.router.config))
  };
  const { loadModelPolicyTransform } = flowchartRouting(input);
  return loadModelPolicyTransform === undefined ? deps : { ...deps, loadModelPolicyTransform };
}
