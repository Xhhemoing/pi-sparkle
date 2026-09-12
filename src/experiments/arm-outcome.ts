import { DomainValidationError } from "../domain/errors.js";

/**
 * PS-P4: split collection success vs task success vs telemetry vs evidenceClass.
 * Harness UNKNOWN / 0 invocations is not a production-candidate experimental
 * outcome. Real task failures that still wrote invocations remain eligible.
 */

export type HoldoutEvidenceClass = "simulation" | "harness-failure" | "production-candidate";

export type TaskSuccessLabel = "PASS" | "FAIL" | "UNOBSERVED";

export type ArmFailureKind = "collect-fail" | "task-fail" | "config-fail" | undefined;

export interface ArmRunResultInput {
  readonly arm: "R0" | "R1" | string;
  readonly invocations: ReadonlyArray<{ readonly id?: string | undefined }>;
  readonly status: string;
  readonly runId?: string | undefined;
  readonly exitCode?: number | undefined;
  /** Independent oracle label when available (arm-blind). */
  readonly oracleTaskSuccess?: TaskSuccessLabel | undefined;
}

export interface ArmOutcomeClassification {
  readonly arm: string;
  readonly collectionSuccess: boolean;
  readonly taskSuccess: TaskSuccessLabel;
  readonly telemetryComplete: boolean;
  readonly evidenceClass: HoldoutEvidenceClass;
  readonly failureKind: ArmFailureKind;
  /** True when this arm may enter paired experimental analysis. */
  readonly experimentEligible: boolean;
}

export interface PairedArmAnalysis {
  readonly evidenceClass: HoldoutEvidenceClass;
  readonly r0: ArmOutcomeClassification;
  readonly r1: ArmOutcomeClassification;
  readonly auditable: {
    readonly collectionAligned: boolean;
    readonly bothExperimentEligible: boolean;
    readonly taskDelta:
      | { readonly kind: "comparable"; readonly r0: TaskSuccessLabel; readonly r1: TaskSuccessLabel }
      | { readonly kind: "incomparable"; readonly reason: string };
  };
}

function statusLooksTerminalSuccess(status: string): boolean {
  return status === "COMPLETED" || status === "SUCCESS" || status === "PASSED";
}

function statusLooksTerminalFailure(status: string): boolean {
  return (
    status === "FAILED" ||
    status === "FAILURE" ||
    status === "ERROR" ||
    status === "CANCELLED" ||
    status === "ABORTED"
  );
}

/**
 * Classify one arm run. Collection failure (no invocations + UNKNOWN/missing
 * runId) is distinct from task failure (invocations present, oracle/status FAIL).
 */
export function classifyArmOutcome(
  input: ArmRunResultInput,
  executor: string
): ArmOutcomeClassification {
  if (executor !== "pi") {
    return {
      arm: input.arm,
      collectionSuccess: input.invocations.length > 0,
      taskSuccess: input.oracleTaskSuccess ?? "UNOBSERVED",
      telemetryComplete: false,
      evidenceClass: "simulation",
      failureKind: undefined,
      experimentEligible: false
    };
  }

  const hasInvocations = input.invocations.length > 0;
  const hasRunId = typeof input.runId === "string" && input.runId.trim() !== "";
  const harnessOnly =
    !hasInvocations && (input.status === "UNKNOWN" || !hasRunId);

  if (harnessOnly) {
    return {
      arm: input.arm,
      collectionSuccess: false,
      taskSuccess: "UNOBSERVED",
      telemetryComplete: false,
      evidenceClass: "harness-failure",
      failureKind: input.status === "UNKNOWN" && !hasRunId ? "config-fail" : "collect-fail",
      experimentEligible: false
    };
  }

  const oracle = input.oracleTaskSuccess;
  let taskSuccess: TaskSuccessLabel;
  if (oracle !== undefined) {
    taskSuccess = oracle;
  } else if (statusLooksTerminalSuccess(input.status)) {
    taskSuccess = "PASS";
  } else if (statusLooksTerminalFailure(input.status)) {
    taskSuccess = "FAIL";
  } else {
    taskSuccess = "UNOBSERVED";
  }

  const collectionSuccess = hasInvocations && hasRunId;
  const telemetryComplete = hasInvocations;
  const failureKind: ArmFailureKind =
    taskSuccess === "FAIL" ? "task-fail" : collectionSuccess ? undefined : "collect-fail";

  return {
    arm: input.arm,
    collectionSuccess,
    taskSuccess,
    telemetryComplete,
    evidenceClass: "production-candidate",
    failureKind,
    experimentEligible: true
  };
}

/**
 * Block-level evidence class. Fake executor → simulation. Every arm
 * harness-only → harness-failure. Otherwise production-candidate (including
 * real task failures with invocation rows).
 */
export function classifyHoldoutBlockEvidenceClass(input: {
  readonly executor: string;
  readonly results: ReadonlyArray<{
    readonly invocations: ReadonlyArray<unknown>;
    readonly status: string;
    readonly runId?: string | undefined;
    readonly arm?: string | undefined;
  }>;
}): HoldoutEvidenceClass {
  if (input.executor !== "pi") return "simulation";
  const harnessOnly = input.results.every(
    (result) =>
      result.invocations.length === 0 &&
      (result.status === "UNKNOWN" || result.runId === undefined)
  );
  return harnessOnly ? "harness-failure" : "production-candidate";
}

/**
 * Independent paired analysis: reconstructible from frozen arm outcomes +
 * optional oracle labels. Does not consult the arm's own self-report when an
 * oracle label is supplied.
 */
export function analyzePairedArms(input: {
  readonly executor: string;
  readonly r0: ArmRunResultInput;
  readonly r1: ArmRunResultInput;
}): PairedArmAnalysis {
  if (input.r0.arm === input.r1.arm) {
    throw new DomainValidationError("paired analysis requires distinct arms");
  }
  const r0 = classifyArmOutcome(input.r0, input.executor);
  const r1 = classifyArmOutcome(input.r1, input.executor);
  const evidenceClass = classifyHoldoutBlockEvidenceClass({
    executor: input.executor,
    results: [input.r0, input.r1]
  });
  const bothExperimentEligible = r0.experimentEligible && r1.experimentEligible;
  const collectionAligned = r0.collectionSuccess === r1.collectionSuccess;
  const taskDelta = bothExperimentEligible
    ? {
        kind: "comparable" as const,
        r0: r0.taskSuccess,
        r1: r1.taskSuccess
      }
    : {
        kind: "incomparable" as const,
        reason: "one or both arms are not experiment-eligible (collect/config failure)"
      };
  return {
    evidenceClass,
    r0,
    r1,
    auditable: {
      collectionAligned,
      bothExperimentEligible,
      taskDelta
    }
  };
}
