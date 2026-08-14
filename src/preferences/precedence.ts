import type { PreferenceObservation, PreferenceScope } from "./types.js";

export interface PrecedenceRule {
  readonly scope: PreferenceScope;
  readonly priority: number;
}

export const SCOPE_PRECEDENCE: readonly PrecedenceRule[] = [
  { scope: "user", priority: 5 },
  { scope: "project", priority: 4 },
  { scope: "task-family", priority: 3 },
  { scope: "role", priority: 2 },
  { scope: "model", priority: 1 },
] as const;

export function getScopePriority(scope: PreferenceScope): number {
  const rule = SCOPE_PRECEDENCE.find((r) => r.scope === scope);
  return rule ? rule.priority : 0;
}

export function compareScopePriority(a: PreferenceScope, b: PreferenceScope): number {
  return getScopePriority(a) - getScopePriority(b);
}

export function selectHighestPriority(
  observations: readonly PreferenceObservation[]
): PreferenceObservation | undefined {
  if (observations.length === 0) return undefined;
  return observations.reduce((best, current) =>
    compareScopePriority(current.scope, best.scope) > 0 ? current : best
  );
}

export function explicitOverridesInferred(
  explicit: readonly PreferenceObservation[],
  inferred: readonly PreferenceObservation[]
): PreferenceObservation[] {
  const explicitKeys = new Set(explicit.map((e) => `${e.scope}:${e.scopeKey}:${e.key}`));
  return inferred.filter((i) => !explicitKeys.has(`${i.scope}:${i.scopeKey}:${i.key}`));
}
