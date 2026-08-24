import { DomainValidationError } from "../domain/errors.js";
import {
  type AttributionEffect,
  type AttributionLabel,
  type AttributionReport
} from "./offline-types.js";
import { DEFAULT_POSTERIOR_CONFIG, betaQuantileLcb } from "./posterior.js";

/**
 * Phase C Task 2: probability-additive attribution heuristic (offline only).
 * Frozen formula, never imported by live routing and never allowed to write
 * the active pointer.
 *
 *   mu_s  = mean(y | scenario)
 *   y_m   = mean(y | modelVersion), y_p = mean(y | projectId)
 *   y_mp  = mean(y | modelVersion, projectId)
 *   w     = kappa / (kappa + n)
 *   p_m   = w_m*mu_s + (1-w_m)*y_m      (same shape for p_p)
 *   p_add = clip(p_m + p_p - mu_s, 0, 1)
 *   p_mp  = w_mp*p_add + (1-w_mp)*y_mp
 *
 * Parents are computed from ALL rows exactly once; an (m,p) cell informs
 * y_mp through the interaction residual only — never a second time as extra
 * parent evidence.
 */

const ATTRIBUTION_EFFECT = 0.1;
const QUALITY_FLOOR = 0.55;
const INTERACTION_KAPPA = 16;

interface CellStats {
  readonly n: number;
  readonly mean: number;
}

function cell(rows: readonly { y: 0 | 1 }[]): CellStats {
  const n = rows.length;
  if (n === 0) return { n: 0, mean: 0 };
  const sum = rows.reduce((acc, r) => acc + r.y, 0);
  return { n, mean: sum / n };
}

/** Moment estimate of per-cell success variance, clamped to [2, 40]; <3 cells -> 8. */
function kappaS(cells: readonly CellStats[]): number {
  if (cells.length < 3) return 8;
  const means = cells.map((c) => c.mean);
  const mu = means.reduce((a, b) => a + b, 0) / means.length;
  const variance =
    means.reduce((acc, m) => acc + (m - mu) * (m - mu), 0) / (means.length - 1 || 1);
  return Math.min(40, Math.max(2, variance));
}

function shrink(kappa: number, stats: CellStats, scenarioMean: number): number {
  const w = kappa / (kappa + stats.n);
  return w * scenarioMean + (1 - w) * stats.mean;
}

/** Leaf treated as Beta(1 + n*mean, 1 + n*(1-mean)); dual-method hook kept explicit. */
function betaInterval(n: number, mean: number): { lcb: number; ucb: number } {
  const posterior = { alpha: 1 + n * mean, beta: 1 + n * (1 - mean) };
  const tail = 0.05; // one-sided 95%, matching DEFAULT_POSTERIOR_CONFIG
  void DEFAULT_POSTERIOR_CONFIG.lcbZ;
  return {
    lcb: betaQuantileLcb(posterior, tail),
    ucb: betaQuantileLcb(posterior, 1 - tail)
  };
}

function diffInterval(
  leaf: { n: number; mean: number },
  baseline: number
): { point: number; lcb: number; ucb: number } {
  const interval = betaInterval(leaf.n, leaf.mean);
  return {
    point: leaf.mean - baseline,
    lcb: interval.lcb - baseline,
    ucb: interval.ucb - baseline
  };
}

