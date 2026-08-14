export type OutcomeKind = "PASS" | "FAIL" | "ABSTAIN" | "UNOBSERVED";

export interface OutcomeObservation {
  readonly taskFamily: string;
  readonly role: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly featureVersion: string;
  readonly outcome: OutcomeKind;
  readonly occurredAtMs: number;
}

export interface OutcomeKeyParts {
  readonly taskFamily: string;
  readonly role: string;
  readonly modelVersion: string;
  readonly featureVersion: string;
}

/** Estimates are keyed by task family, role, model version, and feature version. */
export function outcomeKey(parts: OutcomeKeyParts): string {
  return `${parts.taskFamily}|${parts.role}|${parts.modelVersion}|${parts.featureVersion}`;
}

/** ABSTAIN and UNOBSERVED are not evidence — they must not become failures or zeros. */
export function isInformativeOutcome(observation: OutcomeObservation): boolean {
  return observation.outcome === "PASS" || observation.outcome === "FAIL";
}
