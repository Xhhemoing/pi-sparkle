import type { EpisodeSignature, EpisodeSignatureKind } from "./signatures.js";

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

export interface NegativeControlMarker {
  /** Feature key inspected on each signature in a cluster. */
  readonly feature: string;
  /** The feature value that indicates a benign cause. */
  readonly negating: unknown;
  /** Human-readable label for reports. */
  readonly label: string;
}

/**
 * Benign causes that may explain a repeated pattern without an actionable
 * defect: repeated reads/edits, missing instrumentation, protective gate
 * blocks, and unrelated failures. Signatures carrying one of these markers
 * must not surface as improvement opportunities.
 */
export const NEGATIVE_CONTROL_MARKERS: readonly NegativeControlMarker[] = [
  { feature: "operation", negating: "read", label: "repeated read" },
  { feature: "operation", negating: "edit", label: "edit-only noise" },
  { feature: "instrumented", negating: false, label: "missing instrumentation" },
  { feature: "gateBlocked", negating: true, label: "protective gate block" },
  { feature: "unrelated", negating: true, label: "unrelated failure" },
] as const;

/**
 * A cluster is a negative control when EVERY signature carries the same
 * benign-cause marker. Partial markers keep the pattern actionable: a single
 * read-heavy episode inside a failure cluster is not enough to discard it.
 */
export function findNegativeControlMarker(
  cluster: readonly EpisodeSignature[]
): NegativeControlMarker | undefined {
  if (cluster.length === 0) return undefined;
  for (const marker of NEGATIVE_CONTROL_MARKERS) {
    if (cluster.every((sig) => sig.features[marker.feature] === marker.negating)) {
      return marker;
    }
  }
  return undefined;
}
