import { snapshotTaskContext, type TaskContextInput } from "../context/task-context.js";
import { snapshotCheckFindingAnalysis, type CheckFindingAnalysisOptions } from "../evaluation/check-finding-analysis.js";
import {
  NativeWriteSession,
  type NativeWriteSessionInput,
  type NativeWriteSessionOptions,
  type NativeWriteSessionResult
} from "../native/write-session.js";
import { DomainValidationError } from "../domain/errors.js";
import { snapshotTaskPresentation, type TaskPresentationInput } from "../preferences/task-presentation.js";
import { snapshotNativeHostEvaluator, type NativeHostEvaluator } from "../native/host-outcome.js";
import { snapshotStaticWriteRouting, type StaticWriteRoutingInput } from "../routing/write-routing.js";

/** Experimental host input; no queue, budget or automatic source application. */
export interface StartDevelopmentTaskInput extends NativeWriteSessionOptions, NativeWriteSessionInput {}

/**
 * Run one isolated development task using the existing native-write authority.
 * The host owns the verifier and executor. Candidates and evidence are retained
 * after session shutdown; successful verification does not apply source edits.
 * This deep module entry is experimental, not a stable package SDK export.
 */
export async function startDevelopmentTask(input: StartDevelopmentTaskInput): Promise<NativeWriteSessionResult> {
  // Validate before destructuring: a rest spread would invoke an accessor and
  // turn its return value into an ordinary data property before native preflight.
  const descriptor = Object.getOwnPropertyDescriptor(input, "presentation");
  if ((descriptor === undefined && "presentation" in input) || (descriptor !== undefined && !("value" in descriptor))) {
    throw new DomainValidationError("task presentation must be an own data property");
  }
  const presentation = snapshotTaskPresentation(descriptor?.value as TaskPresentationInput | undefined);
  const contextDescriptor = Object.getOwnPropertyDescriptor(input, "taskContext");
  if ((contextDescriptor === undefined && "taskContext" in input) || (contextDescriptor !== undefined && !("value" in contextDescriptor))) {
    throw new DomainValidationError("task context must be an own data property");
  }
  const taskContext = contextDescriptor?.value === undefined ? undefined : snapshotTaskContext(contextDescriptor.value as TaskContextInput);
  const routingDescriptor = Object.getOwnPropertyDescriptor(input, "staticRouting");
  if ((routingDescriptor === undefined && "staticRouting" in input) || (routingDescriptor !== undefined && !("value" in routingDescriptor))) {
    throw new DomainValidationError("static routing must be an own data property");
  }
  const staticRouting = snapshotStaticWriteRouting(routingDescriptor?.value as StaticWriteRoutingInput | undefined);
  const evaluatorDescriptor = Object.getOwnPropertyDescriptor(input, "hostEvaluator");
  if ((evaluatorDescriptor === undefined && "hostEvaluator" in input) || (evaluatorDescriptor !== undefined && !("value" in evaluatorDescriptor))) {
    throw new DomainValidationError("host evaluator must be an own data property");
  }
  const hostEvaluator = snapshotNativeHostEvaluator(evaluatorDescriptor?.value as NativeHostEvaluator | undefined);
  const analysisDescriptor = Object.getOwnPropertyDescriptor(input, "checkFindingAnalysis");
  if ((analysisDescriptor === undefined && "checkFindingAnalysis" in input) ||
      (analysisDescriptor !== undefined && !("value" in analysisDescriptor))) {
    throw new DomainValidationError("check finding analysis must be an own data property");
  }
  const checkFindingAnalysis = snapshotCheckFindingAnalysis(analysisDescriptor?.value as CheckFindingAnalysisOptions | undefined);
  const { stateRoot, executorFactory, sandboxRoot, hostEvaluator: _hostEvaluator, checkFindingAnalysis: _analysis,
    presentation: _presentation, taskContext: _taskContext, staticRouting: _staticRouting, ...task } = input;
  const session = new NativeWriteSession({ stateRoot, executorFactory,
    ...(hostEvaluator === undefined ? {} : { hostEvaluator }),
    ...(checkFindingAnalysis === undefined ? {} : { checkFindingAnalysis }),
    ...(sandboxRoot === undefined ? {} : { sandboxRoot }) });
  try {
    return await session.execute({ ...task, ...(presentation === undefined ? {} : { presentation }),
      ...(taskContext === undefined ? {} : { taskContext }), ...(staticRouting === undefined ? {} : { staticRouting }) });
  } finally {
    await session.shutdown();
  }
}
