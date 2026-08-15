export const RUN_STATUSES = [
  "PLANNING",
  "RUNNING",
  "WAITING_FOR_USER",
  "PAUSED",
  "BLOCKED",
  "COMPLETED",
  "FAILED",
  "CANCELLED"
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export const TASK_STATUSES = [
  "PENDING",
  "READY",
  "RUNNING",
  "COMPLETED",
  "SKIPPED",
  "BLOCKED",
  "FAILED",
  "CANCELLED"
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === "string" && (RUN_STATUSES as readonly string[]).includes(value);
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && (TASK_STATUSES as readonly string[]).includes(value);
}
