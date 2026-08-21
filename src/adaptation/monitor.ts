import { DomainValidationError } from "../domain/errors.js";

export interface DriftObservation {
  readonly modelVersion: string;
  readonly taskFamily: string;
  readonly projectId: string;
  readonly policyVersion: string;
  readonly judgeCalibration: number; // 0-1
}

export interface DriftReport {
  readonly drifted: boolean;
  readonly axes: {
    readonly modelVersion: boolean;
    readonly taskMix: boolean;
    readonly project: boolean;
    readonly policy: boolean;
    readonly judgeCalibration: boolean;
  };
  readonly uncertainty: number; // 0-1, widens on drift
  readonly evidence: readonly string[];
}

export interface AdaptationDriftMonitor {
  observe(obs: DriftObservation): DriftReport;
  snapshot(): readonly DriftObservation[];
  restore(obs: readonly DriftObservation[]): void;
}

interface FrozenBaseline {
  readonly modelVersion: ReadonlySet<string>;
  readonly taskFamily: ReadonlySet<string>;
  readonly projectId: ReadonlySet<string>;
  readonly policyVersion: ReadonlySet<string>;
  readonly meanCalibration: number;
}

const DEFAULT_WINDOW_SIZE = 8;
const DEFAULT_CALIBRATION_DELTA = 0.25;

/**
 * Adaptation-plane drift monitor (not `src/routing/drift.ts`).
 * The first window freezes baseline sets; later windows declare an axis
 * drifted when a majority of values are unseen, or calibration moves too far.
 * Callers propose rollback on non-guardrail drift; this monitor never moves
 * an active pointer.
 */
export function createAdaptationDriftMonitor(options?: {
  readonly windowSize?: number | undefined;
  readonly calibrationDelta?: number | undefined;
}): AdaptationDriftMonitor {
  const windowSize = options?.windowSize ?? DEFAULT_WINDOW_SIZE;
  const calibrationDelta = options?.calibrationDelta ?? DEFAULT_CALIBRATION_DELTA;
  if (!Number.isInteger(windowSize) || windowSize < 1) {
    throw new DomainValidationError("windowSize must be an integer >= 1");
  }
  if (!Number.isFinite(calibrationDelta) || calibrationDelta <= 0 || calibrationDelta > 1) {
    throw new DomainValidationError("calibrationDelta must be in (0, 1]");
  }

  const observations: DriftObservation[] = [];

  function report(): DriftReport {
    const emptyAxes = {
      modelVersion: false,
      taskMix: false,
      project: false,
      policy: false,
      judgeCalibration: false
    };
    if (observations.length < windowSize) {
      return { drifted: false, axes: emptyAxes, uncertainty: 0, evidence: [] };
    }
    const baseline = freezeBaseline(observations.slice(0, windowSize));
    const window = observations.slice(-windowSize);
    return evaluateWindow(window, baseline, calibrationDelta);
  }

  return {
    observe(obs: DriftObservation): DriftReport {
      observations.push(copyObservation(obs));
      return report();
    },
    snapshot(): readonly DriftObservation[] {
      return observations.map(copyObservation);
    },
    restore(obs: readonly DriftObservation[]): void {
      if (!Array.isArray(obs)) {
        throw new DomainValidationError("drift snapshot must be an array");
      }
      const copied = obs.map(copyObservation);
      observations.length = 0;
      observations.push(...copied);
    }
  };
}

function copyObservation(obs: DriftObservation): DriftObservation {
  validateObservation(obs);
  return {
    modelVersion: obs.modelVersion,
    taskFamily: obs.taskFamily,
    projectId: obs.projectId,
    policyVersion: obs.policyVersion,
    judgeCalibration: obs.judgeCalibration
  };
}

