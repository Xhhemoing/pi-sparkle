/**
 * Round-7 R7-F equivalence simulation for the landed winners:
 *
 * S7-F-1 — aligned-prefix fast path for the reversed membership
 * re-validation (S6-F-1) in the M6-T3 shadow/canary restores. An assignment
 * hash that is string-equal to the population entry at the SAME index is
 * thereby a unique non-empty string and a member of the frozen population
 * (validateExperimentPlan just re-validated the population content), so the
 * aligned prefix needs no trim probe and no hash-table work. The first
 * misalignment falls back to the pending-Set scheme for the remaining
 * suffix; a misalignment at index 0 re-runs the plain landed loop so fully
 * unaligned inputs pay only one extra compare instead of a per-iteration tax.
 *
 * S7-F-2 — printable-ASCII head guard in plan validation's
 * assertUniqueNonEmpty: a first character in 33..126 proves the entry is
 * non-empty and cannot trim to "" (every ECMAScript WhiteSpace/LineTerminator
 * code point lies outside that range), so hash-shaped entries skip the trim()
 * builtin call on every fail-closed re-validation. Heads outside 33..126 —
 * including NaN for "" — fall through to the exact landed trim probe.
 *
 * The reference side freezes the ENTIRE pre-edit behavior verbatim: the
 * S6-F-1-era restore bodies AND the pre-edit assertUniqueNonEmpty /
 * validateExperimentPlan (the frozen restores call the frozen validate), so
 * the checked/measured difference is exactly S7-F-1 + S7-F-2. Unchanged
 * helpers (requirePopulationMember, canonicalHaltReason, domain id guards)
 * are imported from production.
 *
 * The fail-closed contract is unchanged on both sides: every restore re-runs
 * plan validation (Ω(P) content re-read), re-checks every assignment (Ω(A)),
 * and returns defensive copies.
 *
 * All fixtures are generated with a seeded mulberry32 so two independent runs
 * produce identical check verdicts (timing lines are informational).
 * Run with: npx tsx scripts/round07-r7f-equivalence-sim.ts
 */

import { DomainValidationError } from "../src/domain/errors.js";
import {
  createCandidateId,
  createResourceVersionId,
  isCandidateId,
  isResourceVersionId,
} from "../src/domain/ids.js";
import {
  validateExperimentPlan,
  EXPERIMENT_ID_PATTERN,
  SUPPORTED_EXPERIMENT_PLAN_VERSION,
  type ExperimentPlan,
} from "../src/experiments/plan.js";
import {
  createShadowRunner,
  canonicalHaltReason,
  requirePopulationMember,
  type ExperimentOutcome,
  type ShadowState,
} from "../src/experiments/shadow.js";
import { createCanaryRunner, type CanaryState } from "../src/experiments/canary.js";
import { stableStringify } from "../src/experiments/manifest.js";

let checks = 0;
let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  checks += 1;
  if (!ok) {
    failures += 1;
    process.stderr.write(`FAIL: ${label}${detail === undefined ? "" : ` — ${detail}`}\n`);
  }
}
function out(line: string): void {
  process.stdout.write(line + "\n");
}
function timeMs(fn: () => void, rounds = 3): number {
  let best = Infinity;
  for (let r = 0; r < rounds; r++) {
    const t0 = process.hrtime.bigint();
    fn();
    const t1 = process.hrtime.bigint();
    best = Math.min(best, Number(t1 - t0) / 1e6);
  }
  return best;
}

/** Deterministic fixture generator (mulberry32, fixture-only seed space). */
function fixtureRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function runCatch(fn: () => void): { threw: boolean; message: string; cls: string } {
  try {
    fn();
    return { threw: false, message: "", cls: "" };
  } catch (error) {
    return {
      threw: true,
      message: error instanceof Error ? error.message : String(error),
      cls: error?.constructor?.name ?? "unknown",
    };
  }
}

function makePlan(
  mode: "shadow" | "canary",
  populationSize: number,
  maxAssignments: number
): ExperimentPlan {
  const population: string[] = [];
  for (let i = 0; i < populationSize; i++) {
    population.push(`ep_${i.toString(36).padStart(8, "0")}`);
  }
  return {
    planVersion: 1,
    experimentId: "exp_r7f_sim",
    mode,
    baselineVersionId: createResourceVersionId(() => "r7fbase"),
    candidateId: createCandidateId(() => "r7fcand"),
    population,
    metrics: ["utility"],
    thresholds: { maxGuardrailBreaches: 1_000_000, maxCostUsd: 1e12 },
    budget: { maxAssignments, maxWallClockMs: 1e12 },
    randomization: { seed: 42 },
    stopPolicy: { onGuardrail: "halt", onBudgetExhausted: "halt" },
    missingOutcomePolicy: "exclude",
    canary: mode === "canary" ? { maxExposure: 1_000_000, reversibleScopes: ["scope-a"] } : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Frozen pre-edit plan validation (S5-F-era), verbatim                */
/* ------------------------------------------------------------------ */

function refAssertIntegerAtLeast(value: number, label: string, min: number): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    throw new DomainValidationError(`${label} must be an integer >= ${min}`);
  }
}

