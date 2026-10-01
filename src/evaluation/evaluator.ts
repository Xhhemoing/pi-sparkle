import type {
  CriterionScore,
  EvaluationOutcome,
  EvaluationRecord,
  EvaluationTarget,
  EvaluatorIdentity,
  EvaluatorKind,
  Finding,
  IndependenceClass,
  HostTerminalOutcome,
  HostTerminalOutcomeAssessment,
  HostTerminalOutcomeBinding,
  HostTerminalOutcomeSourceState,
} from "./types.js";
import { HOST_TERMINAL_OUTCOME_SCHEMA, INDEPENDENCE_CLASSES } from "./types.js";
import { DomainValidationError } from "../domain/errors.js";
import { parseStableJsonBytes } from "../domain/canonical-json.js";
import type { Rubric, RubricCriterion } from "../rubric/types.js";
import { createEventId } from "../domain/ids.js";
import { nowIso } from "../domain/timestamp.js";
import type { EpisodeId, RunId, TaskId } from "../domain/ids.js";

export interface EvaluationInput {
  readonly episodeId: EpisodeId;
  readonly taskId?: TaskId;
  readonly runId?: RunId;
  readonly evaluator: EvaluatorIdentity;
  readonly rubric: Rubric;
  readonly evidence: Record<string, string>;
  readonly findings?: Finding[];
  readonly target?: EvaluationTarget;
  readonly independenceClass?: IndependenceClass;
  /** Dependency snapshot carried onto the record; see `EvaluationRecord.dependencyVersions`. */
  readonly dependencyVersions?: Readonly<Record<string, string>>;
}

export interface EvaluationResult {
  readonly record: EvaluationRecord;
  readonly outcome: EvaluationOutcome;
}

export function createEvaluationRecord(input: EvaluationInput): EvaluationRecord {
  if (input.target !== undefined && input.target.artifactId.trim() === "") {
    throw new DomainValidationError("evaluation target artifactId must be non-empty");
  }
  if (
    input.independenceClass !== undefined &&
    !(INDEPENDENCE_CLASSES as readonly string[]).includes(input.independenceClass)
  ) {
    throw new DomainValidationError(
      `unknown independence class: ${String(input.independenceClass)}`,
    );
  }
  const scores: CriterionScore[] = input.rubric.criteria.map((criterion) => {
    const hasEvidence = Boolean(input.evidence[criterion.id]);
    let outcome: EvaluationOutcome;

    if (hasEvidence) {
      outcome = "PASS";
    } else if (input.evaluator.kind === "deterministic") {
      outcome = "FAIL";
    } else {
      outcome = "UNOBSERVED";
    }

    return {
      criterionId: criterion.id,
      outcome,
      evidenceRef: hasEvidence ? input.evidence[criterion.id] : undefined,
      confidence: input.evaluator.kind === "inferential" ? 0.6 : undefined,
      reason: hasEvidence ? undefined : "no evidence provided",
    };
  });

  const hasAnyFail = scores.some((s) => s.outcome === "FAIL");
  const hasAnyPass = scores.some((s) => s.outcome === "PASS");
  const allUnobserved = scores.every((s) => s.outcome === "UNOBSERVED");

  let overall: EvaluationOutcome;
  if (hasAnyFail) {
    overall = "FAIL";
  } else if (allUnobserved) {
    overall = "UNOBSERVED";
  } else if (hasAnyPass) {
    overall = "PASS";
  } else {
    overall = "ABSTAIN";
  }

  // Evaluation records are historical evidence. Copy caller-owned binding
  // objects at creation so later mutation cannot rewrite what the record was
  // evaluated against and make stale evidence appear current.
  const evaluatorSnapshot: EvaluatorIdentity = { ...input.evaluator };
  const targetSnapshot: EvaluationTarget | undefined =
    input.target === undefined
      ? undefined
      : {
          artifactId: input.target.artifactId,
          ...(input.target.artifactVersion !== undefined
            ? { artifactVersion: input.target.artifactVersion }
            : {})
        };
  const dependencySnapshot =
    input.dependencyVersions === undefined ? undefined : { ...input.dependencyVersions };

  return {
    id: createEventId(),
    episodeId: input.episodeId,
    taskId: input.taskId,
    runId: input.runId,
    evaluator: evaluatorSnapshot,
    rubricId: input.rubric.id,
    rubricVersion: input.rubric.version,
    scores,
    findings: input.findings ?? [],
    overall,
    createdAt: nowIso(),
    target: targetSnapshot,
    independenceClass: input.independenceClass,
    dependencyVersions: dependencySnapshot,
  };
}

