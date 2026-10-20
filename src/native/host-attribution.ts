import { isDeepStrictEqual } from "node:util";
import { DomainValidationError } from "../domain/errors.js";
import { isInvocationId } from "../domain/ids.js";
import { isIsoTimestamp } from "../domain/timestamp.js";
import type { HostTerminalOutcome } from "../evaluation/types.js";
import type { NativeHostObservation } from "./host-outcome.js";
import { isNativeHostObservation } from "./write-session.js";
import { isInvocation, type ModelInvocation } from "../telemetry/model-invocation.js";
import { summarizeUsageCoverage, type UsageCoverageSummary } from "../telemetry/usage-coverage.js";

export interface PrepareHostAttributionInput {
  readonly observations: readonly unknown[];
  /** Optional exact join to issued snapshots; never supplies missing facts. */
  readonly invocations?: readonly ModelInvocation[];
  readonly cutoff: string;
  readonly evidenceMode: "observed" | "synthetic";
}

export interface HostAttributionReferences {
  readonly logicalTaskId?: string;
  readonly parentRunId?: string;
  readonly taskId?: string;
  readonly outcomeRef?: string;
  readonly bindingRef?: string;
  readonly attemptRunIds: readonly string[];
  readonly executionRunIds: readonly string[];
  readonly invocationIds: readonly string[];
}

export interface EligibleHostAttribution {
  readonly refs: HostAttributionReferences;
  readonly record: HostTerminalOutcome;
  readonly split: "training" | "test";
  readonly usageCoverage: UsageCoverageSummary;
}

export type HostAttributionExclusionReason =
  | "untrusted-observation"
  | "conflicting-observation"
  | "conflicting-invocation"
  | "missing-invocation"
  | "unbound-invocation"
  | "missing-identity"
  | "missing-time"
  | "invalid-task-time"
  | "cross-boundary-task"
  | "unknown-executor-provenance"
  | "mixed-executor-provenance"
  | "evidence-mode-mismatch"
  | "host-unobserved";

export interface ExcludedHostAttribution {
  readonly refs: HostAttributionReferences;
  readonly reason: HostAttributionExclusionReason;
  readonly detail?: string;
  /** Genuine recorded usage survives label exclusion; untrusted rows have none. */
  readonly usageCoverage: UsageCoverageSummary;
}

export interface HostAttributionPreparation {
  readonly evidenceMode: "observed" | "synthetic";
  readonly cutoff: string;
  readonly eligible: readonly EligibleHostAttribution[];
  readonly excluded: readonly ExcludedHostAttribution[];
  readonly training: readonly EligibleHostAttribution[];
  readonly test: readonly EligibleHostAttribution[];
  /** All genuine observations, including unavailable/error/cancelled labels. */
  readonly overallCoverage: UsageCoverageSummary;
  readonly trainingCoverage: UsageCoverageSummary;
  readonly testCoverage: UsageCoverageSummary;
}

const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const sortedUnique = (values: readonly string[]): string[] => [...new Set(values)].sort(compare);
const emptyRefs = (): HostAttributionReferences => ({ attemptRunIds: [], executionRunIds: [], invocationIds: [] });

function references(observation: NativeHostObservation): HostAttributionReferences {
  const record = observation.assessment.record;
  return {
    logicalTaskId: observation.logicalTaskId, parentRunId: observation.runId, taskId: observation.taskId,
    outcomeRef: observation.artifact.id,
    ...(record === undefined ? {} : { bindingRef: record.bindingRef }),
    attemptRunIds: sortedUnique(observation.attempts.map((attempt) => attempt.runId)),
    executionRunIds: sortedUnique(observation.attempts.flatMap((attempt) => attempt.executions.map((execution) => execution.runId))),
    invocationIds: sortedUnique(observation.invocations.map((row) => row.id))
  };
}

function addVariant(rows: Map<string, ModelInvocation[]>, row: ModelInvocation): void {
  const variants = rows.get(row.id);
  if (variants === undefined) rows.set(row.id, [row]);
  else if (!variants.some((variant) => isDeepStrictEqual(variant, row))) variants.push(row);
}

