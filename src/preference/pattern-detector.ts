import type { PreferenceObservation } from "./types.js";

export interface Pattern {
  readonly key: string;
  readonly count: number;
  readonly avgWeight: number;
  readonly negativeControl: boolean;
}

export function detectRepeatedPatterns(
  observations: PreferenceObservation[],
  minCount = 3
): Pattern[] {
  const map = new Map<string, { count: number; totalWeight: number }>();
  for (const o of observations) {
    const k = `${o.scope}:${o.scopeKey}:${o.key}`;
    const cur = map.get(k) || { count: 0, totalWeight: 0 };
    map.set(k, { count: cur.count + 1, totalWeight: cur.totalWeight + o.weight });
  }
  const patterns: Pattern[] = [];
  map.forEach((v, k) => {
    if (v.count >= minCount) {
      patterns.push({
        key: k,
        count: v.count,
        avgWeight: v.totalWeight / v.count,
        negativeControl: false,
      });
    }
  });
  return patterns;
}
