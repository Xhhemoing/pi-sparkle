import type { BudgetState, TopologyCost } from "./expected-value.js";
import { evaluateExpectedValue } from "./expected-value.js";

export type TopologyKind =
  | "single"
  | "refine"
  | "critic"
  | "candidates"
  | "specialists"
  | "debate"
  | "human-boundary";

export interface TopologyRequest {
  readonly taskFamily: string;
  readonly deterministicOnly: boolean;
  readonly highRisk: boolean;
  readonly ambiguousIntent: boolean;
  readonly deterministicFailure: boolean;
  readonly openEnded: boolean;
  readonly budget: BudgetState;
  readonly valuePerUtilityPointUsd: number;
}

export interface TopologyDecision {
  readonly topology: TopologyKind;
  readonly reason: string;
  readonly extraCostUsd: number;
  readonly extraTimeMs: number;
  readonly expectedValueUsd: number;
  /** True when the loop must stop instead of retrying. */
  readonly halt: boolean;
  /** The topology decision and its aggregation cost are always recorded. */
  readonly aggregationRecorded: true;
}

/** Extra cost/time of running the additional agents (aggregation included). */
const TOPOLOGY_COSTS: Record<Exclude<TopologyKind, "single" | "human-boundary">, TopologyCost> = {
  refine: { extraCostUsd: 0.05, extraTimeMs: 60_000 },
  critic: { extraCostUsd: 0.08, extraTimeMs: 90_000 },
  specialists: { extraCostUsd: 0.15, extraTimeMs: 180_000 },
  candidates: { extraCostUsd: 0.2, extraTimeMs: 240_000 },
  debate: { extraCostUsd: 0.25, extraTimeMs: 300_000 },
};

/** Expected utility gain of each topology over a single agent. */
const TOPOLOGY_GAIN: Record<Exclude<TopologyKind, "single" | "human-boundary">, number> = {
  refine: 0.15,
  critic: 0.2,
  specialists: 0.25,
  candidates: 0.3,
  debate: 0.3,
};

function baseDecision(
  topology: TopologyKind,
  reason: string,
  cost: TopologyCost,
  expectedValueUsd: number,
  halt = false
): TopologyDecision {
  return {
    topology,
    reason,
    extraCostUsd: cost.extraCostUsd,
    extraTimeMs: cost.extraTimeMs,
    expectedValueUsd,
    halt,
    aggregationRecorded: true,
  };
}

const ZERO_COST: TopologyCost = { extraCostUsd: 0, extraTimeMs: 0 };

/**
 * Deterministic topology choice. Single-agent routes win whenever they are
 * sufficient; escalation to extra agents requires positive expected value
 * within the remaining budget. Unresolved intent and deterministic failures
 * can never be overridden by agent majorities.
 */
export function decideTopology(request: TopologyRequest): TopologyDecision {
  if (request.ambiguousIntent) {
    return baseDecision(
      "human-boundary",
      "unresolved user intent requires a human boundary; no agent majority may resolve it",
      ZERO_COST,
      0
    );
  }

  if (request.deterministicFailure) {
    return baseDecision(
      "single",
      "deterministic failure cannot be overridden by majority opinion; escalation blocked",
      ZERO_COST,
      0
    );
  }

  if (request.deterministicOnly) {
    return baseDecision(
      "single",
      "deterministic/tool-only work is sufficient on a single agent",
      ZERO_COST,
      0
    );
  }

  let desired: Exclude<TopologyKind, "single" | "human-boundary"> | undefined;
  if (request.taskFamily === "security") {
    desired = "critic";
  } else if (request.taskFamily === "architecture") {
    desired = "specialists";
  } else if (request.openEnded) {
    desired = "candidates";
  } else if (request.highRisk) {
    desired = "critic";
  }

  if (desired === undefined) {
    return baseDecision(
      "single",
      "one-agent route is sufficient for this task",
      ZERO_COST,
      0
    );
  }

  const cost = TOPOLOGY_COSTS[desired];
  const gain = TOPOLOGY_GAIN[desired];
  const ev = evaluateExpectedValue(
    request.budget,
    cost,
    gain,
    request.valuePerUtilityPointUsd
  );

  if (ev.approve) {
    return baseDecision(
      desired,
      `additional agents have positive expected value (${ev.evUsd.toFixed(3)} USD)`,
      cost,
      ev.evUsd
    );
  }

  return baseDecision(
    "single",
    `additional agents rejected: ${ev.affordable ? "expected value not positive" : "remaining budget insufficient"} (ev ${ev.evUsd.toFixed(3)} USD)`,
    ZERO_COST,
    ev.evUsd
  );
}

/** Repeated failed reflection escalates topology, then stops — never loops. */
export const MAX_REFLECTION_ATTEMPTS = 2;

const ESCALATION_LADDER: readonly TopologyKind[] = [
  "single",
  "refine",
  "critic",
  "specialists",
  "candidates",
  "debate",
];

export interface ReflectionContext {
  readonly currentTopology: TopologyKind;
  readonly failedReflectionCount: number;
  readonly request: TopologyRequest;
}

export function decideAfterFailedReflection(ctx: ReflectionContext): TopologyDecision {
  if (ctx.failedReflectionCount >= MAX_REFLECTION_ATTEMPTS) {
    return baseDecision(
      ctx.currentTopology,
      `reflection failed ${ctx.failedReflectionCount} times; stopping instead of looping`,
      ZERO_COST,
      0,
      true
    );
  }
  const index = ESCALATION_LADDER.indexOf(ctx.currentTopology);
  const next = ESCALATION_LADDER[Math.min(index + 1, ESCALATION_LADDER.length - 1)];
  if (next === undefined || next === ctx.currentTopology) {
    return baseDecision(
      ctx.currentTopology,
      "reflection failed and no higher topology exists; stopping instead of looping",
      ZERO_COST,
      0,
      true
    );
  }
  const cost = TOPOLOGY_COSTS[next as Exclude<TopologyKind, "single" | "human-boundary">];
  const ev = evaluateExpectedValue(
    ctx.request.budget,
    cost,
    TOPOLOGY_GAIN[next as Exclude<TopologyKind, "single" | "human-boundary">],
    ctx.request.valuePerUtilityPointUsd
  );
  return baseDecision(
    next,
    `reflection failed; escalating topology ${ctx.currentTopology} -> ${next}`,
    cost,
    ev.evUsd
  );
}
