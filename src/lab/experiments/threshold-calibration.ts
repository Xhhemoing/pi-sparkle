/**
 * Phase C Task 6: soft-threshold calibration over a frozen labeled set.
 * Informational only — the live tracking threshold is never changed here
 * (`changesLiveConfig` is always false; `applyUserThreshold` is not called).
 */

export interface CalibrationLabel {
  /** Tracking score in [0, 1]. */
  readonly score: number;
  /** Frozen human/oracle label: would waking have been right? */
  readonly shouldWake: boolean;
}

export interface ThresholdCalibrationReport {
  readonly thresholds: readonly (0.45 | 0.55 | 0.65)[];
  readonly rows: readonly {
    readonly threshold: number;
    readonly f1: number;
    readonly precision: number;
    readonly recall: number;
  }[];
  /** Best-F1 threshold on this frozen set; informational only. */
  readonly recommendedThreshold: number;
  readonly liveThresholdUnchanged: 0.55;
  readonly changesLiveConfig: false;
}

function metricsAt(
  labels: readonly CalibrationLabel[],
  threshold: number
): { f1: number; precision: number; recall: number } {
  // Predicted wake <=> score < threshold (matches live soft-gate semantics).
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const label of labels) {
    const predicted = label.score < threshold;
    if (predicted && label.shouldWake) tp += 1;
    else if (predicted && !label.shouldWake) fp += 1;
    else if (!predicted && label.shouldWake) fn += 1;
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { f1, precision, recall };
}

export function calibrateSoftThreshold(
  labels: readonly CalibrationLabel[]
): ThresholdCalibrationReport {
  const thresholds = [0.45, 0.55, 0.65] as const;
  const rows = thresholds.map((threshold) => ({ threshold, ...metricsAt(labels, threshold) }));
  let best = rows[0];
  for (const row of rows) {
    if (row.f1 > (best?.f1 ?? -1)) best = row;
  }
  return {
    thresholds,
    rows,
    recommendedThreshold: best?.threshold ?? 0.55,
    liveThresholdUnchanged: 0.55,
    changesLiveConfig: false
  };
}
