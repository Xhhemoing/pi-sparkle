import type { ModelDescriptor } from "../routing/capability-registry.js";
import type { OutcomeObservation } from "../routing/outcomes.js";
import type { R0Decision } from "../routing/r0.js";
import { routeR1 } from "../routing/r1.js";

/**
 * Post-run shadow: what R1 would have selected. Invoked is always false —
 * this must not run a model. Live coordinators must not import this module.
 */
export interface ShadowCompareInput {
  readonly r0: R0Decision;
  readonly role: string;
  readonly featureVersion: string;
  readonly models: readonly ModelDescriptor[];
  readonly observations: readonly OutcomeObservation[];
  readonly nowMs: number;
  readonly liveModelId: string;
}

export interface ShadowCompareResult {
  readonly liveModelId: string;
  readonly shadowModelId: string | undefined;
  readonly invoked: false;
  readonly agree: boolean;
  readonly reason: string;
}

export function compareShadowR1(input: ShadowCompareInput): ShadowCompareResult {
  const decision = routeR1({
    r0: input.r0,
    role: input.role,
    featureVersion: input.featureVersion,
    models: input.models,
    observations: input.observations,
    nowMs: input.nowMs
  });
  return {
    liveModelId: input.liveModelId,
    shadowModelId: decision.selection,
    invoked: false,
    agree: decision.selection === input.liveModelId,
    reason: decision.reason
  };
}
