import { DomainValidationError } from "./errors.js";
import {
  isProjectId,
  isRunId,
  isTaskId,
  type ProjectId,
  type RunId,
  type TaskId
} from "./ids.js";
import { isRunLimits, type RunLimits } from "./limits.js";
import { isRunStatus, type RunStatus } from "./status.js";
import { isIsoTimestamp, type IsoTimestamp } from "./timestamp.js";

export interface Run {
  id: RunId;
  projectId: ProjectId;
  parentRunId?: RunId;
  rootTaskId: TaskId;
  status: RunStatus;
  limits: RunLimits;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

function runError(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return "expected an object";
  const run = value as Record<string, unknown>;
  if (!isRunId(run.id)) return "id must be a valid RunId";
  if (!isProjectId(run.projectId)) return "projectId must be a valid ProjectId";
  if (run.parentRunId !== undefined && !isRunId(run.parentRunId)) return "parentRunId must be a valid RunId";
  if (!isTaskId(run.rootTaskId)) return "rootTaskId must be a valid TaskId";
  if (!isRunStatus(run.status)) return "status must be a known RunStatus";
  if (!isRunLimits(run.limits)) return "limits must be valid RunLimits";
  if (!isIsoTimestamp(run.createdAt)) return "createdAt must be a valid IsoTimestamp";
  if (!isIsoTimestamp(run.updatedAt)) return "updatedAt must be a valid IsoTimestamp";
  return undefined;
}

export function validateRun(value: unknown): Run {
  const reason = runError(value);
  if (reason !== undefined) {
    throw new DomainValidationError(`Invalid Run: ${reason}`);
  }
  return value as Run;
}
