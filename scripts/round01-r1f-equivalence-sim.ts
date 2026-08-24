/**
 * Round-1 R1-F equivalence & performance simulation.
 *
 * Compares the pre-change (commit d91e2bd) restore paths of the M6-T3
 * shadow and canary runners — embedded below, verbatim, as the frozen
 * CONTROL — against the current production code for:
 *
 *   S1-F (landed): restore-time population membership over a prebuilt Set
 *       (O(A + P) per restore instead of O(A × P) Array.prototype.includes
 *       scans), with the fail-closed full re-validation untouched.
 *
 * Every check demands bitwise-identical floats (Object.is via
 * stableStringify) and identical structures/strings, including thrown error
 * messages and error classes. Only the restore membership lookup changed
 * this round; `applyExperimentClock`, `haltOnAssignmentBudget`,
 * `recordExperimentOutcome`, `cancelExperiment`, `requirePopulationEpisode`,
 * `requireUniqueAssignment`, `canonicalHaltReason`, `assertFiniteNowMs`,
 * `validateExperimentPlan`, and `DomainValidationError` are imported from
 * production so the diff under test is exactly the S1-F edit
 * (`shadowDecisionAt` and `requireCanaryBlock` are private and unchanged;
 * they are copied verbatim). The script never touches production state; it
 * only calls pure functions. Run with:
 *   npx tsx scripts/round01-r1f-equivalence-sim.ts
 */

import {
  applyExperimentClock,
  assertFiniteNowMs,
  cancelExperiment,
  canonicalHaltReason,
  createShadowRunner,
  haltOnAssignmentBudget,
  recordExperimentOutcome,
  requireUniqueAssignment,
  type ExperimentOutcome,
  type ShadowAssignment,
  type ShadowRunner,
  type ShadowState,
} from "../src/experiments/shadow.js";
import { createCanaryRunner, type CanaryAssignment, type CanaryRunner, type CanaryState } from "../src/experiments/canary.js";
import { createSeededRng } from "../src/experiments/replay.js";
import { stableStringify } from "../src/experiments/manifest.js";
import { validateExperimentPlan, type ExperimentPlan } from "../src/experiments/plan.js";
import { createCandidateId, createResourceVersionId } from "../src/domain/ids.js";
import { DomainValidationError } from "../src/domain/errors.js";

/* ------------------------------------------------------------------ */
/* Frozen pre-change reference (control). Verbatim from d91e2bd.      */
/* ------------------------------------------------------------------ */

const counters = {
  refMembershipComparisons: 0,
};

/** Counting stand-in for `plan.population.includes(h)` — same scan order,
 * same SameValueZero semantics (strings, so ===), plus a comparison counter. */
function refIncludes(population: readonly string[], hash: string): boolean {
  for (let i = 0; i < population.length; i++) {
    counters.refMembershipComparisons += 1;
    if (population[i] === hash) return true;
  }
  return false;
}

/** Verbatim pre-change `requirePopulationEpisode`, with the counting scan. */
function refRequirePopulationEpisode(plan: ExperimentPlan, episodeHash: string): void {
  if (typeof episodeHash !== "string" || episodeHash.trim() === "") {
    throw new DomainValidationError("episodeHash is required");
  }
  if (!refIncludes(plan.population, episodeHash)) {
    throw new DomainValidationError(`episode ${episodeHash} is not in the frozen population`);
  }
}

/** Verbatim copy of the (unchanged, private) `shadowDecisionAt`. */
function refShadowDecisionAt(seed: number, index: number): "baseline" | "candidate" {
  const rng = createSeededRng(seed);
  let value = 0;
  for (let i = 0; i <= index; i++) {
    value = rng();
  }
  return value < 0.5 ? "candidate" : "baseline";
}

