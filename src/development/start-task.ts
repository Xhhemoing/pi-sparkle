import { prepareNativeCheckPlanInput, prepareNativeWorkerTimeout } from "../native/write-preflight.js";
import { prepareNativePhaseTimeLimits } from "../native/write-time-budget.js";
import { snapshotTaskContext, type TaskContextInput } from "../context/task-context.js";
import { snapshotCheckFindingAnalysis, type CheckFindingAnalysisOptions } from "../native/check-finding-analysis.js";
import {
  NativeWriteSession,
  type NativeWriteSessionInput,
  type NativeWriteSessionOptions,
  type NativeWriteSessionResult
} from "../native/write-session.js";
import { DomainValidationError } from "../domain/errors.js";
import { snapshotTaskPresentation, type TaskPresentationInput } from "../preferences/task-presentation.js";
import { snapshotNativeHostEvaluator, type NativeHostEvaluator } from "../native/host-outcome.js";
import { scopedDevelopmentExecutorFactory, snapshotDevelopmentVerification, type DevelopmentScopePolicy } from "./task-policy.js";

/** Experimental host input; no queue, budget or automatic source application. */
export interface StartDevelopmentTaskInput extends NativeWriteSessionOptions, NativeWriteSessionInput {
  /** Host-selected path scope, with a matching original trusted verifier. */
  readonly scopePolicy?: DevelopmentScopePolicy;
}

/**
 * Run one isolated development task using the existing native-write authority.
 * The host owns the verifier and executor. Candidates and evidence are retained
 * after session shutdown; successful verification does not apply source edits.
 * This deep module entry is experimental, not a stable package SDK export.
 */
export async function startDevelopmentTask(input: StartDevelopmentTaskInput): Promise<NativeWriteSessionResult> {
  const phaseTimeLimits = prepareNativePhaseTimeLimits(input);
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
  const workerTimeoutMs = prepareNativeWorkerTimeout(input);
  const plannedCheck = prepareNativeCheckPlanInput(input);
  const checkPlan = plannedCheck?.checkPlan;
  const scopeDescriptor = Object.getOwnPropertyDescriptor(input, "scopePolicy");
  if ((scopeDescriptor === undefined && "scopePolicy" in input) || (scopeDescriptor !== undefined && !("value" in scopeDescriptor))) {
    throw new DomainValidationError("scope policy must be an own data property");
  }
  const scopePolicy = scopeDescriptor?.value as DevelopmentScopePolicy | undefined;
  const verificationDescriptor = Object.getOwnPropertyDescriptor(input, "verification");
  if ((scopePolicy !== undefined || checkPlan !== undefined) && (verificationDescriptor === undefined || !("value" in verificationDescriptor))) {
    throw new DomainValidationError("scoped verification must be an own data property");
  }
  const { stateRoot, executorFactory, sandboxRoot, hostEvaluator: _hostEvaluator, checkFindingAnalysis: _analysis,
    presentation: _presentation, taskContext: _taskContext, scopePolicy: _scopePolicy, checkPlan: _checkPlan, ...task } = input;
  const verification = plannedCheck?.verification ?? (scopePolicy === undefined ? task.verification : snapshotDevelopmentVerification(task.verification));
  const selectedFactory = scopePolicy === undefined ? executorFactory : scopedDevelopmentExecutorFactory(executorFactory, scopePolicy, verification);
  const session = new NativeWriteSession({ stateRoot, executorFactory: selectedFactory,
    ...(hostEvaluator === undefined ? {} : { hostEvaluator }),
    ...(checkFindingAnalysis === undefined ? {} : { checkFindingAnalysis }),
    ...(sandboxRoot === undefined ? {} : { sandboxRoot }) });
  try {
    return await session.execute({ ...task, phaseTimeLimits, verification, ...(workerTimeoutMs === undefined ? {} : { workerTimeoutMs }), ...(checkPlan === undefined ? {} : { checkPlan }), ...(presentation === undefined ? {} : { presentation }),
      ...(taskContext === undefined ? {} : { taskContext }) });
  } finally {
    await session.shutdown();
  }
}