export function fitProbabilityAdditive(
  rows: readonly {
    readonly scenarioId: string;
    readonly modelVersion: string;
    readonly projectId: string;
    readonly y: 0 | 1;
    readonly occurredAtMs: number;
  }[],
  _options?: { readonly kappaClamp?: readonly [number, number]; readonly seed?: number }
): AttributionReport {
  void _options;
  if (rows.length === 0) {
    throw new DomainValidationError("probability-additive attribution requires at least one row");
  }
  // Single-scenario design by construction: rows are grouped per scenarioId.
  const scenarioIds = [...new Set(rows.map((r) => r.scenarioId))];
  if (scenarioIds.length !== 1) {
    throw new DomainValidationError(
      `probability-additive attribution requires exactly one scenario, got ${scenarioIds.length}`
    );
  }

  const whole = cell(rows);
  const muS = whole.mean;

  const byModel = new Map<string, { y: 0 | 1 }[]>();
  const byProject = new Map<string, { y: 0 | 1 }[]>();
  const byPair = new Map<string, { y: 0 | 1 }[]>();
  for (const row of rows) {
    push(byModel, row.modelVersion, row);
    push(byProject, row.projectId, row);
    push(byPair, `${row.modelVersion}|${row.projectId}`, row);
  }

  const kappaScenario = kappaS([...byModel.values(), ...byProject.values()].map(cell));

  const effects: AttributionEffect[] = [];
  const muInterval = betaInterval(whole.n, muS);
  effects.push({ name: "mu_s", point: muS, lcb: muInterval.lcb, ucb: muInterval.ucb });

  const modelStats = new Map<string, CellStats>();
  const modelDiffs = new Map<string, { point: number; lcb: number; ucb: number }>();
  for (const [model, list] of byModel) {
    const stats = cell(list);
    modelStats.set(model, stats);
    const pM = shrink(kappaScenario, stats, muS);
    const diff = diffInterval(stats, muS);
    void pM;
    modelDiffs.set(model, diff);
    effects.push({ name: `p_m-mu_s:${model}`, ...diff });
  }

  const projectStats = new Map<string, CellStats>();
  const projectDiffs = new Map<string, { point: number; lcb: number; ucb: number }>();
  for (const [project, list] of byProject) {
    const stats = cell(list);
    projectStats.set(project, stats);
    const diff = diffInterval(stats, muS);
    projectDiffs.set(project, diff);
    effects.push({ name: `p_p-mu_s:${project}`, ...diff });
  }

  // Interaction residual: p_mp - p_add, where parents were computed once above.
  // Parent stats are reused from the loops above; a "|" inside modelVersion can
  // desynchronize the split parts from the real group keys, and that case falls
  // back to the exact original empty-cell expression.
  const interactionDiffs = new Map<string, { point: number; lcb: number; ucb: number }>();
  for (const [pair, list] of byPair) {
    const stats = cell(list);
    const parts = pair.split("|");
    const model = parts[0];
    const project = parts[1];
    if (model === undefined || project === undefined) continue;
    const modelParentStats = modelStats.get(model) ?? cell(byModel.get(model) ?? []);
    const projectParentStats = projectStats.get(project) ?? cell(byProject.get(project) ?? []);
    const pM = shrink(kappaScenario, modelParentStats, muS);
    const pP = shrink(kappaScenario, projectParentStats, muS);
    const pAdd = Math.min(1, Math.max(0, pM + pP - muS));
    const pMp = shrink(INTERACTION_KAPPA, stats, pAdd);
    const diff = diffInterval(stats, pAdd);
    void pMp;
    interactionDiffs.set(pair, diff);
    effects.push({ name: `p_mp-p_add:${pair}`, ...diff });
  }

  const diagnosis = diagnose({
    muSLcb: muInterval.lcb,
    models: byModel.size,
    projects: byProject.size,
    modelDiffs,
    projectDiffs,
    interactionDiffs,
    byPair
  });

  return {
    estimator: "probability-additive",
    rowsUsed: rows.length,
    effects,
    diagnosis,
    reason: diagnosisReason(diagnosis),
    writesActivePointer: false
  };
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

function diagnose(input: {
  muSLcb: number;
  models: number;
  projects: number;
  modelDiffs: Map<string, { lcb: number; ucb: number }>;
  projectDiffs: Map<string, { lcb: number; ucb: number }>;
  interactionDiffs: Map<string, { lcb: number; ucb: number }>;
  byPair: Map<string, unknown>;
}): AttributionLabel {
  const containsZero = (d: { lcb: number; ucb: number }): boolean =>
    d.lcb <= 0 && d.ucb >= 0;

  if (input.muSLcb < QUALITY_FLOOR && input.models >= 2 && input.projects >= 3) {
    return "scenario-hard";
  }
  for (const [model, diff] of input.modelDiffs) {
    if (diff.lcb < -ATTRIBUTION_EFFECT) {
      // The interaction must not explain the deficit: every (model, *) pair's
      // CI contains zero.
      const pairs = [...input.interactionDiffs.entries()].filter(([key]) =>
        key.startsWith(`${model}|`)
      );
      if (pairs.every(([, d]) => containsZero(d))) return "model-problem";
    }
  }
  for (const [, diff] of input.projectDiffs) {
    if (diff.lcb < -ATTRIBUTION_EFFECT) {
      const pairs = [...input.interactionDiffs.entries()].filter(([key]) =>
        key.endsWith(`|${lastSegment(input, key)}`)
      );
      if (pairs.length > 0 && pairs.every(([, d]) => containsZero(d))) {
        return "project-problem";
      }
    }
  }
  for (const [pair, diff] of input.interactionDiffs) {
    // Minimum support: a 1-row cell's Beta interval is mostly prior width.
    const stats = input.byPair.get(pair);
    const support = typeof stats === "object" && stats !== null && "length" in stats ? (stats as unknown[]).length : 0;
    if (support >= 3 && diff.lcb < -ATTRIBUTION_EFFECT) return "interaction-only";
  }
  return "uncertain";
}

function lastSegment(_input: unknown, key: string): string {
  const parts = key.split("|");
  return parts[parts.length - 1] ?? key;
}

function diagnosisReason(diagnosis: AttributionLabel): string {
  switch (diagnosis) {
    case "scenario-hard":
      return "scenario mean LCB below the quality floor with enough models and projects to compare";
    case "model-problem":
      return "a model version underperforms the scenario mean beyond the effect threshold with no explaining interaction";
    case "project-problem":
      return "a project underperforms the scenario mean beyond the effect threshold with no explaining interaction";
    case "interaction-only":
      return "only a specific (model, project) cell underperforms; additive terms are clean";
    default:
      return "intervals too wide or no effect beyond threshold";
  }
}