function refAssertUniqueNonEmpty(values: readonly string[], label: string): void {
  if (!Array.isArray(values) || values.length === 0) {
    throw new DomainValidationError(`${label} must be a non-empty array`);
  }
  const seen = new Set<string>();
  let unique = 0;
  for (const value of values) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new DomainValidationError(`${label} contains an empty entry`);
    }
    seen.add(value);
    unique += 1;
    if (seen.size !== unique) {
      throw new DomainValidationError(`${label} contains a duplicate: ${value}`);
    }
  }
}

function refValidateExperimentPlan(plan: ExperimentPlan): void {
  if (typeof plan !== "object" || plan === null) {
    throw new DomainValidationError("experiment plan is required");
  }
  if (plan.planVersion !== SUPPORTED_EXPERIMENT_PLAN_VERSION) {
    throw new DomainValidationError(`unsupported planVersion: ${String(plan.planVersion)}`);
  }
  if (typeof plan.experimentId !== "string" || !EXPERIMENT_ID_PATTERN.test(plan.experimentId)) {
    throw new DomainValidationError(`invalid experimentId: ${String(plan.experimentId)}`);
  }
  if (plan.mode !== "shadow" && plan.mode !== "canary") {
    throw new DomainValidationError(`invalid mode: ${String(plan.mode)}`);
  }
  if (!isResourceVersionId(plan.baselineVersionId)) {
    throw new DomainValidationError(`invalid baselineVersionId: ${String(plan.baselineVersionId)}`);
  }
  if (!isCandidateId(plan.candidateId)) {
    throw new DomainValidationError(`invalid candidateId: ${String(plan.candidateId)}`);
  }
  refAssertUniqueNonEmpty(plan.population, "population");
  refAssertUniqueNonEmpty(plan.metrics, "metrics");

  if (typeof plan.thresholds !== "object" || plan.thresholds === null) {
    throw new DomainValidationError("thresholds are required");
  }
  refAssertIntegerAtLeast(plan.thresholds.maxGuardrailBreaches, "maxGuardrailBreaches", 0);
  if (
    typeof plan.thresholds.maxCostUsd !== "number" ||
    !Number.isFinite(plan.thresholds.maxCostUsd) ||
    plan.thresholds.maxCostUsd < 0
  ) {
    throw new DomainValidationError("maxCostUsd must be a finite number >= 0");
  }

  if (typeof plan.budget !== "object" || plan.budget === null) {
    throw new DomainValidationError("budget is required");
  }
  refAssertIntegerAtLeast(plan.budget.maxAssignments, "maxAssignments", 1);
  refAssertIntegerAtLeast(plan.budget.maxWallClockMs, "maxWallClockMs", 1);

  if (typeof plan.randomization !== "object" || plan.randomization === null) {
    throw new DomainValidationError("randomization is required");
  }
  if (!Number.isInteger(plan.randomization.seed)) {
    throw new DomainValidationError("seed must be an integer");
  }

  if (typeof plan.stopPolicy !== "object" || plan.stopPolicy === null) {
    throw new DomainValidationError("stopPolicy is required");
  }
  if (plan.stopPolicy.onGuardrail !== "halt") {
    throw new DomainValidationError(`invalid onGuardrail: ${String(plan.stopPolicy.onGuardrail)}`);
  }
  if (plan.stopPolicy.onBudgetExhausted !== "halt") {
    throw new DomainValidationError(
      `invalid onBudgetExhausted: ${String(plan.stopPolicy.onBudgetExhausted)}`
    );
  }

  if (
    plan.missingOutcomePolicy !== "exclude" &&
    plan.missingOutcomePolicy !== "treat-as-failure" &&
    plan.missingOutcomePolicy !== "abort"
  ) {
    throw new DomainValidationError(
      `invalid missingOutcomePolicy: ${String(plan.missingOutcomePolicy)}`
    );
  }

  if (plan.mode === "shadow" && plan.canary !== undefined) {
    throw new DomainValidationError("shadow plans must not include a canary block");
  }
  if (plan.mode === "canary") {
    if (plan.canary === undefined || typeof plan.canary !== "object" || plan.canary === null) {
      throw new DomainValidationError("canary mode requires a canary block");
    }
    refAssertIntegerAtLeast(plan.canary.maxExposure, "maxExposure", 1);
    refAssertUniqueNonEmpty(plan.canary.reversibleScopes, "reversibleScopes");
  }
}

/* ------------------------------------------------------------------ */
/* Frozen pre-edit (S6-F-1-era) reference restores, verbatim           */
/* (calling the frozen pre-edit plan validation)                       */
/* ------------------------------------------------------------------ */

