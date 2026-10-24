export const HOST_TERMINAL_OUTCOME_SCHEMA = "host-terminal-outcome-v1" as const;

export type HostTerminalOutcomeStatus = "PASSED" | "FAILED";
export type HostTerminalFailureAttribution = "none" | "model-evaluated";

/** Neutral host-owned result. Learning, workers, and model output do not own this DTO. */
export interface HostTerminalOutcome {
  readonly schemaVersion: typeof HOST_TERMINAL_OUTCOME_SCHEMA;
  readonly sourceKind: "host-evaluator";
  readonly outcomeRef: string;
  readonly bindingRef: string;
  readonly projectId: string;
  readonly projectVersion: string;
  readonly episodeId: string;
  readonly runId: string;
  readonly taskId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly targetArtifactId: string;
  readonly targetArtifactVersion: string;
  readonly evaluatorId: string;
  readonly evaluatorVersion: string;
  readonly rubricId: string;
  readonly rubricVersion: string;
  readonly evaluatorDefinitionCanonicalJson: string;
  readonly outcome: HostTerminalOutcomeStatus;
  readonly failureAttribution: HostTerminalFailureAttribution;
  readonly evidenceRefs: readonly string[];
}

export type HostTerminalOutcomeBinding = Pick<
  HostTerminalOutcome,
  | "outcomeRef"
  | "bindingRef"
  | "projectId"
  | "projectVersion"
  | "episodeId"
  | "runId"
  | "taskId"
  | "modelId"
  | "modelVersion"
  | "targetArtifactId"
  | "targetArtifactVersion"
  | "evaluatorId"
  | "evaluatorVersion"
  | "rubricId"
  | "rubricVersion"
  | "evaluatorDefinitionCanonicalJson"
>;

export type HostTerminalOutcomeSourceState =
  | "available"
  | "missing"
  | "deleted"
  | "foreign"
  | "stale"
  | "legacy"
  | "incomplete"
  | "self-reported-only"
  | "identity-drift"
  | "provider-failure"
  | "tool-failure"
  | "run-failure"
  | "timeout"
  | "evaluator-unavailable"
  | "ambiguous-crash-replay";

export interface HostTerminalOutcomeAssessment {
  readonly eligible: boolean;
  readonly outcome: HostTerminalOutcomeStatus | "UNOBSERVED";
  readonly reason?: string | undefined;
  readonly record?: HostTerminalOutcome | undefined;
}
