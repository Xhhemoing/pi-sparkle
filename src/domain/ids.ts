import { randomUUID } from "node:crypto";
import { DomainValidationError } from "./errors.js";

export type IdBrand =
  | "ProjectId"
  | "RunId"
  | "TaskId"
  | "MessageId"
  | "EventId"
  | "EpisodeId"
  | "ArtifactId"
  | "EvidenceId"
  | "AgentInstanceId"
  | "AgentProfileId"
  | "InvocationId"
  | "CandidateId"
  | "ResourceVersionId";

export type BrandedId<B extends IdBrand> = string & { readonly __brand: B };

export type ProjectId = BrandedId<"ProjectId">;
export type RunId = BrandedId<"RunId">;
export type TaskId = BrandedId<"TaskId">;
export type MessageId = BrandedId<"MessageId">;
export type EventId = BrandedId<"EventId">;
export type EpisodeId = BrandedId<"EpisodeId">;
export type ArtifactId = BrandedId<"ArtifactId">;
export type EvidenceId = BrandedId<"EvidenceId">;
export type AgentInstanceId = BrandedId<"AgentInstanceId">;
export type AgentProfileId = BrandedId<"AgentProfileId">;
export type InvocationId = BrandedId<"InvocationId">;
export type CandidateId = BrandedId<"CandidateId">;
export type ResourceVersionId = BrandedId<"ResourceVersionId">;

const ID_PREFIXES: Record<IdBrand, string> = {
  ProjectId: "prj",
  RunId: "run",
  TaskId: "tsk",
  MessageId: "msg",
  EventId: "evt",
  EpisodeId: "ep",
  ArtifactId: "art",
  EvidenceId: "evd",
  AgentInstanceId: "agt",
  AgentProfileId: "prf",
  InvocationId: "inv",
  CandidateId: "cnd",
  ResourceVersionId: "rsv"
};

const ID_SUFFIX_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export type IdGenerator = () => string;

export function createId<B extends IdBrand>(brand: B, generate?: IdGenerator): BrandedId<B> {
  const prefix = ID_PREFIXES[brand];
  if (prefix === undefined) {
    throw new DomainValidationError(`Unknown id brand: ${brand}`);
  }
  const suffix = (generate ?? randomUUID)();
  if (!ID_SUFFIX_PATTERN.test(suffix)) {
    throw new DomainValidationError(`Invalid ${brand} id suffix: must match ${ID_SUFFIX_PATTERN}`);
  }
  return `${prefix}_${suffix}` as BrandedId<B>;
}

export function isId<B extends IdBrand>(brand: B, value: unknown): value is BrandedId<B> {
  if (typeof value !== "string") return false;
  const prefix = ID_PREFIXES[brand];
  if (prefix === undefined) return false;
  const expectedPrefix = `${prefix}_`;
  return value.startsWith(expectedPrefix) && ID_SUFFIX_PATTERN.test(value.slice(expectedPrefix.length));
}

export function parseId<B extends IdBrand>(brand: B, value: unknown): BrandedId<B> {
  if (!isId(brand, value)) {
    const prefix = ID_PREFIXES[brand];
    throw new DomainValidationError(`Invalid ${brand}: expected "${prefix}_<suffix>"`);
  }
  return value;
}

export const createProjectId = (generate?: IdGenerator): ProjectId => createId("ProjectId", generate);
export const createRunId = (generate?: IdGenerator): RunId => createId("RunId", generate);
export const createTaskId = (generate?: IdGenerator): TaskId => createId("TaskId", generate);
export const createMessageId = (generate?: IdGenerator): MessageId => createId("MessageId", generate);
export const createEventId = (generate?: IdGenerator): EventId => createId("EventId", generate);
export const createEpisodeId = (generate?: IdGenerator): EpisodeId => createId("EpisodeId", generate);
export const createArtifactId = (generate?: IdGenerator): ArtifactId => createId("ArtifactId", generate);
export const createEvidenceId = (generate?: IdGenerator): EvidenceId => createId("EvidenceId", generate);
export const createAgentInstanceId = (generate?: IdGenerator): AgentInstanceId =>
  createId("AgentInstanceId", generate);
export const createAgentProfileId = (generate?: IdGenerator): AgentProfileId =>
  createId("AgentProfileId", generate);
export const createInvocationId = (generate?: IdGenerator): InvocationId =>
  createId("InvocationId", generate);
export const createCandidateId = (generate?: IdGenerator): CandidateId =>
  createId("CandidateId", generate);
export const createResourceVersionId = (generate?: IdGenerator): ResourceVersionId =>
  createId("ResourceVersionId", generate);

export const isProjectId = (value: unknown): value is ProjectId => isId("ProjectId", value);
export const isRunId = (value: unknown): value is RunId => isId("RunId", value);
export const isTaskId = (value: unknown): value is TaskId => isId("TaskId", value);
export const isMessageId = (value: unknown): value is MessageId => isId("MessageId", value);
export const isEventId = (value: unknown): value is EventId => isId("EventId", value);
export const isEpisodeId = (value: unknown): value is EpisodeId => isId("EpisodeId", value);
export const isArtifactId = (value: unknown): value is ArtifactId => isId("ArtifactId", value);
export const isEvidenceId = (value: unknown): value is EvidenceId => isId("EvidenceId", value);
export const isAgentInstanceId = (value: unknown): value is AgentInstanceId => isId("AgentInstanceId", value);
export const isAgentProfileId = (value: unknown): value is AgentProfileId => isId("AgentProfileId", value);
export const isInvocationId = (value: unknown): value is InvocationId => isId("InvocationId", value);
export const isCandidateId = (value: unknown): value is CandidateId => isId("CandidateId", value);
export const isResourceVersionId = (value: unknown): value is ResourceVersionId =>
  isId("ResourceVersionId", value);

export const parseRunId = (value: unknown): RunId => parseId("RunId", value);
export const parseTaskId = (value: unknown): TaskId => parseId("TaskId", value);
export const parseProjectId = (value: unknown): ProjectId => parseId("ProjectId", value);
export const parseAgentProfileId = (value: unknown): AgentProfileId => parseId("AgentProfileId", value);
export const parseEventId = (value: unknown): EventId => parseId("EventId", value);
export const parseEpisodeId = (value: unknown): EpisodeId => parseId("EpisodeId", value);
export const parseMessageId = (value: unknown): MessageId => parseId("MessageId", value);
