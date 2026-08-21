import type { TaskOutcome, VerificationKind } from "../protocol/v1.js";

export interface TaskSuccessRouteBinding {
  readonly modelId?: string | undefined;
  readonly modelVersion?: string | undefined;
  readonly family?: string | undefined;
  readonly featureVersion?: string | undefined;
  readonly role?: string | undefined;
}

export interface TaskSuccessObservation {
  readonly criterion: "taskSuccess";
  readonly outcomeKind: "PASS" | "FAIL";
  readonly source: "deterministic";
  readonly modelId?: string | undefined;
  readonly modelVersion?: string | undefined;
  readonly family?: string | undefined;
  readonly featureVersion?: string | undefined;
  readonly role?: string | undefined;
}

/**
 * TASK_RESULT writes taskSuccess only for verification PASSED/FAILED.
 * UNOBSERVED, PARTIAL, and CANCELLED are omitted. Missing route fields are omitted, never invented.
 */
export function taskSuccessFromResult(
  outcome: TaskOutcome,
  verification: VerificationKind,
  binding?: TaskSuccessRouteBinding
): TaskSuccessObservation | undefined {
  if (outcome === "PARTIAL" || outcome === "CANCELLED") return undefined;
  if (verification !== "PASSED" && verification !== "FAILED") return undefined;
  return observe(verification === "PASSED" ? "PASS" : "FAIL", binding);
}

/** Project test command exit code 0 → PASS, any other numeric code → FAIL. */
export function taskSuccessFromExitCode(
  exitCode: number,
  binding?: TaskSuccessRouteBinding
): TaskSuccessObservation {
  return observe(exitCode === 0 ? "PASS" : "FAIL", binding);
}

function observe(
  outcomeKind: "PASS" | "FAIL",
  binding: TaskSuccessRouteBinding | undefined
): TaskSuccessObservation {
  return {
    criterion: "taskSuccess",
    outcomeKind,
    source: "deterministic",
    ...copyDefinedBinding(binding)
  };
}

function copyDefinedBinding(binding: TaskSuccessRouteBinding | undefined): TaskSuccessRouteBinding {
  if (binding === undefined) return {};
  return {
    ...(present(binding.modelId) ? { modelId: binding.modelId } : {}),
    ...(present(binding.modelVersion) ? { modelVersion: binding.modelVersion } : {}),
    ...(present(binding.family) ? { family: binding.family } : {}),
    ...(present(binding.featureVersion) ? { featureVersion: binding.featureVersion } : {}),
    ...(present(binding.role) ? { role: binding.role } : {})
  };
}

function present(value: string | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}
