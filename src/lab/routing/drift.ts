import type { TaskFeatures } from "./bandit.js";

export interface DriftConfig {
  /** Number of recent observations used to compute the novelty ratio. */
  readonly windowSize: number;
  /** Fraction of novel feature signatures tolerated before drift is declared. */
  readonly threshold: number;
}

export interface DriftMonitor {
  observe(features: TaskFeatures): void;
  readonly drifted: boolean;
  /** 1 normally; >1 widens uncertainty when drifted. */
  readonly uncertaintyScale: number;
}

export const DEFAULT_DRIFT_CONFIG: DriftConfig = {
  windowSize: 8,
  threshold: 0.5,
};

/**
 * Lightweight distribution-shift monitor: the first window of feature
 * signatures becomes the baseline; later windows with too many signatures
 * unseen in the baseline declare drift and widen uncertainty.
 */
export function createDriftMonitor(config: DriftConfig = DEFAULT_DRIFT_CONFIG): DriftMonitor {
  const baseline = new Map<string, number>();
  const recent: string[] = [];
  let baselineFrozen = false;
  let drifted = false;

  function signature(features: TaskFeatures): string {
    return [
      `featureVersion=${features.featureVersion}`,
      `taskFamily=${features.taskFamily}`,
      `role=${features.role}`,
      `contextTokens=${features.contextTokens}`,
      `outputTokens=${features.outputTokens}`,
      `capabilities=${[...features.capabilities].sort().join(",")}`,
    ].join("|");
  }

  return {
    observe(features: TaskFeatures): void {
      const sig = signature(features);
      recent.push(sig);
      if (!baselineFrozen) {
        baseline.set(sig, (baseline.get(sig) ?? 0) + 1);
        if (recent.length >= config.windowSize) baselineFrozen = true;
        return;
      }
      if (recent.length > config.windowSize) recent.shift();
      const novelCount = recent.filter((s) => !baseline.has(s)).length;
      drifted = novelCount / recent.length > config.threshold;
    },
    get drifted(): boolean {
      return drifted;
    },
    get uncertaintyScale(): number {
      return drifted ? 2 : 1;
    },
  };
}