function validateObservation(obs: DriftObservation): void {
  requireNonEmpty(obs.modelVersion, "modelVersion");
  requireNonEmpty(obs.taskFamily, "taskFamily");
  requireNonEmpty(obs.projectId, "projectId");
  requireNonEmpty(obs.policyVersion, "policyVersion");
  if (
    typeof obs.judgeCalibration !== "number" ||
    !Number.isFinite(obs.judgeCalibration) ||
    obs.judgeCalibration < 0 ||
    obs.judgeCalibration > 1
  ) {
    throw new DomainValidationError("judgeCalibration must be a finite number in [0, 1]");
  }
}

function requireNonEmpty(value: string, label: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new DomainValidationError(`${label} is required`);
  }
}

function freezeBaseline(window: readonly DriftObservation[]): FrozenBaseline {
  return {
    modelVersion: new Set(window.map((item) => item.modelVersion)),
    taskFamily: new Set(window.map((item) => item.taskFamily)),
    projectId: new Set(window.map((item) => item.projectId)),
    policyVersion: new Set(window.map((item) => item.policyVersion)),
    meanCalibration: meanCalibration(window)
  };
}

function evaluateWindow(
  window: readonly DriftObservation[],
  baseline: FrozenBaseline,
  calibrationDelta: number
): DriftReport {
  const model = majorityUnseen(window, (item) => item.modelVersion, baseline.modelVersion);
  const task = majorityUnseen(window, (item) => item.taskFamily, baseline.taskFamily);
  const project = majorityUnseen(window, (item) => item.projectId, baseline.projectId);
  const policy = majorityUnseen(window, (item) => item.policyVersion, baseline.policyVersion);
  const calMean = meanCalibration(window);
  const calDelta = Math.abs(calMean - baseline.meanCalibration);
  const judgeCalibration = calDelta >= calibrationDelta;

  const axes = {
    modelVersion: model.drifted,
    taskMix: task.drifted,
    project: project.drifted,
    policy: policy.drifted,
    judgeCalibration
  };
  const evidence: string[] = [];
  if (model.drifted && model.unseenValue !== undefined) {
    evidence.push(`modelVersion: unseen version ${model.unseenValue}`);
  }
  if (task.drifted && task.unseenValue !== undefined) {
    evidence.push(`taskMix: unseen family ${task.unseenValue}`);
  }
  if (project.drifted && project.unseenValue !== undefined) {
    evidence.push(`project: unseen project ${project.unseenValue}`);
  }
  if (policy.drifted && policy.unseenValue !== undefined) {
    evidence.push(`policy: unseen version ${policy.unseenValue}`);
  }
  if (judgeCalibration) {
    evidence.push(`judgeCalibration: |${formatNumber(calDelta)}| >= ${formatNumber(calibrationDelta)}`);
  }

  const driftedCount = Object.values(axes).filter((axis) => axis).length;
  const drifted = driftedCount > 0;
  const uncertainty = drifted ? Math.min(1, driftedCount / 5) : 0;
  return { drifted, axes, uncertainty, evidence };
}

function majorityUnseen(
  window: readonly DriftObservation[],
  valueOf: (obs: DriftObservation) => string,
  baseline: ReadonlySet<string>
): { drifted: boolean; unseenValue: string | undefined } {
  const unseen: string[] = [];
  for (const item of window) {
    const value = valueOf(item);
    if (!baseline.has(value)) {
      unseen.push(value);
    }
  }
  const drifted = unseen.length > window.length / 2;
  return { drifted, unseenValue: drifted ? mode(unseen) : undefined };
}

function meanCalibration(window: readonly DriftObservation[]): number {
  let sum = 0;
  for (const item of window) {
    sum += item.judgeCalibration;
  }
  return window.length === 0 ? 0 : sum / window.length;
}

function mode(values: readonly string[]): string | undefined {
  const counts = new Map<string, number>();
  let best: string | undefined;
  let bestCount = 0;
  for (const value of values) {
    const next = (counts.get(value) ?? 0) + 1;
    counts.set(value, next);
    if (best === undefined || next > bestCount) {
      best = value;
      bestCount = next;
    }
  }
  return best;
}

function formatNumber(value: number): string {
  return (Math.round(value * 1000) / 1000).toString();
}
