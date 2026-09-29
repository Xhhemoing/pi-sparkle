import type { ProjectId } from "../domain/ids.js";
import { observationIdentity } from "./observation-ledger.js";
import type { ObservedSignal } from "./signals.js";

export interface ModelProjectIssue {
  readonly projectId: ProjectId;
  readonly modelId: string;
  readonly samples: number;
  readonly meanScore: number;
  readonly failures: number;
  readonly family?: string | undefined;
  readonly role?: string | undefined;
  readonly modelVersion?: string | undefined;
  readonly featureVersion?: string | undefined;
  readonly actionable: boolean;
  readonly kinds: readonly string[];
}

const ACTIONABLE_MEAN = 0.45;
const ACTIONABLE_SAMPLES = 5;

type Binding = Pick<ObservedSignal, "projectId" | "modelId" | "family" | "role" | "modelVersion" | "featureVersion">;

/**
 * Task-bound, stratified taskSuccess diagnostics. Deterministic protocol
 * observations are not independent host acceptance. Non-model failures stay
 * out of model-quality statistics; proposals/activation have separate gates.
 */
export function diagnoseModelProjectIssues(signals: readonly ObservedSignal[]): ModelProjectIssue[] {
  const observations = new Map<string, { signal: ObservedSignal; signature: string; conflict: boolean }>();
  for (const signal of signals) {
    if (signal.criterion !== "taskSuccess" || signal.source === "user" || signal.kind !== "deterministic") continue;
    if (signal.outcomeKind !== "PASS" && signal.outcomeKind !== "FAIL") continue;
    if (!Number.isFinite(signal.score) || signal.score < 0 || signal.score > 100) continue;
    if (!present(signal.modelId)) continue;
    const stratum = bindingKey(signal);
    const key = taskBound(signal)
      ? JSON.stringify(["task", signal.projectId, signal.runId, signal.taskId, signal.criterion])
      : JSON.stringify(["unbound", stratum, observationIdentity(signal)]);
    const signature = JSON.stringify([stratum, signal.outcomeKind, signal.failureClass ?? null, signal.score]);
    const prior = observations.get(key);
    if (prior === undefined) observations.set(key, { signal, signature, conflict: false });
    else if (prior.signature !== signature) prior.conflict = true;
  }

  const groups = new Map<string, ObservedSignal[]>();
  for (const { signal, conflict } of observations.values()) {
    if (conflict) continue;
    // Apply attribution after conflict detection: a provider/model disagreement
    // must not become a model-negative sample simply by dropping the provider row.
    if (signal.outcomeKind === "FAIL" && signal.failureClass !== "model") continue;
    const key = bindingKey(signal);
    const group = groups.get(key) ?? [];
    group.push(signal);
    groups.set(key, group);
  }

  const issues: ModelProjectIssue[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    if (first === undefined || first.modelId === undefined) continue;
    const samples = group.length;
    const meanScore = group.reduce((sum, item) => sum + item.score, 0) / samples / 100;
    const failures = group.filter((item) => item.outcomeKind === "FAIL").length;
    issues.push({
      projectId: first.projectId,
      modelId: first.modelId,
      samples,
      meanScore,
      failures,
      kinds: [...new Set(group.map((item) => item.kind))].sort(),
      actionable: samples >= ACTIONABLE_SAMPLES && meanScore < ACTIONABLE_MEAN && failures > 0 && group.every(taskBound),
      ...(present(first.family) ? { family: first.family } : {}),
      ...(present(first.role) ? { role: first.role } : {}),
      ...(present(first.modelVersion) ? { modelVersion: first.modelVersion } : {}),
      ...(present(first.featureVersion) ? { featureVersion: first.featureVersion } : {})
    });
  }
  return issues.sort((left, right) => {
    const score = left.meanScore - right.meanScore;
    if (score !== 0) return score;
    const a = bindingKey(left);
    const b = bindingKey(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function bindingKey(signal: Binding): string {
  // JSON tuples cannot collide through delimiters in a project/model name;
  // null is deliberately distinct from literal "unknown" (and from a wildcard).
  return JSON.stringify([signal.projectId, signal.modelId,
    present(signal.family) ? signal.family : null,
    present(signal.role) ? signal.role : null,
    present(signal.modelVersion) ? signal.modelVersion : null,
    present(signal.featureVersion) ? signal.featureVersion : null]);
}

function taskBound(signal: ObservedSignal): boolean {
  return present(signal.runId) && present(signal.taskId);
}

function present(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "";
}