function refRestoreShadow(serialized: ShadowState, expected: ExperimentPlan): ShadowState {
  if (typeof serialized !== "object" || serialized === null) {
    throw new DomainValidationError("shadow state is required");
  }
  refValidateExperimentPlan(serialized.plan);
  if (serialized.plan.experimentId !== expected.experimentId) {
    throw new DomainValidationError("restored plan does not match runner");
  }
  if (serialized.plan.mode !== "shadow") {
    throw new DomainValidationError("shadow restore requires mode \"shadow\"");
  }
  if (typeof serialized.halted !== "boolean") {
    throw new DomainValidationError("halted must be a boolean");
  }
  if (!Array.isArray(serialized.assignments) || !Array.isArray(serialized.outcomes)) {
    throw new DomainValidationError("assignments and outcomes must be arrays");
  }
  if (!Number.isInteger(serialized.guardrailBreaches) || serialized.guardrailBreaches < 0) {
    throw new DomainValidationError("guardrailBreaches must be an integer >= 0");
  }
  if (typeof serialized.startedAtMs !== "number" || !Number.isFinite(serialized.startedAtMs)) {
    throw new DomainValidationError("startedAtMs must be a finite number");
  }
  if (typeof serialized.elapsedMs !== "number" || !Number.isFinite(serialized.elapsedMs) || serialized.elapsedMs < 0) {
    throw new DomainValidationError("elapsedMs must be a finite number >= 0");
  }
  let structuralFault: DomainValidationError | undefined;
  const pending = new Set<string>();
  for (const assignment of serialized.assignments) {
    if (assignment.liveAction !== "baseline" || assignment.changedLiveAction !== false) {
      structuralFault = new DomainValidationError("shadow state must not change the live action");
      break;
    }
    if (assignment.shadowDecision !== "baseline" && assignment.shadowDecision !== "candidate") {
      structuralFault = new DomainValidationError("invalid shadowDecision");
      break;
    }
    if (typeof assignment.episodeHash !== "string" || assignment.episodeHash.trim() === "") {
      structuralFault = new DomainValidationError("episodeHash is required");
      break;
    }
    pending.add(assignment.episodeHash);
  }
  const target = pending.size;
  if (target > 0) {
    let found = 0;
    for (const hash of serialized.plan.population) {
      if (pending.has(hash)) {
        found += 1;
        if (found === target) {
          break;
        }
      }
    }
    if (found !== target) {
      const population = new Set(serialized.plan.population);
      for (const assignment of serialized.assignments) {
        requirePopulationMember(population, assignment.episodeHash);
      }
    }
  }
  if (structuralFault !== undefined) {
    throw structuralFault;
  }
  const haltReason = canonicalHaltReason(serialized.haltReason, serialized.halted);
  return {
    plan: serialized.plan,
    halted: serialized.halted,
    haltReason,
    assignments: [...serialized.assignments],
    outcomes: [...serialized.outcomes],
    guardrailBreaches: serialized.guardrailBreaches,
    startedAtMs: serialized.startedAtMs,
    elapsedMs: serialized.elapsedMs,
  };
}

function refRestoreCanary(serialized: CanaryState, expected: ExperimentPlan): CanaryState {
  if (typeof serialized !== "object" || serialized === null) {
    throw new DomainValidationError("canary state is required");
  }
  refValidateExperimentPlan(serialized.plan);
  if (serialized.plan.experimentId !== expected.experimentId) {
    throw new DomainValidationError("restored plan does not match runner");
  }
  if (serialized.plan.mode !== "canary") {
    throw new DomainValidationError("canary restore requires mode \"canary\"");
  }
  if (typeof serialized.halted !== "boolean") {
    throw new DomainValidationError("halted must be a boolean");
  }
  if (!Array.isArray(serialized.assignments) || !Array.isArray(serialized.outcomes)) {
    throw new DomainValidationError("assignments and outcomes must be arrays");
  }
  if (!Number.isInteger(serialized.guardrailBreaches) || serialized.guardrailBreaches < 0) {
    throw new DomainValidationError("guardrailBreaches must be an integer >= 0");
  }
  if (!Number.isInteger(serialized.exposureCount) || serialized.exposureCount < 0) {
    throw new DomainValidationError("exposureCount must be an integer >= 0");
  }
  if (typeof serialized.startedAtMs !== "number" || !Number.isFinite(serialized.startedAtMs)) {
    throw new DomainValidationError("startedAtMs must be a finite number");
  }
  if (typeof serialized.elapsedMs !== "number" || !Number.isFinite(serialized.elapsedMs) || serialized.elapsedMs < 0) {
    throw new DomainValidationError("elapsedMs must be a finite number >= 0");
  }
  let derivedExposure = 0;
  let structuralFault: DomainValidationError | undefined;
  const pending = new Set<string>();
  for (const assignment of serialized.assignments) {
    if (typeof assignment.episodeHash !== "string" || assignment.episodeHash.trim() === "") {
      structuralFault = new DomainValidationError("episodeHash is required");
      break;
    }
    pending.add(assignment.episodeHash);
    if (assignment.action !== "baseline" && assignment.action !== "candidate") {
      structuralFault = new DomainValidationError("invalid canary action");
      break;
    }
    if (assignment.action === "candidate") {
      derivedExposure += 1;
    }
    if (!Number.isInteger(assignment.exposureCount) || assignment.exposureCount < 0) {
      structuralFault = new DomainValidationError("assignment exposureCount must be an integer >= 0");
      break;
    }
  }
  const target = pending.size;
  if (target > 0) {
    let found = 0;
    for (const hash of serialized.plan.population) {
      if (pending.has(hash)) {
        found += 1;
        if (found === target) {
          break;
        }
      }
    }
    if (found !== target) {
      const population = new Set(serialized.plan.population);
      for (const assignment of serialized.assignments) {
        requirePopulationMember(population, assignment.episodeHash);
      }
    }
  }
  if (structuralFault !== undefined) {
    throw structuralFault;
  }
  if (derivedExposure !== serialized.exposureCount) {
    throw new DomainValidationError("exposureCount does not match candidate assignments");
  }
  const haltReason = canonicalHaltReason(serialized.haltReason, serialized.halted);
  return {
    plan: serialized.plan,
    halted: serialized.halted,
    haltReason,
    assignments: [...serialized.assignments],
    outcomes: [...serialized.outcomes],
    guardrailBreaches: serialized.guardrailBreaches,
    exposureCount: serialized.exposureCount,
    startedAtMs: serialized.startedAtMs,
    elapsedMs: serialized.elapsedMs,
  };
}