export function canEvaluatorScoreCriterion(
  evaluatorKind: EvaluatorKind,
  criterion: RubricCriterion
): boolean {
  if (evaluatorKind === "deterministic") {
    return criterion.observableCheck.length > 0;
  }
  return true;
}

export function validateEvaluatorScope(
  evaluator: EvaluatorIdentity,
  rubric: Rubric
): { valid: boolean; reason?: string } {
  if (evaluator.rubricVersion !== String(rubric.version)) {
    return {
      valid: false,
      reason: `rubric version mismatch: evaluator expects ${evaluator.rubricVersion}, rubric is ${rubric.version}`,
    };
  }
  return { valid: true };
}

const HOST_TERMINAL_OUTCOME_FIELDS = [
  "bindingRef",
  "episodeId",
  "evaluatorDefinitionCanonicalJson",
  "evaluatorId",
  "evaluatorVersion",
  "evidenceRefs",
  "failureAttribution",
  "modelId",
  "modelVersion",
  "outcome",
  "outcomeRef",
  "projectId",
  "projectVersion",
  "rubricId",
  "rubricVersion",
  "runId",
  "schemaVersion",
  "sourceKind",
  "targetArtifactId",
  "targetArtifactVersion",
  "taskId"
] as const;

const HOST_BINDING_FIELDS = [
  "outcomeRef",
  "bindingRef",
  "projectId",
  "projectVersion",
  "episodeId",
  "runId",
  "taskId",
  "modelId",
  "modelVersion",
  "targetArtifactId",
  "targetArtifactVersion",
  "evaluatorId",
  "evaluatorVersion",
  "rubricId",
  "rubricVersion",
  "evaluatorDefinitionCanonicalJson"
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonBlank(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new DomainValidationError(`host terminal outcome ${field} must be a non-empty string`);
  }
  return value;
}