/** Inspect own data only; even an excluded join must not execute accessors. */
function dataRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length > 0) return undefined;
  const entries = Object.entries(Object.getOwnPropertyDescriptors(value));
  if (entries.some(([, descriptor]) => !("value" in descriptor))) return undefined;
  return Object.fromEntries(entries.map(([key, descriptor]) => [key, descriptor.value]));
}

function joinedIdentity(value: unknown): string | undefined {
  try {
    if (typeof value !== "object" || value === null) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, "id");
    return descriptor !== undefined && "value" in descriptor && isInvocationId(descriptor.value) ? descriptor.value : undefined;
  } catch { return undefined; }
}

function snapshotJoin(value: unknown): ModelInvocation | undefined {
  try {
    const row = dataRecord(value);
    if (row === undefined) return undefined;
    const config = dataRecord(row.config);
    if (config === undefined) return undefined;
    row.config = config;
    if (row.pricing !== undefined) {
      const pricing = dataRecord(row.pricing);
      if (pricing === undefined) return undefined;
      row.pricing = pricing;
    }
    return isInvocation(row) ? row : undefined;
  } catch { return undefined; }
}

function hasIdentity(observation: NativeHostObservation): boolean {
  const text = (value: unknown): boolean => typeof value === "string" && value.trim() !== "";
  const final = observation.attempts.at(-1);
  return [observation.logicalTaskId, observation.runId, observation.taskId, observation.sourceRevision, observation.artifact.id].every(text) &&
    final !== undefined && final.runId === observation.runId && final.taskId === observation.taskId &&
    observation.attempts.every((attempt) => [attempt.runId, attempt.taskId, attempt.projectId, attempt.episodeId].every(text) &&
      attempt.executions.length > 0 && attempt.executions.every((execution) => [execution.runId, execution.taskId, execution.agentInstanceId].every(text)));
}

interface TaskTiming {
  readonly split?: "training" | "test";
  readonly reason?: "missing-identity" | "missing-time" | "invalid-task-time" | "cross-boundary-task";
}

function taskTiming(observations: readonly NativeHostObservation[], cutoff: number): TaskTiming {
  let earliest = Infinity;
  let latest = -Infinity;
  for (const observation of observations) {
    if (!hasIdentity(observation)) return { reason: "missing-identity" };
    const times = [observation.startedAt, observation.completedAt, ...observation.invocations.map((row) => row.occurredAt)];
    if (!times.every(isIsoTimestamp)) return { reason: "missing-time" };
    if (Date.parse(observation.startedAt) > Date.parse(observation.completedAt)) return { reason: "invalid-task-time" };
    for (const time of times) {
      earliest = Math.min(earliest, Date.parse(time));
      latest = Math.max(latest, Date.parse(time));
    }
  }
  if (latest < cutoff) return { split: "training" };
  if (earliest >= cutoff) return { split: "test" };
  return { reason: "cross-boundary-task" };
}

/**
 * Read-only offline preparation. Only original session-issued objects provide
 * authority, identity, time and usage. Saved JSON is historical inspection.
 * Optional telemetry must match those snapshots exactly, even when a snapshot
 * leaves a version, token count or price unknown. No inference or online writes.
 */
