import type { EpisodeSignatureKind } from "./signatures.js";

export interface AttributionResult {
  readonly boundary: EpisodeSignatureKind;
  readonly earliestSupported: string;
  readonly confidence: number;
}

const BOUNDARY_ORDER: EpisodeSignatureKind[] = [
  "contract",
  "context",
  "plan",
  "route",
  "execution",
  "tool",
  "review",
  "delivery",
];

export function attributeToBoundary(
  patterns: Array<{ kind: EpisodeSignatureKind; count: number }>
): AttributionResult {
  if (patterns.length === 0) {
    return {
      boundary: "contract",
      earliestSupported: "contract",
      confidence: 0,
    };
  }

  const sorted = [...patterns].sort(
    (a, b) =>
      BOUNDARY_ORDER.indexOf(a.kind) - BOUNDARY_ORDER.indexOf(b.kind)
  );

  const earliest = sorted[0];
  if (!earliest) {
    return {
      boundary: "contract",
      earliestSupported: "contract",
      confidence: 0,
    };
  }

  const confidence = Math.min(1, earliest.count / 3);

  return {
    boundary: earliest.kind,
    earliestSupported: earliest.kind,
    confidence,
  };
}

export function applyNegativeControl(
  patterns: Array<{ key: string; negativeControl: boolean }>
): Array<{ key: string; negativeControl: boolean }> {
  return patterns.map((p) => ({
    ...p,
    negativeControl: p.key.includes("read") || p.key.includes("edit-only"),
  }));
}