/* ------------------------------------------------------------------ */
/* Part A — randomized shadow restore fuzz (alignment-aware)           */
/* ------------------------------------------------------------------ */

type MutableShadowAssignment = {
  episodeHash: unknown;
  liveAction: unknown;
  shadowDecision: unknown;
  changedLiveAction: unknown;
};

function partA(): void {
  const rng = fixtureRng(0x7f01);
  let cases = 0;
  for (let c = 0; c < 900; c++) {
    const P = 2 + Math.floor(rng() * 30);
    const plan = makePlan("shadow", P, 60);
    const runner = createShadowRunner(plan);
    const n = Math.floor(rng() * Math.min(12, P + 2));
    // Alignment-aware base orders: the fast path's phase transition must be
    // exercised at every prefix length, including 0 (full reroute) and n
    // (no fallback at all).
    const shape = rng();
    const hashes: string[] = [];
    if (shape < 0.35) {
      // aligned prefix of random length k, then random members
      const k = Math.floor(rng() * (n + 1));
      for (let i = 0; i < n; i++) {
        hashes.push(
          i < k && i < P ? plan.population[i]! : plan.population[Math.floor(rng() * P)]!
        );
      }
    } else if (shape < 0.5) {
      // fully aligned (as far as the population allows)
      for (let i = 0; i < n; i++) {
        hashes.push(plan.population[Math.min(i, P - 1)]!);
      }
    } else if (shape < 0.65) {
      // reversed members (misaligned at 0 unless trivially aligned)
      for (let i = 0; i < n; i++) {
        hashes.push(plan.population[(P - 1 - i + P) % P]!);
      }
    } else {
      // random members with replacement (round-6 style)
      for (let i = 0; i < n; i++) {
        hashes.push(plan.population[Math.floor(rng() * P)]!);
      }
    }
    const assignments: MutableShadowAssignment[] = hashes.map((episodeHash) => ({
      episodeHash,
      liveAction: "baseline",
      shadowDecision: rng() < 0.5 ? "baseline" : "candidate",
      changedLiveAction: false,
    }));
    // Mixed structural + membership tampering, including every
    // ordering-sensitive combination the first-fault reconstruction covers.
    const roll = rng();
    if (n > 0 && roll < 0.12) {
      assignments[Math.floor(rng() * n)]!.episodeHash = `missing_${Math.floor(rng() * 100)}`;
    } else if (n > 0 && roll < 0.22) {
      assignments[Math.floor(rng() * n)]!.shadowDecision = "bogus";
    } else if (n > 0 && roll < 0.3) {
      assignments[Math.floor(rng() * n)]!.liveAction = "candidate";
    } else if (n > 0 && roll < 0.4) {
      const bad: unknown[] = ["", "   ", "\u00a0", 7, null, undefined, { a: 1 }];
      assignments[Math.floor(rng() * n)]!.episodeHash = bad[Math.floor(rng() * bad.length)];
    } else if (n > 1 && roll < 0.5) {
      const i = Math.floor(rng() * n);
      let j = Math.floor(rng() * n);
      if (j === i) j = (j + 1) % n;
      assignments[i]!.episodeHash = "missing_combo";
      assignments[j]!.shadowDecision = "bogus";
    } else if (n > 0 && roll < 0.58) {
      const i = Math.floor(rng() * n);
      const j = Math.floor(rng() * n);
      assignments[i]!.episodeHash = assignments[j]!.episodeHash;
    } else if (n > 0 && roll < 0.66) {
      const i = Math.floor(rng() * n);
      assignments[i]!.episodeHash = "missing_same";
      assignments[i]!.liveAction = "tampered";
    }
    const halted = rng() < 0.2;
    const raw = {
      plan,
      halted,
      haltReason: halted ? (rng() < 0.85 ? "cancelled" : undefined) : undefined,
      assignments,
      outcomes: [],
      guardrailBreaches: 0,
      startedAtMs: 0,
      elapsedMs: 0,
    } as unknown as ShadowState;
    const state = rng() < 0.5 ? (JSON.parse(JSON.stringify(raw)) as ShadowState) : raw;
    const a = runCatch(() => refRestoreShadow(state, plan));
    const b = runCatch(() => runner.restore(state));
    if (a.threw !== b.threw || a.message !== b.message || a.cls !== b.cls) {
      check(`A case ${c}`, false, `ref="${a.message}" prod="${b.message}"`);
      return;
    }
    if (!a.threw && stableStringify(refRestoreShadow(state, plan)) !== stableStringify(runner.restore(state))) {
      check(`A case ${c} state`, false);
      return;
    }
    cases += 1;
  }
  check("A shadow restore fuzz equivalence", true);
  out(`part A: ${cases} randomized shadow restores (alignment-aware, incl. JSON round-trips) — verdict, message, class, and state identical`);
}