export function prepareHostAttribution(input: PrepareHostAttributionInput): HostAttributionPreparation {
  if (!isIsoTimestamp(input.cutoff)) throw new DomainValidationError("host attribution cutoff must be an explicit ISO timestamp");
  if (input.evidenceMode !== "observed" && input.evidenceMode !== "synthetic") {
    throw new DomainValidationError("host attribution evidence mode must be observed or synthetic");
  }
  const eligible: EligibleHostAttribution[] = [];
  const excluded: ExcludedHostAttribution[] = [];
  const originals = new Set<NativeHostObservation>();
  for (const value of input.observations) {
    // Do not inspect untrusted lookalike metadata, including usage or timestamps.
    if (!isNativeHostObservation(value)) excluded.push({ refs: emptyRefs(), reason: "untrusted-observation", usageCoverage: summarizeUsageCoverage([]) });
    else originals.add(value);
  }

  const observations: NativeHostObservation[] = [];
  const evidence = new Map<string, NativeHostObservation[]>();
  for (const observation of originals) {
    const variants = evidence.get(observation.artifact.id);
    if (variants === undefined) evidence.set(observation.artifact.id, [observation]);
    else if (!variants.some((variant) => isDeepStrictEqual(variant, observation))) variants.push(observation);
  }
  const evidenceConflicts = new Set<NativeHostObservation>();
  for (const variants of evidence.values()) {
    observations.push(...variants);
    if (variants.length > 1) for (const observation of variants) evidenceConflicts.add(observation);
  }
  observations.sort((left, right) => compare(left.logicalTaskId, right.logicalTaskId) || compare(left.artifact.id, right.artifact.id));

  const rows = new Map<string, ModelInvocation[]>();
  const tasks = new Map<string, NativeHostObservation[]>();
  for (const observation of observations) {
    for (const row of observation.invocations) addVariant(rows, row);
    const group = tasks.get(observation.logicalTaskId);
    if (group === undefined) tasks.set(observation.logicalTaskId, [observation]);
    else group.push(observation);
  }
  const joinedIds = new Set<string>();
  const joinConflicts = new Set<string>();
  const unboundIds = new Set<string>();
  for (const row of input.invocations ?? []) {
    const id = joinedIdentity(row);
    if (id === undefined) throw new DomainValidationError("host attribution invocation join requires an own data invocation identity");
    if (!rows.has(id)) { unboundIds.add(id); continue; }
    joinedIds.add(id);
    const snapshot = snapshotJoin(row);
    if (snapshot === undefined || !rows.get(id)!.some((original) => isDeepStrictEqual(original, snapshot))) joinConflicts.add(id);
    // External joins may invalidate labels. Only genuine snapshots enter usage.
  }
  const coverage = (ids: readonly string[]): UsageCoverageSummary => summarizeUsageCoverage(
    sortedUnique(ids).flatMap((id) => rows.get(id) ?? [])
  );
  for (const id of [...unboundIds].sort(compare)) {
    excluded.push({ refs: { ...emptyRefs(), invocationIds: [id] }, reason: "unbound-invocation", usageCoverage: summarizeUsageCoverage([]) });
  }
  const timings = new Map([...tasks].map(([id, group]) => [id, taskTiming(group, Date.parse(input.cutoff))]));
  for (const observation of observations) {
    const refs = references(observation);
    const usageCoverage = coverage(refs.invocationIds);
    const timing = timings.get(observation.logicalTaskId)!;
    let reason: HostAttributionExclusionReason | undefined;
    if (evidenceConflicts.has(observation)) reason = "conflicting-observation";
    else if (refs.invocationIds.some((id) => rows.get(id)!.length > 1 || joinConflicts.has(id))) reason = "conflicting-invocation";
    else if (input.invocations !== undefined && refs.invocationIds.some((id) => !joinedIds.has(id))) reason = "missing-invocation";
    else if (timing.reason !== undefined) reason = timing.reason;
    else if (observation.executorClass === "unknown") reason = "unknown-executor-provenance";
    else if (observation.executorClass === "mixed") reason = "mixed-executor-provenance";
    else if (observation.executorClass !== (input.evidenceMode === "observed" ? "pi" : "faux")) reason = "evidence-mode-mismatch";
    else if (!observation.assessment.eligible || observation.assessment.record === undefined) reason = "host-unobserved";
    if (reason !== undefined) {
      excluded.push({ refs, reason, ...(reason === "host-unobserved" && observation.assessment.reason !== undefined ? { detail: observation.assessment.reason } : {}), usageCoverage });
    } else {
      eligible.push({ refs, record: observation.assessment.record!, split: timing.split!, usageCoverage });
    }
  }
  const key = (row: { readonly refs: HostAttributionReferences }): string => JSON.stringify(row.refs);
  eligible.sort((left, right) => compare(key(left), key(right)));
  excluded.sort((left, right) => compare(key(left), key(right)) || compare(left.reason, right.reason) || compare(left.detail ?? "", right.detail ?? ""));
  const training = eligible.filter((row) => row.split === "training");
  const test = eligible.filter((row) => row.split === "test");
  return {
    evidenceMode: input.evidenceMode, cutoff: input.cutoff, eligible, excluded, training, test,
    overallCoverage: coverage([...rows.keys()]),
    trainingCoverage: coverage(training.flatMap((row) => row.refs.invocationIds)),
    testCoverage: coverage(test.flatMap((row) => row.refs.invocationIds))
  };
}
