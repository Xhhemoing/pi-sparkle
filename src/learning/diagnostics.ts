import type { ProjectId } from "../domain/ids.js";
import type { ObservedSignal } from "./signals.js";

export interface ModelProjectIssue {
  readonly projectId: ProjectId;
  readonly modelId: string;
  readonly samples: number;
  readonly meanScore: number;
  readonly failures: number;
  readonly family?: string | undefined;
  readonly actionable: boolean;
  readonly kinds: readonly string[];
}

const ACTIONABLE_MEAN = 0.45;
const ACTIONABLE_SAMPLES = 5;

/** Group taskSuccess observations by (project, model). Other columns stay out of routing quality. */
export function diagnoseModelProjectIssues(signals: readonly ObservedSignal[]): ModelProjectIssue[] {
  const groups = new Map<string, ObservedSignal[]>();
  for (const signal of signals) {
    if (signal.criterion !== "taskSuccess") continue;
    if (signal.source === "user" || signal.kind === "human") continue;
    if (signal.kind !== "deterministic") continue;
    if (signal.modelId === undefined || signal.modelId.trim() === "") continue;
    const key = `${signal.projectId}::${signal.modelId}`;
    const list = groups.get(key) ?? [];
    list.push(signal);
    groups.set(key, list);
  }
  const issues: ModelProjectIssue[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    if (first === undefined || first.modelId === undefined) continue;
    const samples = group.length;
    const meanScore = group.reduce((sum, item) => sum + item.score, 0) / samples / 100;
    const failures = group.filter((item) => item.score < 40).length;
    const kinds = unique(group.map((item) => item.kind));
    const family = mode(group.map((item) => item.family).filter((item): item is string => item !== undefined));
    const independent = kinds.includes("deterministic") && !kinds.includes("human");
    const actionable = samples >= ACTIONABLE_SAMPLES && meanScore < ACTIONABLE_MEAN && independent;
    issues.push({
      projectId: first.projectId,
      modelId: first.modelId,
      samples,
      meanScore,
      failures,
      kinds,
      actionable,
      ...(family !== undefined ? { family } : {})
    });
  }
  return issues.sort((left, right) => left.meanScore - right.meanScore);
}

function unique(values: readonly string[]): string[] {
  const seen: string[] = [];
  for (const value of values) {
    if (!seen.includes(value)) seen.push(value);
  }
  return seen;
}

function mode(values: readonly string[]): string | undefined {
  if (values.length === 0) return undefined;
  const counts = new Map<string, number>();
  let best = values[0]!;
  let bestCount = 0;
  for (const value of values) {
    const next = (counts.get(value) ?? 0) + 1;
    counts.set(value, next);
    if (next > bestCount) {
      best = value;
      bestCount = next;
    }
  }
  return best;
}
