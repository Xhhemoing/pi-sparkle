/** Repository-local research composition; the default runtime does not import it. */
import { applyLearnedRouting, loadLearnedRouting, type LearnedRoutingPolicy } from "./learning/learned-routing.js";
import { analyzeTask } from "../routing/analyze-task.js";
import { mappedAgentRole } from "../run/flowchart-child-recovery.js";
import * as core from "../run/flowchart-run.js";
import type { FlowchartNodePolicyInput, FlowchartRunDeps } from "../run/flowchart-run.js";
export * from "../run/flowchart-run.js";
function familyForFlowNode(node: FlowchartNodePolicyInput): string {
  const mapped = node.agentRole ?? mappedAgentRole(node.role);
  if (mapped !== undefined) return analyzeTask(node.objective, mapped).family;
  return node.role;
}

function applyLearnedToNode(node: FlowchartNodePolicyInput, learned: LearnedRoutingPolicy): FlowchartNodePolicyInput["modelPolicy"] {
  const family = familyForFlowNode(node);
  const originalPreferred = node.modelPolicy.preferredModel;
  const seedPreferred = originalPreferred ?? node.modelPolicy.allowedModels[0]!;
  const applied = applyLearnedRouting(
    family,
    node.modelPolicy.allowedModels,
    seedPreferred,
    learned
  );
  const prefer = learned.prefer.find((entry) => entry.family === family)?.modelId;
  const preferApplied = prefer !== undefined && applied.allowedModels.includes(prefer);
  const modelPolicy =
    preferApplied || originalPreferred !== undefined
      ? { allowedModels: applied.allowedModels, preferredModel: applied.preferredModel }
      : { allowedModels: applied.allowedModels };
  return modelPolicy;
}

/** Load once per start/restore using the canonical project root supplied by core. */
export function withLearnedFlowchartRouting(deps: FlowchartRunDeps): FlowchartRunDeps {
  return { ...deps, loadModelPolicyTransform: async (input) => {
    const learned = await loadLearnedRouting(input.stateRoot, input.projectRoot);
    if (learned === undefined) return undefined;
    return (node) => applyLearnedToNode(node, learned);
  } };
}
export const startFlowchartRun: typeof core.startFlowchartRun = (deps, input) => core.startFlowchartRun(withLearnedFlowchartRouting(deps), input);
export const resumeFlowchartRun: typeof core.resumeFlowchartRun = (deps, runId, continuation) => core.resumeFlowchartRun(withLearnedFlowchartRouting(deps), runId, continuation);
export const unblockFlowchartRun: typeof core.unblockFlowchartRun = (deps, runId, request) => core.unblockFlowchartRun(withLearnedFlowchartRouting(deps), runId, request);
export const pauseFlowchartRun: typeof core.pauseFlowchartRun = (deps, runId, reason) => core.pauseFlowchartRun(withLearnedFlowchartRouting(deps), runId, reason);
export const injectFlowchartRun: typeof core.injectFlowchartRun = (deps, runId, request) => core.injectFlowchartRun(withLearnedFlowchartRouting(deps), runId, request);
