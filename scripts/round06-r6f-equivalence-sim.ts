/**
 * Round-6 R6-F equivalence simulation for the landed S6-F-1 winner:
 * reversed membership re-validation in the M6-T3 shadow/canary restores.
 *
 * The landed S1-F form built a Set over the whole population on EVERY
 * fail-closed restore (P inserts) and probed it once per assignment
 * (A probes). S6-F-1 reverses the direction: index the (deduplicated)
 * assignment hashes (A inserts), scan the population — whose full content
 * validateExperimentPlan just re-validated — with an early exit once every
 * pending hash is matched, and reconstruct the exact production first-fault
 * on the failure path (structural faults are captured, not thrown, because a
 * membership fault at an earlier index must win the first-fault race).
 * Success-path probe economics: A inserts + first-match-prefix probes versus
 * P inserts + A probes. The fail-closed Ω(P + A) per-call content re-read is
 * unchanged: validateExperimentPlan still reads the entire population and the
 * restore still checks every assignment, every call.
 *
 * The reference side freezes the pre-edit (S1-F-era) restore bodies verbatim;
 * everything else — validateExperimentPlan, canonicalHaltReason,
 * requirePopulationMember, both production runners — is imported from
 * production, so the measured/checked difference is exactly the S6-F-1 edit.
 *
 * All fixtures are generated with a seeded mulberry32 so two independent runs
 * produce identical check verdicts (timing lines are informational).
 * Run with: npx tsx scripts/round06-r6f-equivalence-sim.ts
 */

import { DomainValidationError } from "../src/domain/errors.js";
import { createCandidateId, createResourceVersionId } from "../src/domain/ids.js";
import { validateExperimentPlan, type ExperimentPlan } from "../src/experiments/plan.js";
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
    experimentId: "exp_r6f_sim",
    mode,
    baselineVersionId: createResourceVersionId(() => "r6fbase"),
    candidateId: createCandidateId(() => "r6fcand"),
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
/* Frozen pre-edit (S1-F-era) reference restores, verbatim             */
/* ------------------------------------------------------------------ */