/* ------------------------------------------------------------------ */
/* Part B — randomized canary restore fuzz (alignment-aware)           */
/* ------------------------------------------------------------------ */

type MutableCanaryAssignment = {
  episodeHash: unknown;
  action: unknown;
  exposureCount: unknown;
};

function partB(): void {
  const rng = fixtureRng(0x7f02);
  let cases = 0;
  for (let c = 0; c < 900; c++) {
    const P = 2 + Math.floor(rng() * 30);
    const plan = makePlan("canary", P, 60);
    const runner = createCanaryRunner(plan);
    const n = Math.floor(rng() * Math.min(12, P + 2));
    const shape = rng();
    const hashes: string[] = [];
    if (shape < 0.35) {
      const k = Math.floor(rng() * (n + 1));
      for (let i = 0; i < n; i++) {
        hashes.push(
          i < k && i < P ? plan.population[i]! : plan.population[Math.floor(rng() * P)]!
        );
      }
    } else if (shape < 0.5) {
      for (let i = 0; i < n; i++) {
        hashes.push(plan.population[Math.min(i, P - 1)]!);
      }
    } else if (shape < 0.65) {
      for (let i = 0; i < n; i++) {
        hashes.push(plan.population[(P - 1 - i + P) % P]!);
      }
    } else {
      for (let i = 0; i < n; i++) {
        hashes.push(plan.population[Math.floor(rng() * P)]!);
      }
    }
    let exposure = 0;
    const assignments: MutableCanaryAssignment[] = hashes.map((episodeHash) => {
      const candidate = rng() < 0.5;
      if (candidate) exposure += 1;
      return {
        episodeHash,
        action: candidate ? "candidate" : "baseline",
        exposureCount: exposure,
      };
    });
    const roll = rng();
    if (n > 0 && roll < 0.12) {
      assignments[Math.floor(rng() * n)]!.episodeHash = `missing_${Math.floor(rng() * 100)}`;
    } else if (n > 0 && roll < 0.22) {
      assignments[Math.floor(rng() * n)]!.action = "bogus";
    } else if (n > 0 && roll < 0.3) {
      assignments[Math.floor(rng() * n)]!.exposureCount = -1;
    } else if (n > 0 && roll < 0.4) {
      const bad: unknown[] = ["", "   ", "\u00a0", 7, null, undefined];
      assignments[Math.floor(rng() * n)]!.episodeHash = bad[Math.floor(rng() * bad.length)];
    } else if (n > 1 && roll < 0.5) {
      // membership fault at i AND structural fault at j (both orders occur)
      const i = Math.floor(rng() * n);
      let j = Math.floor(rng() * n);
      if (j === i) j = (j + 1) % n;
      assignments[i]!.episodeHash = "missing_combo";
      assignments[j]!.action = "bogus";
    } else if (n > 0 && roll < 0.6) {
      // same-index: membership beats the action check in canary order
      const i = Math.floor(rng() * n);
      assignments[i]!.episodeHash = "missing_same";
      assignments[i]!.action = "bogus";
    } else if (roll < 0.68) {
      exposure += 1; // exposureCount mismatch (post-loop check)
    }
    const halted = rng() < 0.2;
    const raw = {
      plan,
      halted,
      haltReason: halted ? (rng() < 0.85 ? "cancelled" : undefined) : undefined,
      assignments,
      outcomes: [],
      guardrailBreaches: 0,
      exposureCount: exposure,
      startedAtMs: 0,
      elapsedMs: 0,
    } as unknown as CanaryState;
    const state = rng() < 0.5 ? (JSON.parse(JSON.stringify(raw)) as CanaryState) : raw;
    const a = runCatch(() => refRestoreCanary(state, plan));
    const b = runCatch(() => runner.restore(state));
    if (a.threw !== b.threw || a.message !== b.message || a.cls !== b.cls) {
      check(`B case ${c}`, false, `ref="${a.message}" prod="${b.message}"`);
      return;
    }
    if (!a.threw && stableStringify(refRestoreCanary(state, plan)) !== stableStringify(runner.restore(state))) {
      check(`B case ${c} state`, false);
      return;
    }
    cases += 1;
  }
  check("B canary restore fuzz equivalence", true);
  out(`part B: ${cases} randomized canary restores (alignment-aware, incl. JSON round-trips) — verdict, message, class, and state identical`);
}

/* ------------------------------------------------------------------ */
/* Part C — directed first-fault ordering + alignment-transition matrix */
/* ------------------------------------------------------------------ */

