import { DomainValidationError } from "../domain/errors.js";
import { prepareHostAttribution, type HostAttributionReferences } from "../native/host-attribution.js";
import type { NativeHostObservation } from "../native/host-outcome.js";
import { isNativeHostObservation } from "../native/write-session.js";
import { summarizeUsageCoverage, type UsageCoverageSummary } from "../telemetry/usage-coverage.js";

export interface HostRoutingCaseDeclaration {
  readonly caseId: string;
  readonly problemId: string;
  readonly templateId: string;
  readonly predecision: { readonly taskFamily: string; readonly features: Record<string, number | boolean> };
  readonly candidate: {
    readonly candidateId: string;
    readonly provider: string;
    readonly model: string;
    readonly modelVersion?: string;
    readonly effort?: string;
    readonly toolProfileId: string;
    readonly maxAttempts: number;
    readonly maxWallTimeMs: number;
  };
}
export interface CapturedHostRoutingCase {
  readonly declaration: HostRoutingCaseDeclaration;
  readonly hostObservation?: NativeHostObservation;
}
export interface HostRoutingDatasetRow {
  readonly declaration?: HostRoutingCaseDeclaration;
  readonly refs: HostAttributionReferences;
  readonly actual: readonly { readonly provider: string; readonly model: string; readonly modelVersion?: string; readonly parameterHash: string }[];
  readonly label?: { readonly outcome: "PASSED" | "FAILED"; readonly evaluatorId: string; readonly evaluatorVersion: string;
    readonly rubricId: string; readonly rubricVersion: string };
  readonly split?: "training" | "test";
  readonly exclusionReason?: string;
  readonly hostAttributionExclusion?: { readonly reason: string; readonly detail?: string };
  readonly sourceRevision?: string;
  readonly usageCoverage: UsageCoverageSummary;
  /** Observation interval and sum of recorded call latencies; neither is a provider bill. */
  readonly timing?: { readonly startedAt: string; readonly completedAt: string; readonly wallTimeMs: number;
    readonly recordedInvocationLatencyMs: number };
}
export interface HostRoutingDataset {
  readonly evidenceMode: "observed" | "synthetic";
  readonly cutoff: string;
  readonly rows: readonly HostRoutingDatasetRow[];
  readonly training: readonly HostRoutingDatasetRow[];
  readonly test: readonly HostRoutingDatasetRow[];
  readonly excluded: readonly HostRoutingDatasetRow[];
  readonly overallCoverage: UsageCoverageSummary;
}
interface Capture {
  readonly declaration: HostRoutingCaseDeclaration;
  readonly observation: unknown;
  readonly startedAtMs: number;
}
const captures = new WeakMap<object, Capture>();
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const emptyRefs = (): HostAttributionReferences => ({ attemptRunIds: [], executionRunIds: [], invocationIds: [] });
function invalid(message: string): never { throw new DomainValidationError(`host routing dataset: ${message}`); }

/** Reject accessors without executing them, including non-enumerable properties. */
function data(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length > 0) invalid("expected plain data object");
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Object.values(fields).some((field) => !("value" in field))) invalid("accessors are not data properties");
  if (keys !== undefined && Object.keys(fields).some((key) => !keys.includes(key))) invalid("unapproved declaration field");
  return Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value]));
}
function token(value: unknown, name: string, model = false): string {
  if (typeof value !== "string" || !(model ? /^[A-Za-z0-9][A-Za-z0-9._/-]{0,191}$/ : /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/).test(value) || value.split("/").some((part) => part === "." || part === ".." || part === "")) invalid(`${name} must be a bounded identifier token`);
  return value;
}
function boundedInteger(value: unknown, name: string, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > max) invalid(`${name} must be an integer in 1..${max}`);
  return value;
}
/** Host exclusions can include a terminal explanation; export only known reason codes. */
function hostDetail(detail: string | undefined): string | undefined {
  if (detail?.startsWith("run-failure:")) return "run-failure";
  return detail !== undefined && ["timeout", "cancelled", "unsettled-effects", "malformed-invocation", "conflicting-invocation",
    "foreign-invocation", "invocation-overflow", "provider-failure", "unknown-call-outcome", "tool-failure", "run-failure",
    "original-exact-evidence-required", "exact-binding-mismatch", "unsettled-check", "evaluator-unavailable",
    "evaluator-unavailable-exit", "missing-host-check-or-identity", "host-identity-mismatch", "missing-or-foreign-invocation",
    "unknown-or-mixed-model-version"].includes(detail) ? detail : undefined;
}
function snapshot(value: unknown): HostRoutingCaseDeclaration {
  const d = data(value, ["caseId", "problemId", "templateId", "predecision", "candidate"]);
  const p = data(d.predecision, ["taskFamily", "features"]);
  const features = data(p.features);
  if (Object.keys(features).length > 64) invalid("at most 64 predecision features are allowed");
  for (const [key, value] of Object.entries(features)) {
    token(key, "feature name");
    if (typeof value !== "boolean" && (typeof value !== "number" || !Number.isFinite(value))) invalid("features must be finite numbers or booleans");
  }
  const c = data(d.candidate, ["candidateId", "provider", "model", "modelVersion", "effort", "toolProfileId", "maxAttempts", "maxWallTimeMs"]);
  return Object.freeze({ caseId: token(d.caseId, "caseId"), problemId: token(d.problemId, "problemId"), templateId: token(d.templateId, "templateId"),
    predecision: Object.freeze({ taskFamily: token(p.taskFamily, "taskFamily"), features: Object.freeze(features) as Record<string, number | boolean> }),
    candidate: Object.freeze({ candidateId: token(c.candidateId, "candidateId"), provider: token(c.provider, "provider"), model: token(c.model, "model", true),
      ...(c.modelVersion === undefined ? {} : { modelVersion: token(c.modelVersion, "modelVersion") }),
      ...(c.effort === undefined ? {} : { effort: token(c.effort, "effort") }), toolProfileId: token(c.toolProfileId, "toolProfileId"),
      maxAttempts: boundedInteger(c.maxAttempts, "maxAttempts", 5), maxWallTimeMs: boundedInteger(c.maxWallTimeMs, "maxWallTimeMs", 1_800_000) }) });
}

