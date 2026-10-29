import { DomainValidationError } from "../../domain/errors.js";
import { isAgentInstanceId, isRunId, isTaskId } from "../../domain/ids.js";
import { isRecord } from "../../domain/record.js";
import type { TaskModelSelection } from "../../domain/task-model-selection.js";

function fail(message: string): never { throw new DomainValidationError(`model submission: ${message}`); }
/** Offline identity evidence only; never restores authority or calculates cost/server reasoning. */
export function verifyTaskModelConsumption(input: {
  readonly loop: unknown; readonly contract: unknown; readonly events: readonly unknown[]; readonly selection: TaskModelSelection;
}): void {
  const { loop, contract, events, selection } = input;
  if (!isRecord(contract) || contract.schemaVersion !== "loop-artifact-v2" || !isRecord(contract.body) ||
      contract.body.kind !== "native-write-task-contract" || !isRunId(contract.runId) || contract.body.runId !== contract.runId || !isTaskId(contract.body.taskId)) fail("invalid task contract identity");
  const body = contract.body;
  if (!isRecord(loop) || loop.schemaVersion !== "loop-artifact-v2" || loop.runId !== contract.runId || !isRecord(loop.body) ||
      loop.body.kind !== "native-write-loop" || loop.body.schemaVersion !== 1 || loop.body.sourceRevision !== body.sourceRevision ||
      loop.body.candidatePath !== body.candidatePath || !Array.isArray(loop.body.attempts) || loop.body.attempts.length !== 1) fail("one complete native attempt bound to source/candidate is required");
  const attempt: unknown = loop.body.attempts[0], summary = loop.body.referenceCost;
  if (!isRecord(attempt) || attempt.number !== 1 || attempt.runId !== contract.runId || !isRecord(attempt.taskContractArtifact) ||
      attempt.taskContractArtifact.id !== contract.id || !isRecord(summary) || summary.settled !== true ||
      !Array.isArray(summary.attempts) || summary.attempts.length !== 1) fail("contract reference or settled report population mismatch");
  const costAttempt: unknown = summary.attempts[0];
  // Native stores the first fault only: a price-only fault can hide a later identity fault.
  // Keep every faulty native population UNOBSERVED without expanding its receipt schema.
  if (!isRecord(costAttempt) || costAttempt.number !== 1 || costAttempt.fault !== undefined || !isRecord(costAttempt.report)) fail("missing or faulty execution report");
  const report = costAttempt.report;
  if (!isRunId(report.runId) || !isAgentInstanceId(report.agentInstanceId) || report.taskId !== body.taskId || report.settled !== true ||
      !Number.isSafeInteger(report.streamDispatches) || (report.streamDispatches as number) <= 0 ||
      !Array.isArray(report.sdkObservations) || report.sdkObservations.length !== report.streamDispatches) fail("missing, unsettled or incomplete dispatch population");
  const children = events.filter(event => isRecord(event) && event.runId === contract.runId && event.type === "CHILD_RUN_CREATED");
  const requests = events.filter(event => isRecord(event) && event.runId === contract.runId && event.type === "CHILD_MESSAGE" &&
    isRecord(event.payload) && isRecord(event.payload.message) && event.payload.message.type === "TASK_REQUEST");
  if (children.length !== 1 || requests.length !== 1) fail("complete unique worker/request population is required");
  const childEvent = children[0], requestEvent = requests[0];
  if (!isRecord(childEvent) || childEvent.taskId !== body.taskId || !isRecord(childEvent.payload) || !isRecord(childEvent.payload.childRun) ||
      childEvent.payload.childRun.id !== report.runId || childEvent.payload.childRun.parentRunId !== contract.runId ||
      childEvent.payload.childRun.rootTaskId !== body.taskId || !isRecord(requestEvent) || requestEvent.taskId !== body.taskId ||
      !isRecord(requestEvent.payload) || !isRecord(requestEvent.payload.message) || requestEvent.payload.message.runId !== report.runId ||
      requestEvent.payload.message.taskId !== body.taskId || requestEvent.payload.message.to !== report.agentInstanceId) fail("worker run/task/agent identity mismatch");
  const seen = new Set<number>();
  for (const raw of report.sdkObservations) {
    if (!isRecord(raw) || !Number.isSafeInteger(raw.dispatchIndex) || (raw.dispatchIndex as number) < 1 ||
        (raw.dispatchIndex as number) > report.sdkObservations.length || seen.has(raw.dispatchIndex as number)) fail("duplicate or missing dispatch identity");
    seen.add(raw.dispatchIndex as number);
    if (raw.provider !== selection.providerId || raw.model !== selection.modelId || raw.transportReasoning !== selection.thinkingLevel ||
        (raw.resultProvider !== undefined && raw.resultProvider !== selection.providerId) ||
        (raw.resultModel !== undefined && raw.resultModel !== selection.modelId)) fail("model/thinking submission or result identity does not match the fixed recipe");
  }
}