function refRestoreShadow(serialized: ShadowState, expected: ExperimentPlan): ShadowState {
  if (typeof serialized !== "object" || serialized === null) {
    throw new DomainValidationError("shadow state is required");
  }
  validateExperimentPlan(serialized.plan);
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
  const population = new Set(serialized.plan.population);
  for (const assignment of serialized.assignments) {
    if (assignment.liveAction !== "baseline" || assignment.changedLiveAction !== false) {
      throw new DomainValidationError("shadow state must not change the live action");
    }
    if (assignment.shadowDecision !== "baseline" && assignment.shadowDecision !== "candidate") {
      throw new DomainValidationError("invalid shadowDecision");
    }
    requirePopulationMember(population, assignment.episodeHash);
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
  validateExperimentPlan(serialized.plan);
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
  const population = new Set(serialized.plan.population);
  let derivedExposure = 0;
  for (const assignment of serialized.assignments) {
    requirePopulationMember(population, assignment.episodeHash);
    if (assignment.action !== "baseline" && assignment.action !== "candidate") {
      throw new DomainValidationError("invalid canary action");
    }
    if (assignment.action === "candidate") {
      derivedExposure += 1;
    }
    if (!Number.isInteger(assignment.exposureCount) || assignment.exposureCount < 0) {
      throw new DomainValidationError("assignment exposureCount must be an integer >= 0");
    }
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
/* Part A — randomized shadow restore fuzz (valid + tampered)          */
/* ------------------------------------------------------------------ */

type MutableShadowAssignment = {
  episodeHash: unknown;
  liveAction: unknown;
  shadowDecision: unknown;
  changedLiveAction: unknown;
};

function partA(): void {
  const rng = fixtureRng(0x6f01);
  let cases = 0;
  for (let c = 0; c < 700; c++) {
    const P = 2 + Math.floor(rng() * 30);
    const plan = makePlan("shadow", P, 50);
    const runner = createShadowRunner(plan);
    const n = Math.floor(rng() * 12);
    const assignments: MutableShadowAssignment[] = [];
    for (let i = 0; i < n; i++) {
      assignments.push({
        episodeHash: plan.population[Math.floor(rng() * P)]!,
        liveAction: "baseline",
        shadowDecision: rng() < 0.5 ? "baseline" : "candidate",
        changedLiveAction: false,
      });
    }
    // Mixed structural + membership tampering, including every
    // ordering-sensitive combination the first-fault reconstruction covers.
    const roll = rng();
    if (n > 0 && roll < 0.12) {
      assignments[Math.floor(rng() * n)]!.episodeHash = `missing_${Math.floor(rng() * 100)}`;
    } else if (n > 0 && roll < 0.24) {
      assignments[Math.floor(rng() * n)]!.shadowDecision = "bogus";
    } else if (n > 0 && roll < 0.34) {
      assignments[Math.floor(rng() * n)]!.liveAction = "candidate";
    } else if (n > 0 && roll < 0.44) {
      const bad: unknown[] = ["", "   ", 7, null, undefined, { a: 1 }];
      assignments[Math.floor(rng() * n)]!.episodeHash = bad[Math.floor(rng() * bad.length)];
    } else if (n > 1 && roll < 0.56) {
      const i = Math.floor(rng() * n);
      let j = Math.floor(rng() * n);
      if (j === i) j = (j + 1) % n;
      assignments[i]!.episodeHash = "missing_combo";
      assignments[j]!.shadowDecision = "bogus";
    } else if (n > 0 && roll < 0.64) {
      const i = Math.floor(rng() * n);
      const j = Math.floor(rng() * n);
      assignments[i]!.episodeHash = assignments[j]!.episodeHash;
    } else if (n > 0 && roll < 0.72) {
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
    const expectedPlan = state === raw ? plan : state.plan;
    void expectedPlan;
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
  out(`part A: ${cases} randomized shadow restores (incl. JSON round-trips) — verdict, message, class, and state identical`);
}

/* ------------------------------------------------------------------ */
/* Part B — randomized canary restore fuzz (valid + tampered)          */
/* ------------------------------------------------------------------ */

type MutableCanaryAssignment = {
  episodeHash: unknown;
  action: unknown;
  exposureCount: unknown;
};

function partB(): void {
  const rng = fixtureRng(0x6f02);
  let cases = 0;
  for (let c = 0; c < 700; c++) {
    const P = 2 + Math.floor(rng() * 30);
    const plan = makePlan("canary", P, 50);
    const runner = createCanaryRunner(plan);
    const n = Math.floor(rng() * 12);
    const assignments: MutableCanaryAssignment[] = [];
    let exposure = 0;
    for (let i = 0; i < n; i++) {
      const candidate = rng() < 0.5;
      if (candidate) exposure += 1;
      assignments.push({
        episodeHash: plan.population[Math.floor(rng() * P)]!,
        action: candidate ? "candidate" : "baseline",
        exposureCount: exposure,
      });
    }
    const roll = rng();
    if (n > 0 && roll < 0.12) {
      assignments[Math.floor(rng() * n)]!.episodeHash = `missing_${Math.floor(rng() * 100)}`;
    } else if (n > 0 && roll < 0.24) {
      assignments[Math.floor(rng() * n)]!.action = "bogus";
    } else if (n > 0 && roll < 0.34) {
      assignments[Math.floor(rng() * n)]!.exposureCount = -1;
    } else if (n > 0 && roll < 0.44) {
      const bad: unknown[] = ["", "   ", 7, null, undefined];
      assignments[Math.floor(rng() * n)]!.episodeHash = bad[Math.floor(rng() * bad.length)];
    } else if (n > 1 && roll < 0.56) {
      // membership fault at i AND structural fault at j (both orders occur)
      const i = Math.floor(rng() * n);
      let j = Math.floor(rng() * n);
      if (j === i) j = (j + 1) % n;
      assignments[i]!.episodeHash = "missing_combo";
      assignments[j]!.action = "bogus";
    } else if (n > 0 && roll < 0.66) {
      // same-index: membership beats the action check in canary order
      const i = Math.floor(rng() * n);
      assignments[i]!.episodeHash = "missing_same";
      assignments[i]!.action = "bogus";
    } else if (roll < 0.74) {
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
  out(`part B: ${cases} randomized canary restores (incl. JSON round-trips) — verdict, message, class, and state identical`);
}

/* ------------------------------------------------------------------ */
/* Part C — directed first-fault ordering matrix                       */
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
  const cok = (h: string): unknown => ({ episodeHash: h, action: "baseline", exposureCount: 0 });
  const crunner = createCanaryRunner(cplan);
  const cdirected: [string, CanaryState][] = [
    ["same index: membership beats action check (canary order)", cmk([{ ...cok("missing") as object, action: "bogus" }], 0)],
    ["same index: hash check beats membership", cmk([cok("   ")], 0)],
    ["membership@0 beats action@1", cmk([cok("missing"), { ...cok(cpop[1]!) as object, action: "bogus" }], 0)],
    ["action@0 beats membership@1", cmk([{ ...cok(cpop[0]!) as object, action: "bogus" }, cok("missing")], 0)],
    ["membership beats exposure mismatch", cmk([cok("missing")], 5)],
    ["structural beats exposure mismatch", cmk([{ ...cok(cpop[0]!) as object, exposureCount: -2 }], 5)],
    ["exposure mismatch after clean loop", cmk([cok(cpop[0]!)], 5)],
    ["negative exposureCount@0 beats membership@1", cmk([{ ...cok(cpop[0]!) as object, exposureCount: -1 }, cok("missing")], 0)],
  ];
  for (const [label, state] of cdirected) {
    const a = runCatch(() => refRestoreCanary(state, cplan));
    const b = runCatch(() => crunner.restore(state));
    check(`C canary: ${label}`, a.threw === b.threw && a.message === b.message && a.cls === b.cls, `ref="${a.message}" prod="${b.message}"`);
  }
  out(`part C: ${directed.length} shadow + ${cdirected.length} canary directed first-fault orderings identical`);
}

/* ------------------------------------------------------------------ */
/* Part D — restore call-pattern perf at the anchor (3 orders)         */
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

function partD(): void {
  const P = 2000;
  const A = 1000;
  const plan = makePlan("shadow", P, A);
  validateExperimentPlan(plan);
  const runner = createShadowRunner(plan);
  const prefix = plan.population.slice(0, A);
  const reversed = plan.population.slice(P - A).reverse();
  const rng = fixtureRng(0x6f04);
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
  for (const [name, order] of [
    ["prefix", prefix],
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
    check(`D ${name} sink`, sink > 0);
    out(
      `part D: order=${name} ${states.length} fail-closed restores (P=${P}, A=${A}): ` +
        `reference=${tRef.toFixed(2)}ms production=${tProd.toFixed(2)}ms (saving ${(tRef - tProd).toFixed(2)}ms)`
    );
  }

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
  check("D full experiment completes", finalState !== undefined && finalState.outcomes.length === A);
  out(`part D: production full experiment (P=${P}, A=${A}, assign+recordOutcome): ${tFull.toFixed(2)}ms`);
}

partA();
partB();
partC();
partD();

out(`\ntotal: ${checks} checks, ${failures} failures`);
if (failures > 0) process.exit(1);