/**
 * Capture host declarations before dispatch. The host still owns their meaning;
 * effort/tools/budgets are declared metadata, not attested execution settings.
 * Millisecond ordering rejects older observations, not a malicious host clock.
 */
export async function runHostRoutingCase(input: { readonly declaration: HostRoutingCaseDeclaration;
  readonly execute: () => Promise<{ readonly hostObservation?: NativeHostObservation }> }): Promise<CapturedHostRoutingCase> {
  const fields = data(input, ["declaration", "execute"]);
  const declaration = snapshot(fields.declaration);
  if (typeof fields.execute !== "function") invalid("execute must be a function");
  const startedAtMs = Date.now();
  const result: unknown = await (fields.execute as () => Promise<unknown>)();
  // Native results contain other metadata; do not enumerate or copy it.
  const property = typeof result === "object" && result !== null ? Object.getOwnPropertyDescriptor(result, "hostObservation") : undefined;
  if (property !== undefined && !("value" in property)) invalid("host observation must be a data property");
  const observation: unknown = property?.value;
  const captured = Object.freeze({ declaration, ...(isNativeHostObservation(observation) ? { hostObservation: observation } : {}) });
  captures.set(captured, { declaration, observation, startedAtMs });
  return captured;
}

/** Pure offline projection. JSON inspection output cannot re-enter as trusted capture. */
export function prepareHostRoutingDataset(input: { readonly cases: readonly unknown[];
  readonly evidenceMode: "observed" | "synthetic"; readonly cutoff: string }): HostRoutingDataset {
  const fields = data(input, ["cases", "evidenceMode", "cutoff"]);
  if (!Array.isArray(fields.cases)) invalid("cases must be an array");
  const descriptors = Object.getOwnPropertyDescriptors(fields.cases);
  if (Object.values(descriptors).some((field) => !("value" in field)) || Object.getOwnPropertySymbols(fields.cases).length > 0) invalid("cases must use data properties");
  const inputs = Array.from({ length: fields.cases.length }, (_, index) => descriptors[String(index)]?.value as unknown);
  const trusted: Capture[] = [];
  const unknown: HostRoutingDatasetRow[] = [];
  for (const entry of new Set(inputs)) {
    const captured = typeof entry === "object" && entry !== null ? captures.get(entry) : undefined;
    if (captured !== undefined) trusted.push(captured);
    else unknown.push({ refs: emptyRefs(), actual: [], exclusionReason: "untrusted-capture", usageCoverage: summarizeUsageCoverage([]) });
  }
  trusted.sort((a, b) => compare(a.declaration.caseId, b.declaration.caseId) || a.startedAtMs - b.startedAtMs);
  // Recompute eligibility using only original host observations, never caller labels.
  const prepared = prepareHostAttribution({ observations: trusted.map((capture) => capture.observation),
    evidenceMode: fields.evidenceMode as "observed" | "synthetic", cutoff: fields.cutoff as string });
  const observations = trusted.map((capture) => isNativeHostObservation(capture.observation) ? capture.observation : undefined);
  const caseCounts = new Map<string, number>();
  const observationCounts = new Map<NativeHostObservation, number>();
  for (const [index, capture] of trusted.entries()) {
    caseCounts.set(capture.declaration.caseId, (caseCounts.get(capture.declaration.caseId) ?? 0) + 1);
    const observation = observations[index];
    if (observation !== undefined) observationCounts.set(observation, (observationCounts.get(observation) ?? 0) + 1);
  }
  // Union by either identity, not a (problem,template) pair: A-X, A-Y, B-Y are one group.
  const parents = trusted.map((_, index) => index);
  const find = (index: number): number => { while (parents[index] !== index) index = parents[index]!; return index; };
  const problem = new Map<string, number>(), template = new Map<string, number>();
  for (const [index, capture] of trusted.entries()) {
    for (const [map, id] of [[problem, capture.declaration.problemId], [template, capture.declaration.templateId]] as const) {
      const previous = map.get(id);
      if (previous === undefined) map.set(id, index);
      else parents[find(index)] = find(previous);
    }
  }
  const groupTimes = new Map<number, { earliest: number; latest: number; missing: boolean }>();
  for (const [index, observation] of observations.entries()) {
    const id = find(index), times = groupTimes.get(id) ?? { earliest: Infinity, latest: -Infinity, missing: false };
    if (observation === undefined) times.missing = true;
    else for (const timestamp of [observation.startedAt, observation.completedAt, ...observation.invocations.map((row) => row.occurredAt)]) {
      const value = Date.parse(timestamp);
      if (!Number.isFinite(value)) times.missing = true;
      else { times.earliest = Math.min(times.earliest, value); times.latest = Math.max(times.latest, value); }
    }
    groupTimes.set(id, times);
  }
  const cutoff = Date.parse(prepared.cutoff);
  const rows: HostRoutingDatasetRow[] = trusted.map((capture, index) => {
    const observation = observations[index];
    const eligible = observation === undefined ? undefined : prepared.eligible.find((row) => row.refs.outcomeRef === observation.artifact.id);
    const excluded = observation === undefined ? undefined : prepared.excluded.find((row) => row.refs.outcomeRef === observation.artifact.id);
    const refs = eligible?.refs ?? excluded?.refs ?? emptyRefs();
    const usageCoverage = eligible?.usageCoverage ?? excluded?.usageCoverage ?? summarizeUsageCoverage([]);
    const actual = observation === undefined ? [] : [...new Map(observation.invocations.map(({ config }) => {
      const value = { provider: config.provider, model: config.model, ...(config.modelVersion === undefined ? {} : { modelVersion: config.modelVersion }), parameterHash: config.parameterHash };
      return [JSON.stringify(value), value] as const;
    })).values()].sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
    const group = groupTimes.get(find(index))!;
    const c = capture.declaration.candidate;
    let reason = excluded?.reason as string | undefined;
    if (observation === undefined) reason = "untrusted-observation";
    if (observation !== undefined && Date.parse(observation.startedAt) < capture.startedAtMs) reason = "observation-before-capture";
    if (actual.length === 0 || actual.some((config) => config.modelVersion === undefined)) reason ??= "unknown-actual-model-version";
    if (actual.some((config) => config.provider !== c.provider || config.model !== c.model ||
      (c.modelVersion !== undefined && config.modelVersion !== undefined && config.modelVersion !== c.modelVersion))) reason = "candidate-identity-mismatch";
    if (group.missing) reason = "group-time-unavailable";
    else if (group.earliest < cutoff && group.latest >= cutoff) reason = "cross-boundary-group";
    if (observation !== undefined && observationCounts.get(observation)! > 1) reason = "duplicate-observation";
    if (caseCounts.get(capture.declaration.caseId)! > 1) reason = "duplicate-case-id";
    if (eligible === undefined && reason === undefined) reason = "host-unobserved";
    const record = reason === undefined ? eligible?.record : undefined;
    const split = group.latest < cutoff ? "training" as const : "test" as const;
    const detail = hostDetail(excluded?.detail);
    return { declaration: capture.declaration, refs, actual, usageCoverage,
      ...(excluded === undefined ? {} : { hostAttributionExclusion: { reason: excluded.reason, ...(detail === undefined ? {} : { detail }) } }),
      ...(observation === undefined ? {} : { sourceRevision: observation.sourceRevision, timing: { startedAt: observation.startedAt, completedAt: observation.completedAt,
        wallTimeMs: Date.parse(observation.completedAt) - Date.parse(observation.startedAt),
        recordedInvocationLatencyMs: observation.invocations.reduce((sum, row) => sum + row.latencyMs, 0) } }),
      ...(record === undefined ? { exclusionReason: reason! } : { split, label: { outcome: record.outcome,
        evaluatorId: record.evaluatorId, evaluatorVersion: record.evaluatorVersion, rubricId: record.rubricId, rubricVersion: record.rubricVersion } }) };
  });
  rows.push(...unknown);
  return { evidenceMode: prepared.evidenceMode, cutoff: prepared.cutoff, rows,
    training: rows.filter((row) => row.split === "training"), test: rows.filter((row) => row.split === "test"),
    excluded: rows.filter((row) => row.exclusionReason !== undefined), overallCoverage: prepared.overallCoverage };
}