export function parseHostTerminalOutcome(recordBytes: Uint8Array): HostTerminalOutcome {
  const parsed = parseStableJsonBytes(recordBytes);
  if (!isRecord(parsed)) {
    throw new DomainValidationError("host terminal outcome must be an object");
  }
  const keys = Object.keys(parsed).sort();
  const expectedKeys = [...HOST_TERMINAL_OUTCOME_FIELDS].sort();
  const unknown = keys.filter((key) => !expectedKeys.includes(key as never));
  const missing = expectedKeys.filter((key) => !Object.hasOwn(parsed, key));
  if (unknown.length > 0) {
    throw new DomainValidationError(`host terminal outcome unknown field(s): ${unknown.join(", ")}`);
  }
  if (missing.length > 0) {
    throw new DomainValidationError(`host terminal outcome missing field(s): ${missing.join(", ")}`);
  }
  if (parsed.schemaVersion !== HOST_TERMINAL_OUTCOME_SCHEMA) {
    throw new DomainValidationError("host terminal outcome schemaVersion is unsupported or legacy");
  }
  if (parsed.sourceKind !== "host-evaluator") {
    throw new DomainValidationError("host terminal outcome sourceKind must be host-evaluator");
  }
  const outcome = parsed.outcome;
  if (outcome !== "PASSED" && outcome !== "FAILED") {
    throw new DomainValidationError("host terminal outcome must be PASSED or FAILED");
  }
  const failureAttribution = parsed.failureAttribution;
  if (failureAttribution !== "none" && failureAttribution !== "model-evaluated") {
    throw new DomainValidationError("host terminal outcome failureAttribution is invalid");
  }
  if (
    (outcome === "PASSED" && failureAttribution !== "none") ||
    (outcome === "FAILED" && failureAttribution !== "model-evaluated")
  ) {
    throw new DomainValidationError(
      "host terminal outcome failureAttribution does not match the evaluated outcome"
    );
  }
  if (
    !Array.isArray(parsed.evidenceRefs) ||
    parsed.evidenceRefs.length === 0 ||
    !parsed.evidenceRefs.every((value) => typeof value === "string" && value.trim() !== "")
  ) {
    throw new DomainValidationError("host terminal outcome evidenceRefs must be non-empty opaque refs");
  }
  if (new Set(parsed.evidenceRefs).size !== parsed.evidenceRefs.length) {
    throw new DomainValidationError("host terminal outcome evidenceRefs must be unique");
  }
  const evaluatorDefinitionCanonicalJson = requireNonBlank(
    parsed,
    "evaluatorDefinitionCanonicalJson"
  );
  parseStableJsonBytes(new TextEncoder().encode(evaluatorDefinitionCanonicalJson));
  return {
    schemaVersion: HOST_TERMINAL_OUTCOME_SCHEMA,
    sourceKind: "host-evaluator",
    outcomeRef: requireNonBlank(parsed, "outcomeRef"),
    bindingRef: requireNonBlank(parsed, "bindingRef"),
    projectId: requireNonBlank(parsed, "projectId"),
    projectVersion: requireNonBlank(parsed, "projectVersion"),
    episodeId: requireNonBlank(parsed, "episodeId"),
    runId: requireNonBlank(parsed, "runId"),
    taskId: requireNonBlank(parsed, "taskId"),
    modelId: requireNonBlank(parsed, "modelId"),
    modelVersion: requireNonBlank(parsed, "modelVersion"),
    targetArtifactId: requireNonBlank(parsed, "targetArtifactId"),
    targetArtifactVersion: requireNonBlank(parsed, "targetArtifactVersion"),
    evaluatorId: requireNonBlank(parsed, "evaluatorId"),
    evaluatorVersion: requireNonBlank(parsed, "evaluatorVersion"),
    rubricId: requireNonBlank(parsed, "rubricId"),
    rubricVersion: requireNonBlank(parsed, "rubricVersion"),
    evaluatorDefinitionCanonicalJson,
    outcome,
    failureAttribution,
    evidenceRefs: parsed.evidenceRefs
  };
}

export function assessHostTerminalOutcome(input: {
  readonly recordBytes?: Uint8Array | undefined;
  readonly sourceState: HostTerminalOutcomeSourceState;
  readonly expected: HostTerminalOutcomeBinding;
}): HostTerminalOutcomeAssessment {
  if (input.sourceState !== "available") {
    return { eligible: false, outcome: "UNOBSERVED", reason: input.sourceState };
  }
  if (input.recordBytes === undefined) {
    return { eligible: false, outcome: "UNOBSERVED", reason: "missing" };
  }
  let record: HostTerminalOutcome;
  try {
    record = parseHostTerminalOutcome(input.recordBytes);
  } catch (error) {
    return {
      eligible: false,
      outcome: "UNOBSERVED",
      reason: error instanceof Error ? error.message : "invalid terminal outcome"
    };
  }
  for (const field of HOST_BINDING_FIELDS) {
    if (record[field] !== input.expected[field]) {
      return { eligible: false, outcome: "UNOBSERVED", reason: `binding mismatch: ${field}` };
    }
  }
  return { eligible: true, outcome: record.outcome, record };
}
