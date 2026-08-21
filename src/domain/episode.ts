import { DomainValidationError } from "./errors.js";
import type { EpisodeId, ProjectId, RunId, EvidenceId } from "./ids.js";
import type { IsoTimestamp } from "./timestamp.js";
import { isIsoTimestamp } from "./timestamp.js";
import { isRecord } from "./record.js";

export type EpisodeStatus = "OPEN" | "WAITING_FOR_USER" | "COMPLETED" | "FAILED" | "ABANDONED";

export interface AcceptanceCriterion {
  readonly id: string;
  readonly description: string;
  readonly observableCheck: string;
}

export interface AcceptanceEvidence {
  readonly criterionId: string;
  readonly evidenceId: EvidenceId;
  readonly result: "PASSED" | "FAILED";
  readonly sourceRef: string;
}

export interface ProjectEpisode {
  readonly id: EpisodeId;
  readonly projectId: ProjectId;
  readonly objective: string;
  readonly contractVersion: number;
  readonly runIds: readonly RunId[];
  readonly startedAt: IsoTimestamp;
  readonly closedAt?: IsoTimestamp | undefined;
  readonly status: EpisodeStatus;
  readonly acceptance: readonly AcceptanceCriterion[];
  readonly evidenceRefs: readonly EvidenceId[];
  readonly acceptanceEvidence?: readonly AcceptanceEvidence[] | undefined;
  readonly outcomeId?: string | undefined;
}

const EPISODE_STATUS_VALUES: EpisodeStatus[] = ["OPEN", "WAITING_FOR_USER", "COMPLETED", "FAILED", "ABANDONED"];

export function isEpisodeStatus(value: unknown): value is EpisodeStatus {
  return typeof value === "string" && (EPISODE_STATUS_VALUES as readonly string[]).includes(value);
}

export function validateEpisode(input: unknown): ProjectEpisode {
  if (!isRecord(input)) {
    throw new DomainValidationError("Episode must be an object");
  }
  const {
    id,
    projectId,
    objective,
    contractVersion,
    runIds,
    startedAt,
    closedAt,
    status,
    acceptance,
    evidenceRefs,
    acceptanceEvidence,
    outcomeId
  } = input as Record<string, unknown>;

  if (typeof id !== "string" || !id.startsWith("ep_")) {
    throw new DomainValidationError("Episode.id must be a valid EpisodeId");
  }
  if (typeof projectId !== "string" || !projectId.startsWith("prj_")) {
    throw new DomainValidationError("Episode.projectId must be a valid ProjectId");
  }
  if (typeof objective !== "string" || objective.trim().length === 0) {
    throw new DomainValidationError("Episode.objective must be a non-empty string");
  }
  if (typeof contractVersion !== "number" || !Number.isInteger(contractVersion) || contractVersion < 0) {
    throw new DomainValidationError("Episode.contractVersion must be a non-negative integer");
  }
  if (!Array.isArray(runIds) || !runIds.every((r) => typeof r === "string" && r.startsWith("run_"))) {
    throw new DomainValidationError("Episode.runIds must be an array of RunId strings");
  }
  if (typeof startedAt !== "string" || !isIsoTimestamp(startedAt)) {
    throw new DomainValidationError("Episode.startedAt must be a valid IsoTimestamp");
  }
  if (closedAt !== undefined) {
    if (typeof closedAt !== "string" || !isIsoTimestamp(closedAt)) {
      throw new DomainValidationError("Episode.closedAt must be a valid IsoTimestamp when present");
    }
  }
  if (!isEpisodeStatus(status)) {
    throw new DomainValidationError(`Episode.status must be one of ${EPISODE_STATUS_VALUES.join(", ")}`);
  }
  if (!Array.isArray(acceptance) || acceptance.some((a) => !isRecord(a) || typeof (a as Record<string, unknown>).id !== "string" || typeof (a as Record<string, unknown>).description !== "string")) {
    throw new DomainValidationError("Episode.acceptance must be an array of AcceptanceCriterion objects");
  }
  if (!Array.isArray(evidenceRefs) || !evidenceRefs.every((e) => typeof e === "string" && e.startsWith("evd_"))) {
    throw new DomainValidationError("Episode.evidenceRefs must be an array of EvidenceId strings");
  }
  if (
    acceptanceEvidence !== undefined &&
    (!Array.isArray(acceptanceEvidence) || acceptanceEvidence.some((entry) =>
      !isRecord(entry) ||
      typeof entry.criterionId !== "string" ||
      typeof entry.evidenceId !== "string" ||
      !entry.evidenceId.startsWith("evd_") ||
      (entry.result !== "PASSED" && entry.result !== "FAILED") ||
      typeof entry.sourceRef !== "string" ||
      entry.sourceRef.trim() === ""
    ))
  ) {
    throw new DomainValidationError("Episode.acceptanceEvidence must contain validated criterion evidence");
  }
  if (outcomeId !== undefined && typeof outcomeId !== "string") {
    throw new DomainValidationError("Episode.outcomeId must be a string when present");
  }

  return {
    id: id as EpisodeId,
    projectId: projectId as ProjectId,
    objective,
    contractVersion,
    runIds: runIds as readonly RunId[],
    startedAt: startedAt as IsoTimestamp,
    closedAt: closedAt as IsoTimestamp | undefined,
    status,
    acceptance: acceptance as readonly AcceptanceCriterion[],
    evidenceRefs: evidenceRefs as readonly EvidenceId[],
    acceptanceEvidence: acceptanceEvidence as readonly AcceptanceEvidence[] | undefined,
    outcomeId: outcomeId as string | undefined
  };
}
