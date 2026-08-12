import { DomainValidationError } from "./errors.js";
import {
  isArtifactId,
  isEventId,
  isEvidenceId,
  type ArtifactId,
  type EventId,
  type EvidenceId
} from "./ids.js";

export const EVIDENCE_KINDS = [
  "PROJECT_FACT",
  "AGENT_MESSAGE",
  "TOOL_EVENT",
  "COMMAND_RESULT",
  "TEST_RESULT",
  "GIT_DIFF",
  "REVIEW_RESULT"
] as const;

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const CONFIDENCE_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const REDACTION_MODES = ["NONE", "REDACTED", "REFERENCE_ONLY"] as const;
export type RedactionMode = (typeof REDACTION_MODES)[number];

export interface Evidence {
  id: EvidenceId;
  kind: EvidenceKind;
  summary: string;
  sourceEventId: EventId;
  confidence: ConfidenceLevel;
  redaction: RedactionMode;
}

export const ARTIFACT_KINDS = ["TEXT", "JSON", "FILE_DIFF", "COMMAND_OUTPUT"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export interface Artifact {
  id: ArtifactId;
  kind: ArtifactKind;
  contentPath?: string;
  sha256?: string;
  createdByEventId: EventId;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function evidenceError(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return "expected an object";
  const evidence = value as Record<string, unknown>;
  if (!isEvidenceId(evidence.id)) return "id must be a valid EvidenceId";
  if (!isOneOf(EVIDENCE_KINDS, evidence.kind)) return "kind must be a known EvidenceKind";
  if (typeof evidence.summary !== "string" || evidence.summary.trim() === "") {
    return "summary must be a non-empty string";
  }
  if (!isEventId(evidence.sourceEventId)) return "sourceEventId must be a valid EventId";
  if (!isOneOf(CONFIDENCE_LEVELS, evidence.confidence)) return "confidence must be a known ConfidenceLevel";
  if (!isOneOf(REDACTION_MODES, evidence.redaction)) return "redaction must be a known RedactionMode";
  return undefined;
}

function artifactError(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return "expected an object";
  const artifact = value as Record<string, unknown>;
  if (!isArtifactId(artifact.id)) return "id must be a valid ArtifactId";
  if (!isOneOf(ARTIFACT_KINDS, artifact.kind)) return "kind must be a known ArtifactKind";
  if (artifact.contentPath !== undefined && (typeof artifact.contentPath !== "string" || artifact.contentPath.trim() === "")) {
    return "contentPath must be a non-empty string";
  }
  if (artifact.sha256 !== undefined && (typeof artifact.sha256 !== "string" || !SHA256_PATTERN.test(artifact.sha256))) {
    return "sha256 must be a 64-character hex string";
  }
  if (!isEventId(artifact.createdByEventId)) return "createdByEventId must be a valid EventId";
  return undefined;
}

export function isEvidence(value: unknown): value is Evidence {
  return evidenceError(value) === undefined;
}

export function validateEvidence(value: unknown): Evidence {
  const reason = evidenceError(value);
  if (reason !== undefined) {
    throw new DomainValidationError(`Invalid Evidence: ${reason}`);
  }
  return value as Evidence;
}

export function isArtifact(value: unknown): value is Artifact {
  return artifactError(value) === undefined;
}

export function validateArtifact(value: unknown): Artifact {
  const reason = artifactError(value);
  if (reason !== undefined) {
    throw new DomainValidationError(`Invalid Artifact: ${reason}`);
  }
  return value as Artifact;
}