function partC(): void {
  const plan = makePlan("shadow", 6, 20);
  const pop = plan.population;
  const mk = (assignments: unknown[], halted = false, haltReason?: string): ShadowState =>
    ({
      plan,
      halted,
      haltReason,
      assignments,
      outcomes: [],
      guardrailBreaches: 0,
      startedAtMs: 0,
      elapsedMs: 0,
    }) as unknown as ShadowState;
  const ok = (h: string): unknown => ({
    episodeHash: h,
    liveAction: "baseline",
    shadowDecision: "baseline",
    changedLiveAction: false,
  });
  const runner = createShadowRunner(plan);
  const directed: [string, ShadowState][] = [
    // round-6 first-fault matrix (unchanged semantics)
    ["membership@0 beats structural@1", mk([{ ...ok("missing") as object }, { ...ok(pop[1]!) as object, shadowDecision: "bogus" }])],
    ["structural@0 beats membership@1", mk([{ ...ok(pop[0]!) as object, liveAction: "x" }, ok("missing")])],
    ["same index: liveAction beats membership (shadow order)", mk([{ ...ok("missing") as object, liveAction: "x" }])],
    ["same index: shadowDecision beats membership", mk([{ ...ok("missing") as object, shadowDecision: "z" }])],
    ["same index: hash check beats membership", mk([{ ...ok("  ") as object }])],
    ["duplicate missing hashes", mk([ok("missing"), ok("missing")])],
    ["duplicate valid hashes accepted", mk([ok(pop[2]!), ok(pop[2]!)])],
    ["empty assignments accepted", mk([])],
    ["full-population assignments accepted", mk(pop.map((h) => ok(h)))],
    ["last-population-entry match (early-exit boundary)", mk([ok(pop[pop.length - 1]!)])],
    ["membership beats missing haltReason", mk([ok("missing")], true, undefined)],
    ["missing haltReason after clean membership", mk([ok(pop[0]!)], true, undefined)],
    ["non-string hash mid-array", mk([ok(pop[0]!), { ...ok(pop[1]!) as object, episodeHash: 9 }, ok(pop[2]!)])],
    // S7-F-1 alignment-transition matrix
    ["fully aligned full population accepted", mk(pop.map((h) => ok(h)))],
    ["aligned prefix then member-but-misaligned suffix accepted", mk([ok(pop[0]!), ok(pop[1]!), ok(pop[4]!), ok(pop[3]!)])],
    ["aligned prefix then non-member at transition", mk([ok(pop[0]!), ok(pop[1]!), ok("missing")])],
    ["aligned prefix then whitespace hash at transition", mk([ok(pop[0]!), ok(pop[1]!), ok("   ")])],
    ["aligned prefix then non-string hash at transition", mk([ok(pop[0]!), ok(pop[1]!), { ...ok(pop[2]!) as object, episodeHash: 9 }])],
    ["aligned prefix, member transition, structural fault later", mk([ok(pop[0]!), ok(pop[3]!), { ...ok(pop[4]!) as object, shadowDecision: "bogus" }])],
    ["aligned prefix, suffix: membership@2 beats structural@3", mk([ok(pop[0]!), ok(pop[3]!), ok("missing"), { ...ok(pop[4]!) as object, shadowDecision: "bogus" }])],
    ["aligned prefix, suffix: structural@2 beats membership@3", mk([ok(pop[0]!), ok(pop[3]!), { ...ok(pop[4]!) as object, liveAction: "x" }, ok("missing")])],
    ["misaligned at 0 (reversed members) accepted", mk([ok(pop[5]!), ok(pop[4]!), ok(pop[3]!)])],
    ["aligned full population plus duplicate member accepted", mk([...pop.map((h) => ok(h)), ok(pop[0]!)])],
    ["aligned full population plus non-member rejected", mk([...pop.map((h) => ok(h)), ok("missing")])],
    ["aligned duplicate pair accepted", mk([ok(pop[0]!), ok(pop[0]!)])],
    ["structural fault at aligned index 0", mk([{ ...ok(pop[0]!) as object, liveAction: "x" }, ok(pop[1]!)])],
    ["aligned-hash shadowDecision fault beats later membership", mk([ok(pop[0]!), { ...ok(pop[1]!) as object, shadowDecision: "bogus" }, ok("missing")])],
  ];
  for (const [label, state] of directed) {
    const a = runCatch(() => refRestoreShadow(state, plan));
    const b = runCatch(() => runner.restore(state));
    check(`C shadow: ${label}`, a.threw === b.threw && a.message === b.message && a.cls === b.cls, `ref="${a.message}" prod="${b.message}"`);
  }

  const cplan = makePlan("canary", 6, 20);
  const cpop = cplan.population;
  const cmk = (assignments: unknown[], exposureCount: number): CanaryState =>
    ({
      plan: cplan,
      halted: false,
      haltReason: undefined,
      assignments,
      outcomes: [],
      guardrailBreaches: 0,
      exposureCount,
      startedAtMs: 0,
      elapsedMs: 0,
    }) as unknown as CanaryState;
  const cok = (h: string, action: "baseline" | "candidate" = "baseline", exposureCount = 0): unknown =>
    ({ episodeHash: h, action, exposureCount });
  const crunner = createCanaryRunner(cplan);
  const cdirected: [string, CanaryState][] = [
    // round-6 first-fault matrix
    ["same index: membership beats action check (canary order)", cmk([{ ...cok("missing") as object, action: "bogus" }], 0)],
    ["same index: hash check beats membership", cmk([cok("   ")], 0)],
    ["membership@0 beats action@1", cmk([cok("missing"), { ...cok(cpop[1]!) as object, action: "bogus" }], 0)],
    ["action@0 beats membership@1", cmk([{ ...cok(cpop[0]!) as object, action: "bogus" }, cok("missing")], 0)],
    ["membership beats exposure mismatch", cmk([cok("missing")], 5)],
    ["structural beats exposure mismatch", cmk([{ ...cok(cpop[0]!) as object, exposureCount: -2 }], 5)],
    ["exposure mismatch after clean loop", cmk([cok(cpop[0]!)], 5)],
    ["negative exposureCount@0 beats membership@1", cmk([{ ...cok(cpop[0]!) as object, exposureCount: -1 }, cok("missing")], 0)],
    // S7-F-1 alignment-transition matrix
    ["fully aligned with candidates, exposure carries", cmk([cok(cpop[0]!, "candidate", 1), cok(cpop[1]!, "baseline", 1), cok(cpop[2]!, "candidate", 2)], 2)],
    ["exposure carries across aligned prefix + misaligned suffix", cmk([cok(cpop[0]!, "candidate", 1), cok(cpop[1]!, "baseline", 1), cok(cpop[4]!, "candidate", 2), cok(cpop[3]!, "candidate", 3)], 3)],
    ["exposure mismatch across aligned prefix + suffix", cmk([cok(cpop[0]!, "candidate", 1), cok(cpop[3]!, "candidate", 2)], 5)],
    ["transition same index: membership beats action", cmk([cok(cpop[0]!), { ...cok("missing") as object, action: "bogus" }], 0)],
    ["aligned-hash action fault beats later membership", cmk([cok(cpop[0]!), { ...cok(cpop[1]!) as object, action: "bogus" }, cok("missing")], 0)],
    ["aligned prefix then whitespace hash at transition", cmk([cok(cpop[0]!), cok("   ")], 0)],
    ["aligned prefix then negative exposureCount at transition", cmk([cok(cpop[0]!), { ...cok(cpop[3]!) as object, exposureCount: -1 }], 0)],
    ["misaligned at 0 (reversed members) accepted", cmk([cok(cpop[5]!), cok(cpop[4]!)], 0)],
    ["aligned full population plus non-member rejected", cmk([...cpop.map((h) => cok(h)), cok("missing")], 0)],
  ];
  for (const [label, state] of cdirected) {
    const a = runCatch(() => refRestoreCanary(state, cplan));
    const b = runCatch(() => crunner.restore(state));
    check(`C canary: ${label}`, a.threw === b.threw && a.message === b.message && a.cls === b.cls, `ref="${a.message}" prod="${b.message}"`);
  }
  out(`part C: ${directed.length} shadow + ${cdirected.length} canary directed first-fault/alignment orderings identical`);
}