/** Verbatim pre-change `restoreShadowState`. */
function refRestoreShadowState(serialized: ShadowState, expected: ExperimentPlan): ShadowState {
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
  for (const assignment of serialized.assignments) {
    if (assignment.liveAction !== "baseline" || assignment.changedLiveAction !== false) {
      throw new DomainValidationError("shadow state must not change the live action");
    }
    if (assignment.shadowDecision !== "baseline" && assignment.shadowDecision !== "candidate") {
      throw new DomainValidationError("invalid shadowDecision");
    }
    refRequirePopulationEpisode(serialized.plan, assignment.episodeHash);
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

/** Verbatim pre-change `createShadowRunner`, wired to the reference restore.
 * Isolation binding is skipped: the sim passes no runner options. */
function createRefShadowRunner(plan: ExperimentPlan): ShadowRunner {
  validateExperimentPlan(plan);
  if (plan.mode !== "shadow") {
    throw new DomainValidationError("shadow runner requires mode \"shadow\"");
  }

  return {
    start(nowMs) {
      assertFiniteNowMs(nowMs);
      return {
        plan,
        halted: false,
        haltReason: undefined,
        assignments: [],
        outcomes: [],
        guardrailBreaches: 0,
        startedAtMs: nowMs,
        elapsedMs: 0,
      };
    },
    assign(state, episodeHash, nowMs) {
      const current = refRestoreShadowState(state, plan);
      const next = applyExperimentClock(current, nowMs);
      if (next.halted) {
        return next;
      }
      refRequirePopulationEpisode(next.plan, episodeHash);
      requireUniqueAssignment(next.assignments, episodeHash);
      const assignment: ShadowAssignment = {
        episodeHash,
        liveAction: "baseline",
        shadowDecision: refShadowDecisionAt(next.plan.randomization.seed, next.assignments.length),
        changedLiveAction: false,
      };
      return haltOnAssignmentBudget({
        ...next,
        assignments: [...next.assignments, assignment],
      });
    },
    recordOutcome(state, outcome, nowMs) {
      return recordExperimentOutcome(refRestoreShadowState(state, plan), outcome, nowMs);
    },
    restore(serialized) {
      return refRestoreShadowState(serialized, plan);
    },
    cancel(state, nowMs) {
      return cancelExperiment(refRestoreShadowState(state, plan), nowMs);
    },
  };
}

/** Verbatim copy of the (unchanged, private) `requireCanaryBlock`. */
function refRequireCanaryBlock(plan: ExperimentPlan): {
  readonly maxExposure: number;
  readonly reversibleScopes: readonly string[];
} {
  if (plan.canary === undefined) {
    throw new DomainValidationError("canary mode requires a canary block");
  }
  return plan.canary;
}

/** Verbatim pre-change `restoreCanaryState`. */
function refRestoreCanaryState(serialized: CanaryState, expected: ExperimentPlan): CanaryState {
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
  let derivedExposure = 0;
  for (const assignment of serialized.assignments) {
    refRequirePopulationEpisode(serialized.plan, assignment.episodeHash);
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

/** Verbatim pre-change `createCanaryRunner`, wired to the reference restore. */
function createRefCanaryRunner(plan: ExperimentPlan): CanaryRunner {
  validateExperimentPlan(plan);
  if (plan.mode !== "canary") {
    throw new DomainValidationError("canary runner requires mode \"canary\"");
  }
  refRequireCanaryBlock(plan);

  return {
    start(nowMs) {
      assertFiniteNowMs(nowMs);
      return {
        plan,
        halted: false,
        haltReason: undefined,
        assignments: [],
        outcomes: [],
        guardrailBreaches: 0,
        exposureCount: 0,
        startedAtMs: nowMs,
        elapsedMs: 0,
      };
    },
    assign(state, episodeHash, scope, nowMs) {
      const current = refRestoreCanaryState(state, plan);
      const next = applyExperimentClock(current, nowMs);
      if (next.halted) {
        return next;
      }
      refRequirePopulationEpisode(next.plan, episodeHash);
      requireUniqueAssignment(next.assignments, episodeHash);
      if (typeof scope !== "string" || scope.trim() === "") {
        throw new DomainValidationError("canary scope is required");
      }
      const canary = refRequireCanaryBlock(next.plan);
      if (!canary.reversibleScopes.includes(scope)) {
        throw new DomainValidationError(`undeclared canary scope: ${scope}`);
      }
      const action = next.exposureCount < canary.maxExposure ? "candidate" : "baseline";
      const exposureCount = next.exposureCount + (action === "candidate" ? 1 : 0);
      const assignment: CanaryAssignment = { episodeHash, action, exposureCount };
      return haltOnAssignmentBudget({
        ...next,
        assignments: [...next.assignments, assignment],
        exposureCount,
      });
    },
    recordOutcome(state, outcome, nowMs) {
      return recordExperimentOutcome(refRestoreCanaryState(state, plan), outcome, nowMs);
    },
    restore(serialized) {
      return refRestoreCanaryState(serialized, plan);
    },
    cancel(state, nowMs) {
      return cancelExperiment(refRestoreCanaryState(state, plan), nowMs);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Harness                                                            */
/* ------------------------------------------------------------------ */

let checksPassed = 0;
let failures = 0;

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function fail(line: string): void {
  process.stderr.write(`${line}\n`);
}

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    checksPassed += 1;
    return;
  }
  failures += 1;
  fail(`FAIL ${label}${detail === undefined ? "" : `: ${detail}`}`);
}

interface Attempt<T> {
  readonly value?: T;
  readonly errorMessage?: string;
  readonly errorClass?: string;
}

function attempt<T>(run: () => T): Attempt<T> {
  try {
    return { value: run() };
  } catch (error) {
    return {
      errorMessage: error instanceof Error ? error.message : String(error),
      errorClass: error instanceof Error ? error.constructor.name : "unknown",
    };
  }
}

/** Compare two attempts: identical serialized value or identical error. */
function compareAttempts<T>(label: string, expected: Attempt<T>, actual: Attempt<T>): void {
  if (expected.errorMessage !== undefined || actual.errorMessage !== undefined) {
    check(
      `${label}.error`,
      expected.errorMessage === actual.errorMessage && expected.errorClass === actual.errorClass,
      `${expected.errorClass}:${expected.errorMessage} vs ${actual.errorClass}:${actual.errorMessage}`
    );
    return;
  }
  const expectedJson = String(stableStringify(expected.value));
  const actualJson = String(stableStringify(actual.value));
  check(`${label}.state`, expectedJson === actualJson, `${expectedJson.slice(0, 200)} vs ${actualJson.slice(0, 200)}`);
}

/** Deterministic fixture generator (mulberry32, distinct seed space from production). */
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

function pick<T>(rng: () => number, values: readonly T[]): T {
  return values[Math.floor(rng() * values.length)]!;
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                           */
/* ------------------------------------------------------------------ */

const BASELINE = createResourceVersionId(() => "r1fbase");
const CANDIDATE = createCandidateId(() => "r1fcand");

function makePlan(input: {
  readonly mode: "shadow" | "canary";
  readonly populationSize: number;
  readonly seed: number;
  readonly maxAssignments: number;
  readonly maxWallClockMs: number;
  readonly maxGuardrailBreaches: number;
  readonly maxCostUsd: number;
  readonly missingOutcomePolicy: "exclude" | "treat-as-failure" | "abort";
  readonly maxExposure?: number;
}): ExperimentPlan {
  return {
    planVersion: 1,
    experimentId: `exp_r1f-${input.mode}`,
    mode: input.mode,
    baselineVersionId: BASELINE,
    candidateId: CANDIDATE,
    population: Array.from({ length: input.populationSize }, (_, i) => `ep-${i}`),
    metrics: ["utility", "cost"],
    thresholds: {
      maxGuardrailBreaches: input.maxGuardrailBreaches,
      maxCostUsd: input.maxCostUsd,
    },
    budget: { maxAssignments: input.maxAssignments, maxWallClockMs: input.maxWallClockMs },
    randomization: { seed: input.seed },
    stopPolicy: { onGuardrail: "halt", onBudgetExhausted: "halt" },
    missingOutcomePolicy: input.missingOutcomePolicy,
    ...(input.mode === "canary"
      ? { canary: { maxExposure: input.maxExposure ?? 2, reversibleScopes: ["prompt", "rubric"] } }
      : {}),
  };
}

function makeOutcome(rng: () => number, episodeHash: string): ExperimentOutcome {
  return {
    episodeHash,
    utility: Math.round(rng() * 2000 - 1000) / 1000,
    costUsd: Math.round(rng() * 500) / 100,
    guardrailBreached: rng() < 0.25,
    ...(rng() < 0.3 ? { missing: rng() < 0.5 } : {}),
    ...(rng() < 0.15 ? { userIntervention: rng() < 0.5 } : {}),
  };
}

/* ----------------- scenario 1: randomized end-to-end runs ----------------- */

type AnyState = ShadowState | CanaryState;

/** Uniform operation surface over both runner kinds (scope ignored by shadow). */
interface RunnerOps {
  start(nowMs: number): AnyState;
  assign(state: AnyState, episodeHash: string, scope: string, nowMs: number): AnyState;
  recordOutcome(state: AnyState, outcome: ExperimentOutcome, nowMs: number): AnyState;
  restore(serialized: AnyState): AnyState;
  cancel(state: AnyState, nowMs: number): AnyState;
}

function wrapShadow(runner: ShadowRunner): RunnerOps {
  return {
    start: (nowMs) => runner.start(nowMs),
    assign: (state, episodeHash, _scope, nowMs) => runner.assign(state as ShadowState, episodeHash, nowMs),
    recordOutcome: (state, outcome, nowMs) => runner.recordOutcome(state as ShadowState, outcome, nowMs),
    restore: (serialized) => runner.restore(serialized as ShadowState),
    cancel: (state, nowMs) => runner.cancel(state as ShadowState, nowMs),
  };
}

function wrapCanary(runner: CanaryRunner): RunnerOps {
  return {
    start: (nowMs) => runner.start(nowMs),
    assign: (state, episodeHash, scope, nowMs) => runner.assign(state as CanaryState, episodeHash, scope, nowMs),
    recordOutcome: (state, outcome, nowMs) => runner.recordOutcome(state as CanaryState, outcome, nowMs),
    restore: (serialized) => runner.restore(serialized as CanaryState),
    cancel: (state, nowMs) => runner.cancel(state as CanaryState, nowMs),
  };
}

function roundTrip(state: AnyState): AnyState {
  return JSON.parse(JSON.stringify(state)) as AnyState;
}

function scenarioRandomizedRuns(): void {
  const rng = fixtureRng(0x51f1);
  let operations = 0;
  for (let run = 0; run < 120; run++) {
    const mode = run % 2 === 0 ? ("shadow" as const) : ("canary" as const);
    const populationSize = 1 + Math.floor(rng() * 40);
    const plan = makePlan({
      mode,
      populationSize,
      seed: 1 + Math.floor(rng() * 100_000),
      maxAssignments: 1 + Math.floor(rng() * populationSize),
      maxWallClockMs: 50 + Math.floor(rng() * 400),
      maxGuardrailBreaches: Math.floor(rng() * 3),
      maxCostUsd: Math.round(rng() * 2000) / 100,
      missingOutcomePolicy: pick(rng, ["exclude", "treat-as-failure", "abort"] as const),
      maxExposure: 1 + Math.floor(rng() * 4),
    });

    const refOps =
      mode === "shadow" ? wrapShadow(createRefShadowRunner(plan)) : wrapCanary(createRefCanaryRunner(plan));
    const curOps = mode === "shadow" ? wrapShadow(createShadowRunner(plan)) : wrapCanary(createCanaryRunner(plan));

    let refState = refOps.start(0);
    let curState = curOps.start(0);
    compareAttempts(`run[${run}].start`, { value: refState }, { value: curState });

    const opCount = 5 + Math.floor(rng() * 30);
    let nowMs = 0;
    const assigned: string[] = [];
    for (let op = 0; op < opCount; op++) {
      nowMs += Math.floor(rng() * 40);
      const kind = rng();
      operations += 1;
      let refAttempt: Attempt<AnyState>;
      let curAttempt: Attempt<AnyState>;
      let label: string;
      if (kind < 0.45) {
        // Assign: mostly in-population fresh, sometimes duplicate or unknown.
        const roll = rng();
        const hash =
          roll < 0.75
            ? `ep-${Math.floor(rng() * populationSize)}`
            : roll < 0.9 && assigned.length > 0
              ? assigned[Math.floor(rng() * assigned.length)]!
              : `ep-unknown-${op}`;
        const scope = rng() < 0.9 ? pick(rng, ["prompt", "rubric"]) : "credentials";
        const at = nowMs;
        label = "assign";
        refAttempt = attempt(() => refOps.assign(refState, hash, scope, at));
        curAttempt = attempt(() => curOps.assign(curState, hash, scope, at));
        if (
          refAttempt.value !== undefined &&
          refAttempt.value.assignments.length > refState.assignments.length
        ) {
          assigned.push(hash);
        }
      } else if (kind < 0.75) {
        // Outcome: mostly for an assigned episode, sometimes unassigned/duplicate.
        const hash =
          assigned.length > 0 && rng() < 0.85
            ? assigned[Math.floor(rng() * assigned.length)]!
            : `ep-${Math.floor(rng() * populationSize)}`;
        const outcome = makeOutcome(rng, hash);
        const at = nowMs;
        label = "outcome";
        refAttempt = attempt(() => refOps.recordOutcome(refState, outcome, at));
        curAttempt = attempt(() => curOps.recordOutcome(curState, outcome, at));
      } else if (kind < 0.9) {
        // JSON crash round-trip through restore on both sides.
        label = "restore";
        refAttempt = attempt(() => refOps.restore(roundTrip(refState)));
        curAttempt = attempt(() => curOps.restore(roundTrip(curState)));
      } else {
        const at = nowMs;
        label = "cancel";
        refAttempt = attempt(() => refOps.cancel(refState, at));
        curAttempt = attempt(() => curOps.cancel(curState, at));
      }
      compareAttempts(`run[${run}].op[${op}].${label}`, refAttempt, curAttempt);
      if (refAttempt.value !== undefined && curAttempt.value !== undefined) {
        refState = refAttempt.value;
        curState = curAttempt.value;
      }
    }
    compareAttempts(`run[${run}].final`, { value: refState }, { value: curState });
  }
  out(`scenario 1 (randomized end-to-end runs): 120 runs, ${operations} operations compared`);
}

/* ---------------- scenario 2: tampered serialized states ---------------- */

function scenarioTamperedRestores(): void {
  const shadowPlan = makePlan({
    mode: "shadow",
    populationSize: 12,
    seed: 7,
    maxAssignments: 12,
    maxWallClockMs: 10_000,
    maxGuardrailBreaches: 2,
    maxCostUsd: 100,
    missingOutcomePolicy: "exclude",
  });
  const canaryPlan = makePlan({
    mode: "canary",
    populationSize: 12,
    seed: 7,
    maxAssignments: 12,
    maxWallClockMs: 10_000,
    maxGuardrailBreaches: 2,
    maxCostUsd: 100,
    missingOutcomePolicy: "exclude",
    maxExposure: 2,
  });

  const refShadow = createRefShadowRunner(shadowPlan);
  const curShadow = createShadowRunner(shadowPlan);
  const refCanary = createRefCanaryRunner(canaryPlan);
  const curCanary = createCanaryRunner(canaryPlan);

  let shadowState = curShadow.start(0);
  shadowState = curShadow.assign(shadowState, "ep-0", 1);
  shadowState = curShadow.assign(shadowState, "ep-3", 2);
  shadowState = curShadow.assign(shadowState, "ep-7", 3);

  let canaryState = curCanary.start(0);
  canaryState = curCanary.assign(canaryState, "ep-0", "prompt", 1);
  canaryState = curCanary.assign(canaryState, "ep-3", "rubric", 2);
  canaryState = curCanary.assign(canaryState, "ep-7", "prompt", 3);

  type Tamper = { readonly name: string; readonly mutate: (state: Record<string, unknown>) => void };
  const shadowTampers: readonly Tamper[] = [
    { name: "identity", mutate: () => undefined },
    {
      name: "episode-not-in-population",
      mutate: (s) => {
        (s["assignments"] as Record<string, unknown>[])[1]!["episodeHash"] = "ep-ghost";
      },
    },
    {
      name: "empty-episode-hash",
      mutate: (s) => {
        (s["assignments"] as Record<string, unknown>[])[2]!["episodeHash"] = "   ";
      },
    },
    {
      name: "non-string-episode-hash",
      mutate: (s) => {
        (s["assignments"] as Record<string, unknown>[])[0]!["episodeHash"] = 123;
      },
    },
    {
      name: "changed-live-action",
      mutate: (s) => {
        (s["assignments"] as Record<string, unknown>[])[1]!["changedLiveAction"] = true;
      },
    },
    {
      name: "invalid-shadow-decision",
      mutate: (s) => {
        (s["assignments"] as Record<string, unknown>[])[1]!["shadowDecision"] = "hybrid";
      },
    },
    {
      name: "halted-without-reason",
      mutate: (s) => {
        s["halted"] = true;
        delete s["haltReason"];
      },
    },
    {
      name: "negative-guardrail-breaches",
      mutate: (s) => {
        s["guardrailBreaches"] = -1;
      },
    },
    {
      name: "plan-population-swapped",
      mutate: (s) => {
        (s["plan"] as Record<string, unknown>)["population"] = ["ep-x", "ep-y"];
      },
    },
    {
      name: "plan-mode-swapped",
      mutate: (s) => {
        (s["plan"] as Record<string, unknown>)["mode"] = "canary";
      },
    },
    {
      name: "experiment-id-swapped",
      mutate: (s) => {
        (s["plan"] as Record<string, unknown>)["experimentId"] = "exp_other";
      },
    },
  ];

  for (const tamper of shadowTampers) {
    const tampered = JSON.parse(JSON.stringify(shadowState)) as Record<string, unknown>;
    tamper.mutate(tampered);
    compareAttempts(
      `shadow-tamper.${tamper.name}`,
      attempt(() => refShadow.restore(tampered as unknown as ShadowState)),
      attempt(() => curShadow.restore(tampered as unknown as ShadowState))
    );
  }

  const canaryTampers: readonly Tamper[] = [
    { name: "identity", mutate: () => undefined },
    {
      name: "episode-not-in-population",
      mutate: (s) => {
        (s["assignments"] as Record<string, unknown>[])[1]!["episodeHash"] = "ep-ghost";
      },
    },
    {
      name: "empty-episode-hash",
      mutate: (s) => {
        (s["assignments"] as Record<string, unknown>[])[0]!["episodeHash"] = "";
      },
    },
    {
      name: "non-string-episode-hash",
      mutate: (s) => {
        (s["assignments"] as Record<string, unknown>[])[2]!["episodeHash"] = null;
      },
    },
    {
      name: "invalid-action",
      mutate: (s) => {
        (s["assignments"] as Record<string, unknown>[])[1]!["action"] = "live";
      },
    },
    {
      name: "exposure-count-mismatch",
      mutate: (s) => {
        s["exposureCount"] = 5;
      },
    },
    {
      name: "population-check-precedes-action-check",
      mutate: (s) => {
        // ep-ghost on assignment 0 AND invalid action on assignment 0: the
        // population failure must win because it is checked first.
        (s["assignments"] as Record<string, unknown>[])[0]!["episodeHash"] = "ep-ghost";
        (s["assignments"] as Record<string, unknown>[])[0]!["action"] = "live";
      },
    },
  ];

  for (const tamper of canaryTampers) {
    const tampered = JSON.parse(JSON.stringify(canaryState)) as Record<string, unknown>;
    tamper.mutate(tampered);
    compareAttempts(
      `canary-tamper.${tamper.name}`,
      attempt(() => refCanary.restore(tampered as unknown as CanaryState)),
      attempt(() => curCanary.restore(tampered as unknown as CanaryState))
    );
  }

  out(
    `scenario 2 (tampered serialized states): ${shadowTampers.length + canaryTampers.length} restore cases compared`
  );
}

/* --------------------------- performance fixture --------------------------- */

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function driveFullRun(runner: ShadowRunner, populationSize: number, assignments: number): ShadowState {
  let state = runner.start(0);
  for (let i = 0; i < assignments; i++) {
    state = runner.assign(state, `ep-${i}`, i + 1);
  }
  return state;
}

function perfFixture(): void {
  const populationSize = 2000;
  const assignments = 1000;
  const plan = makePlan({
    mode: "shadow",
    populationSize,
    seed: 20260824,
    maxAssignments: assignments,
    maxWallClockMs: 10_000_000,
    maxGuardrailBreaches: 5,
    maxCostUsd: 1_000_000,
    missingOutcomePolicy: "exclude",
  });
  const refRunner = createRefShadowRunner(plan);
  const curRunner = createShadowRunner(plan);

  // Correctness first: the perf fixture must also be bitwise identical.
  counters.refMembershipComparisons = 0;
  const refFinal = driveFullRun(refRunner, populationSize, assignments);
  const comparisonsPerRun = counters.refMembershipComparisons;
  const curFinal = driveFullRun(curRunner, populationSize, assignments);
  check("perf-fixture.final-state", stableStringify(refFinal) === stableStringify(curFinal));

  const runs = 3;
  const oldTimes: number[] = [];
  const newTimes: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    driveFullRun(refRunner, populationSize, assignments);
    oldTimes.push(performance.now() - t0);
    const t1 = performance.now();
    driveFullRun(curRunner, populationSize, assignments);
    newTimes.push(performance.now() - t1);
  }
  const oldMs = median(oldTimes);
  const newMs = median(newTimes);
  out(
    `perf fixture (P=${populationSize} population, A=${assignments} assigns, one fail-closed restore per assign): ` +
      `reference ${oldMs.toFixed(1)} ms -> current ${newMs.toFixed(1)} ms (${(oldMs / newMs).toFixed(1)}x)`
  );
  out(
    `reference membership comparisons for the full run: ${comparisonsPerRun.toLocaleString("en-US")} ` +
      `(current: ${assignments.toLocaleString("en-US")} Set builds of at most ` +
      `${populationSize.toLocaleString("en-US")} inserts + O(1) lookups)`
  );
}

scenarioRandomizedRuns();
scenarioTamperedRestores();
perfFixture();

if (failures > 0) {
  fail(`\n${failures} EQUIVALENCE CHECK(S) FAILED (${checksPassed} passed)`);
  process.exit(1);
}
out(`\nALL EQUIVALENCE CHECKS PASSED (${checksPassed} bitwise checks)`);
