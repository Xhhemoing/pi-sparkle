import { DomainValidationError } from "./errors.js";
import { isProjectId, type ProjectId } from "./ids.js";
import { isIsoTimestamp, type IsoTimestamp } from "./timestamp.js";

export interface DiscoveredFile {
  path: string;
}

export interface DetectedCommand {
  name: string;
  command: string;
}

export const FACT_CONFIDENCES = ["LOW", "MEDIUM", "HIGH"] as const;
export type FactConfidence = (typeof FACT_CONFIDENCES)[number];

export interface ProjectFact {
  key: string;
  value: string;
  confidence: FactConfidence;
}

export interface ProjectSnapshot {
  id: ProjectId;
  rootPath: string;
  gitRootPath?: string;
  discoveredAt: IsoTimestamp;
  instructionFiles: DiscoveredFile[];
  manifests: DiscoveredFile[];
  commands: DetectedCommand[];
  facts: ProjectFact[];
}

function isDiscoveredFile(value: unknown): value is DiscoveredFile {
  if (typeof value !== "object" || value === null) return false;
  const path = (value as Record<string, unknown>).path;
  return typeof path === "string" && path.trim() !== "";
}

function isDetectedCommand(value: unknown): value is DetectedCommand {
  if (typeof value !== "object" || value === null) return false;
  const command = value as Record<string, unknown>;
  return (
    typeof command.name === "string" &&
    command.name.trim() !== "" &&
    typeof command.command === "string" &&
    command.command.trim() !== ""
  );
}

function isProjectFact(value: unknown): value is ProjectFact {
  if (typeof value !== "object" || value === null) return false;
  const fact = value as Record<string, unknown>;
  return (
    typeof fact.key === "string" &&
    fact.key.trim() !== "" &&
    typeof fact.value === "string" &&
    fact.value.trim() !== "" &&
    (FACT_CONFIDENCES as readonly string[]).includes(String(fact.confidence))
  );
}

function snapshotError(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return "expected an object";
  const snapshot = value as Record<string, unknown>;
  if (!isProjectId(snapshot.id)) return "id must be a valid ProjectId";
  if (typeof snapshot.rootPath !== "string" || snapshot.rootPath.trim() === "") {
    return "rootPath must be a non-empty string";
  }
  if (snapshot.gitRootPath !== undefined && (typeof snapshot.gitRootPath !== "string" || snapshot.gitRootPath.trim() === "")) {
    return "gitRootPath must be a non-empty string";
  }
  if (!isIsoTimestamp(snapshot.discoveredAt)) return "discoveredAt must be a valid IsoTimestamp";
  if (!Array.isArray(snapshot.instructionFiles) || !snapshot.instructionFiles.every(isDiscoveredFile)) {
    return "instructionFiles must be an array of {path}";
  }
  if (!Array.isArray(snapshot.manifests) || !snapshot.manifests.every(isDiscoveredFile)) {
    return "manifests must be an array of {path}";
  }
  if (!Array.isArray(snapshot.commands) || !snapshot.commands.every(isDetectedCommand)) {
    return "commands must be an array of {name, command}";
  }
  if (!Array.isArray(snapshot.facts) || !snapshot.facts.every(isProjectFact)) {
    return "facts must be an array of {key, value, confidence}";
  }
  return undefined;
}

export function validateProjectSnapshot(value: unknown): ProjectSnapshot {
  const reason = snapshotError(value);
  if (reason !== undefined) {
    throw new DomainValidationError(`Invalid ProjectSnapshot: ${reason}`);
  }
  return value as ProjectSnapshot;
}