/* ------------------------------------------------------------------ */
/* Part D — plan validation equivalence (S7-F-2 head guard)            */
/* ------------------------------------------------------------------ */

function partD(): void {
  // Directed adversarial entries: every ECMAScript whitespace class, ASCII
  // boundary heads (32/33/126/127), non-ASCII heads, controls, non-strings.
  const adversarial: unknown[] = [
    "",
    " ",
    "\t",
    "\n",
    "\r",
    "\v",
    "\f",
    "   ",
    "\u00a0",
    "\u1680",
    "\u2000",
    "\u2009",
    "\u200a",
    "\u2028",
    "\u2029",
    "\u202f",
    "\u205f",
    "\u3000",
    "\ufeff",
    " \t\n\u00a0\u3000",
    " x",
    "\u00a0x",
    "\u3000x",
    "x ",
    "x\u00a0",
    "!",
    "~",
    "\u007f",
    "\u0000",
    "\u0001",
    "é",
    "中文",
    "\ud83d\ude00",
    "ep_ok",
    7,
    null,
    undefined,
    { a: 1 },
    ["x"],
  ];
  let directedCases = 0;
  for (const value of adversarial) {
    for (const slot of ["population", "metrics", "scopes"] as const) {
      const base = makePlan(slot === "scopes" ? "canary" : "shadow", 4, 10);
      const plan = JSON.parse(JSON.stringify({ ...base, canary: base.canary })) as ExperimentPlan;
      const target =
        slot === "population"
          ? (plan.population as unknown[])
          : slot === "metrics"
            ? (plan.metrics as unknown[])
            : (plan.canary!.reversibleScopes as unknown[]);
      target[slot === "population" ? 2 : 0] = value;
      if (slot === "metrics") target.push("second-metric");
      const a = runCatch(() => refValidateExperimentPlan(plan));
      const b = runCatch(() => validateExperimentPlan(plan));
      check(
        `D ${slot} entry ${JSON.stringify(String(value)).slice(0, 24)}`,
        a.threw === b.threw && a.message === b.message && a.cls === b.cls,
        `ref="${a.message}" prod="${b.message}"`
      );
      directedCases += 1;
    }
  }
  // Randomized plan fuzz: mix clean plans, duplicates, adversarial entries,
  // and non-array values.
  const rng = fixtureRng(0x7f04);
  let fuzzCases = 0;
  for (let c = 0; c < 600; c++) {
    const mode = rng() < 0.5 ? "shadow" : "canary";
    const base = makePlan(mode, 2 + Math.floor(rng() * 20), 10);
    const plan = JSON.parse(JSON.stringify({ ...base, canary: base.canary })) as ExperimentPlan;
    const roll = rng();
    const population = plan.population as unknown[];
    if (roll < 0.25) {
      population[Math.floor(rng() * population.length)] =
        adversarial[Math.floor(rng() * adversarial.length)];
    } else if (roll < 0.4) {
      const i = Math.floor(rng() * population.length);
      const j = Math.floor(rng() * population.length);
      population[i] = population[j];
    } else if (roll < 0.5) {
      (plan as { metrics: unknown }).metrics =
        rng() < 0.5 ? [] : adversarial[Math.floor(rng() * adversarial.length)];
    } else if (roll < 0.6 && mode === "canary") {
      (plan.canary!.reversibleScopes as unknown[])[0] =
        adversarial[Math.floor(rng() * adversarial.length)];
    }
    const a = runCatch(() => refValidateExperimentPlan(plan));
    const b = runCatch(() => validateExperimentPlan(plan));
    if (a.threw !== b.threw || a.message !== b.message || a.cls !== b.cls) {
      check(`D fuzz case ${c}`, false, `ref="${a.message}" prod="${b.message}"`);
      return;
    }
    fuzzCases += 1;
  }
  check("D plan validation fuzz equivalence", true);
  out(`part D: ${directedCases} directed adversarial entries + ${fuzzCases} randomized plans — verdict, message, and class identical`);
}

/* ------------------------------------------------------------------ */
/* Part E — perf at the anchor (P=2000, A=1000; 4 assignment orders)   */
/* ------------------------------------------------------------------ */

function captureStates(plan: ExperimentPlan, order: readonly string[], A: number): ShadowState[] {
  const runner = createShadowRunner(plan);
  const states: ShadowState[] = [];
  let state = runner.start(0);
  for (let k = 0; k < A; k++) {
    states.push(state);
    state = runner.assign(state, order[k]!, 0);
    states.push(state);
    const outcome: ExperimentOutcome = {
      episodeHash: order[k]!,
      utility: 0.5,
      costUsd: 0.01,
      guardrailBreached: false,
    };
    state = runner.recordOutcome(state, outcome, 0);
  }
  return states;
}

function partE(): void {
  const P = 2000;
  const A = 1000;
  const plan = makePlan("shadow", P, A);
  validateExperimentPlan(plan);
  const runner = createShadowRunner(plan);
  const prefix = plan.population.slice(0, A);
  const reversed = plan.population.slice(P - A).reverse();
  const rng = fixtureRng(0x7f05);
  const scattered: string[] = [];
  {
    const pool = [...plan.population];
    for (let i = 0; i < A; i++) {
      const j = i + Math.floor(rng() * (P - i));
      const t = pool[i]!;
      pool[i] = pool[j]!;
      pool[j] = t;
      scattered.push(pool[i]!);
    }
  }
  const half = [...prefix.slice(0, A / 2), ...scattered.filter((h) => !prefix.slice(0, A / 2).includes(h)).slice(0, A / 2)];
  for (const [name, order] of [
    ["prefix (aligned)", prefix],
    ["half-aligned", half],
    ["scattered", scattered],
    ["reversed", reversed],
  ] as const) {
    const states = captureStates(plan, order, A);
    let sink = 0;
    const tRef = timeMs(() => {
      for (const s of states) sink += refRestoreShadow(s, plan).assignments.length;
    });
    const tProd = timeMs(() => {
      for (const s of states) sink += runner.restore(s).assignments.length;
    });
    check(`E ${name} sink`, sink > 0);
    out(
      `part E: order=${name} ${states.length} fail-closed restores (P=${P}, A=${A}): ` +
        `reference=${tRef.toFixed(2)}ms production=${tProd.toFixed(2)}ms (saving ${(tRef - tProd).toFixed(2)}ms)`
    );
  }

  // Isolated S7-F-2 view: plan validation alone at the anchor.
  const validateRounds = 2000;
  const tRefValidate = timeMs(() => {
    for (let i = 0; i < validateRounds; i++) refValidateExperimentPlan(plan);
  });
  const tProdValidate = timeMs(() => {
    for (let i = 0; i < validateRounds; i++) validateExperimentPlan(plan);
  });
  out(
    `part E: validateExperimentPlan x${validateRounds} (P=${P}): ` +
      `reference=${tRefValidate.toFixed(2)}ms production=${tProdValidate.toFixed(2)}ms (saving ${(tRefValidate - tProdValidate).toFixed(2)}ms)`
  );

  // Full production experiment at the campaign anchor (informational).
  const outcomes: ExperimentOutcome[] = prefix.map((episodeHash) => ({
    episodeHash,
    utility: 0.5,
    costUsd: 0.01,
    guardrailBreached: false,
  }));
  let finalState: ShadowState | undefined;
  const tFull = timeMs(() => {
    let state = runner.start(0);
    for (const outcome of outcomes) {
      if (state.halted) break;
      state = runner.assign(state, outcome.episodeHash, 0);
      state = runner.recordOutcome(state, outcome, 0);
    }
    finalState = state;
  });
  check("E full experiment completes", finalState !== undefined && finalState.outcomes.length === A);
  out(`part E: production full experiment (P=${P}, A=${A}, assign+recordOutcome): ${tFull.toFixed(2)}ms`);
}

partA();
partB();
partC();
partD();
partE();

out(`\ntotal: ${checks} checks, ${failures} failures`);
if (failures > 0) process.exit(1);
