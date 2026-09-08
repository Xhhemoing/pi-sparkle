/**
 * Round-5 R5-F equivalence simulation for the landed S5-F optimization:
 *
 *   src/experiments/plan.ts `assertUniqueNonEmpty` — the duplicate detection
 *   inside the contract-mandated Ω(P) plan re-validation loop replaces the
 *   `seen.has(value)` + `seen.add(value)` double table probe with a single
 *   `seen.add(value)` plus a size counter. A duplicate `add` is a no-op, so
 *   `seen.size` stalling behind the counter detects the duplicate at exactly
 *   the same entry, with the identical first-fault order (empty-entry check
 *   still precedes the duplicate check per entry) and identical messages.
 *
 * The reference implementation below is the verbatim PRE-edit
 * assertUniqueNonEmpty / validateExperimentPlan pair (frozen at commit
 * 4273c3e); `validateExperimentPlan` and both runners are imported from
 * production, so the behavioural difference under test is exactly the edit.
 *
 * Also adjudicated here (all rejected, recorded as S5-F-1..3):
 *   S5-F-1  mirroring the probe dedup into dataset.ts assertUniqueNonEmpty /
 *           simulation-holdout assertExplicitSplit (test-only reachability,
 *           µs-level one-shot component).
 *   S5-F-2  bulk `new Set(values).size !== values.length` uniqueness form
 *           (diverges: cannot name the duplicate, and reorders the
 *           empty-entry / duplicate first-fault sequence).
 *   S5-F-3  indexed-loop form of the winner (noise-band form variant).
 *
 * All fixtures are generated with a seeded mulberry32 so two independent
 * runs produce bitwise-identical check verdicts (timing lines are
 * informational). Run with:
 *   npx tsx scripts/round05-r5f-equivalence-sim.ts
 */

import { DomainValidationError } from "../src/domain/errors.js";
import {
  createCandidateId,
  createResourceVersionId,
  isCandidateId,
  isResourceVersionId,
} from "../src/domain/ids.js";
import {
  createShadowRunner,
  type ExperimentOutcome,
  type ShadowState,
} from "../src/experiments/shadow.js";
import { createCanaryRunner, type CanaryState } from "../src/experiments/canary.js";
import { validateExperimentPlan, type ExperimentPlan } from "../src/experiments/plan.js";
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
  process.stdout.write(`${line}\n`);
}

function timeMs(fn: () => void, rounds = 5): number {
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

/* ------------------------------------------------------------------ */
/* Frozen PRE-edit reference (verbatim from plan.ts at 4273c3e)        */
/* ------------------------------------------------------------------ */

const REF_SUPPORTED_EXPERIMENT_PLAN_VERSION = 1;
const REF_EXPERIMENT_ID_PATTERN = /^exp_[A-Za-z0-9_-]{1,64}$/;

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
  for (const value of values) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new DomainValidationError(`${label} contains an empty entry`);
    }
    if (seen.has(value)) {
      throw new DomainValidationError(`${label} contains a duplicate: ${value}`);
    }
    seen.add(value);
  }
}

function refValidateExperimentPlan(plan: ExperimentPlan): void {
  if (typeof plan !== "object" || plan === null) {
    throw new DomainValidationError("experiment plan is required");
  }
  if (plan.planVersion !== REF_SUPPORTED_EXPERIMENT_PLAN_VERSION) {
    throw new DomainValidationError(`unsupported planVersion: ${String(plan.planVersion)}`);
  }
  if (typeof plan.experimentId !== "string" || !REF_EXPERIMENT_ID_PATTERN.test(plan.experimentId)) {
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
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function makePlan(
  mode: "shadow" | "canary",
  populationSize: number,
  maxAssignments: number,
  rng?: () => number
): ExperimentPlan {
  const population: string[] = [];
  for (let i = 0; i < populationSize; i++) {
    const suffix = rng === undefined ? "" : `_${Math.floor(rng() * 1e6).toString(36)}`;
    population.push(`ep_${i.toString(36).padStart(8, "0")}${suffix}`);
  }
  const metricsCount = rng === undefined ? 1 : 1 + Math.floor(rng() * 4);
  const metrics: string[] = [];
  for (let i = 0; i < metricsCount; i++) metrics.push(`metric_${i}`);
  return {
    planVersion: 1,
    experimentId: "exp_r5f_sim",
    mode,
    baselineVersionId: createResourceVersionId(() => "r5fbase"),
    candidateId: createCandidateId(() => "r5fcand"),
    population,
    metrics,
    thresholds: {
      maxGuardrailBreaches: rng === undefined ? 1_000_000 : Math.floor(rng() * 100),
      maxCostUsd: rng === undefined ? 1e12 : rng() * 1000,
    },
    budget: {
      maxAssignments,
      maxWallClockMs: rng === undefined ? 1e12 : 1 + Math.floor(rng() * 1e9),
    },
    randomization: { seed: rng === undefined ? 42 : Math.floor(rng() * 1e9) },
    stopPolicy: { onGuardrail: "halt", onBudgetExhausted: "halt" },
    missingOutcomePolicy:
      rng === undefined
        ? "exclude"
        : (["exclude", "treat-as-failure", "abort"] as const)[Math.floor(rng() * 3)] ?? "exclude",
    canary:
      mode === "canary"
        ? {
            maxExposure: rng === undefined ? 3 : 1 + Math.floor(rng() * 5),
            reversibleScopes:
              rng === undefined
                ? ["scope_a", "scope_b"]
                : Array.from({ length: 1 + Math.floor(rng() * 4) }, (_v, i) => `scope_${i}`),
          }
        : undefined,
  };
}

/** One tampered copy of `arr` per tamper kind. Non-string injections are the
 * shapes a hostile serialized state could smuggle past the TS types. */
function tamperedArrays(arr: readonly string[], rng: () => number): [string, unknown[]][] {
  const mid = Math.floor(arr.length / 2);
  const pick = arr[Math.floor(rng() * arr.length)] ?? arr[0]!;
  return [
    ["dup-at-head", [arr[arr.length - 1]!, ...arr]],
    ["dup-at-middle", [...arr.slice(0, mid), pick, ...arr.slice(mid)].concat(pick === arr[mid] ? [] : [])],
    ["dup-at-tail", [...arr, arr[0]!]],
    ["empty-at-head", ["", ...arr]],
    ["empty-at-middle", [...arr.slice(0, mid), "", ...arr.slice(mid)]],
    ["empty-at-tail", [...arr, ""]],
    ["whitespace-entry", [...arr, "  \t "]],
    ["inject-number", [...arr, 42]],
    ["inject-null", [...arr, null]],
    ["inject-undefined", [...arr, undefined]],
    ["inject-object", [...arr, { a: 1 }]],
    ["inject-array", [...arr, ["x"]]],
    ["inject-boolean", [...arr, true]],
    ["dup-then-empty", [...arr, arr[0]!, ""]],
    ["empty-then-dup", [...arr, "", arr[0]!]],
    ["empty-array", []],
  ];
}

function withArray(
  plan: ExperimentPlan,
  target: "population" | "metrics" | "reversibleScopes",
  arr: unknown[]
): ExperimentPlan {
  if (target === "population") {
    return { ...plan, population: arr as readonly string[] };
  }
  if (target === "metrics") {
    return { ...plan, metrics: arr as readonly string[] };
  }
  return {
    ...plan,
    canary: { ...plan.canary!, reversibleScopes: arr as readonly string[] },
  };
}

function compareValidators(label: string, plan: ExperimentPlan): boolean {
  const a = runCatch(() => refValidateExperimentPlan(plan));
  const b = runCatch(() => validateExperimentPlan(plan));
  const same = a.threw === b.threw && a.message === b.message && a.cls === b.cls;
  check(label, same, `ref="${a.message}" prod="${b.message}"`);
  return same;
}

/* ------------------------------------------------------------------ */
/* Part A — frozen-reference equivalence over a deterministic corpus   */
/* ------------------------------------------------------------------ */

function partA(): void {
  const rng = fixtureRng(0x5f01);

  // Valid plans: both sides must accept.
  let validCount = 0;
  for (let c = 0; c < 200; c++) {
    const mode = rng() < 0.5 ? "shadow" : "canary";
    const plan = makePlan(mode, 1 + Math.floor(rng() * 40), 1 + Math.floor(rng() * 20), rng);
    const a = runCatch(() => refValidateExperimentPlan(plan));
    const b = runCatch(() => validateExperimentPlan(plan));
    if (a.threw || b.threw) {
      check(`A valid plan ${c}`, false, `${a.message} / ${b.message}`);
      return;
    }
    validCount += 1;
  }
  check("A 200 valid plans accepted by both", validCount === 200);

  // Exhaustive tamper matrix on fixed plans (both modes, all three arrays).
  let tamperCount = 0;
  for (const mode of ["shadow", "canary"] as const) {
    const base = makePlan(mode, 12, 6);
    const targets: ("population" | "metrics" | "reversibleScopes")[] =
      mode === "canary" ? ["population", "metrics", "reversibleScopes"] : ["population", "metrics"];
    for (const target of targets) {
      const source =
        target === "population"
          ? base.population
          : target === "metrics"
            ? base.metrics
            : base.canary!.reversibleScopes;
      for (const [kind, arr] of tamperedArrays(source, rng)) {
        const plan = withArray(base, target, arr);
        if (!compareValidators(`A tamper ${mode}/${target}/${kind}`, plan)) return;
        tamperCount += 1;
      }
    }
  }

  // Sampled tamper matrix over random plans.
  for (let c = 0; c < 120; c++) {
    const mode = rng() < 0.5 ? "shadow" : "canary";
    const base = makePlan(mode, 1 + Math.floor(rng() * 30), 1 + Math.floor(rng() * 10), rng);
    const targets: ("population" | "metrics" | "reversibleScopes")[] =
      mode === "canary" ? ["population", "metrics", "reversibleScopes"] : ["population", "metrics"];
    const target = targets[Math.floor(rng() * targets.length)] ?? "population";
    const source =
      target === "population"
        ? base.population
        : target === "metrics"
          ? base.metrics
          : base.canary!.reversibleScopes;
    const options = tamperedArrays(source, rng);
    const [kind, arr] = options[Math.floor(rng() * options.length)] ?? options[0]!;
    const plan = withArray(base, target, arr);
    if (!compareValidators(`A sampled tamper ${c} ${mode}/${target}/${kind}`, plan)) return;
    tamperCount += 1;
  }

  // Non-helper faults: both sides share those code paths verbatim, but this
  // guards the frozen copy itself against drift.
  const base = makePlan("shadow", 5, 3);
  const canaryBase = makePlan("canary", 5, 3);
  const otherFaults: [string, ExperimentPlan][] = [
    ["bad planVersion", { ...base, planVersion: 2 as unknown as 1 }],
    ["bad experimentId", { ...base, experimentId: "nope" }],
    ["bad mode", { ...base, mode: "live" as unknown as "shadow" }],
    ["negative maxCostUsd", { ...base, thresholds: { ...base.thresholds, maxCostUsd: -1 } }],
    ["zero maxAssignments", { ...base, budget: { ...base.budget, maxAssignments: 0 } }],
    ["fractional seed", { ...base, randomization: { seed: 0.5 } }],
    ["bad onGuardrail", { ...base, stopPolicy: { ...base.stopPolicy, onGuardrail: "warn" as unknown as "halt" } }],
    ["bad missingOutcomePolicy", { ...base, missingOutcomePolicy: "ignore" as unknown as "exclude" }],
    ["shadow with canary block", { ...base, canary: { maxExposure: 1, reversibleScopes: ["s"] } }],
    ["canary without canary block", { ...canaryBase, canary: undefined }],
    ["canary maxExposure zero", { ...canaryBase, canary: { ...canaryBase.canary!, maxExposure: 0 } }],
    ["population non-array", { ...base, population: "ep_x" as unknown as readonly string[] }],
    ["null plan", null as unknown as ExperimentPlan],
  ];
  for (const [kind, plan] of otherFaults) {
    if (!compareValidators(`A other-fault ${kind}`, plan)) return;
    tamperCount += 1;
  }
  out(`part A: 200 valid plans + ${tamperCount} tampered/fault plans — throw, message, and class identical`);
}

/* ------------------------------------------------------------------ */
/* Part B — fail-closed restore surface through the production runners */
/* ------------------------------------------------------------------ */

function jsonRoundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function partB(): void {
  // Shadow: behaviourally intact operation sequence with round-trip restores.
  const shadowPlan = makePlan("shadow", 20, 10);
  const shadowRunner = createShadowRunner(shadowPlan);
  let sState = shadowRunner.start(0);
  for (const hash of shadowPlan.population.slice(0, 5)) {
    sState = shadowRunner.assign(sState, hash, 1);
    sState = shadowRunner.recordOutcome(
      sState,
      { episodeHash: hash, utility: 0.5, costUsd: 0.01, guardrailBreached: false },
      2
    );
  }
  const sRestored = shadowRunner.restore(jsonRoundTrip(sState));
  // Normalize both sides through JSON: stableStringify renders explicitly
  // undefined keys (plan.canary, haltReason), which JSON serialization drops.
  check(
    "B shadow round-trip restore state identical",
    stableStringify(jsonRoundTrip(sRestored)) === stableStringify(jsonRoundTrip(sState))
  );

  // Canary: same discipline.
  const canaryPlan = makePlan("canary", 20, 10);
  const canaryRunner = createCanaryRunner(canaryPlan);
  let cState = canaryRunner.start(0);
  for (const hash of canaryPlan.population.slice(0, 5)) {
    cState = canaryRunner.assign(cState, hash, "scope_a", 1);
    cState = canaryRunner.recordOutcome(
      cState,
      { episodeHash: hash, utility: 0.5, costUsd: 0.01, guardrailBreached: false },
      2
    );
  }
  const cRestored = canaryRunner.restore(jsonRoundTrip(cState));
  check(
    "B canary round-trip restore state identical",
    stableStringify(jsonRoundTrip(cRestored)) === stableStringify(jsonRoundTrip(cState))
  );

  // Plan-level tampering of a serialized state must fail closed through the
  // production restore with exactly the reference validator's message.
  const rng = fixtureRng(0x5f02);
  let tamperCount = 0;
  const planTargets: ("population" | "metrics")[] = ["population", "metrics"];
  for (const target of planTargets) {
    const source = target === "population" ? shadowPlan.population : shadowPlan.metrics;
    for (const [kind, arr] of tamperedArrays(source, rng)) {
      const tamperedState = jsonRoundTrip(sState) as { plan: Record<string, unknown> } & ShadowState;
      tamperedState.plan = { ...tamperedState.plan, [target]: arr };
      const expected = runCatch(() =>
        refValidateExperimentPlan(tamperedState.plan as unknown as ExperimentPlan)
      );
      const actual = runCatch(() => shadowRunner.restore(tamperedState as unknown as ShadowState));
      // Membership re-validation can only reject *after* plan validation; every
      // tamper here breaks the plan itself, so the messages must match exactly.
      if (!expected.threw || !actual.threw || expected.message !== actual.message) {
        check(`B shadow restore tamper ${target}/${kind}`, false, `${expected.message} vs ${actual.message}`);
        return;
      }
      tamperCount += 1;
    }
  }
  for (const target of ["population", "reversibleScopes"] as const) {
    const source =
      target === "population" ? canaryPlan.population : canaryPlan.canary!.reversibleScopes;
    for (const [kind, arr] of tamperedArrays(source, rng)) {
      const tamperedState = jsonRoundTrip(cState) as { plan: Record<string, unknown> } & CanaryState;
      if (target === "population") {
        tamperedState.plan = { ...tamperedState.plan, population: arr };
      } else {
        tamperedState.plan = {
          ...tamperedState.plan,
          canary: { ...(tamperedState.plan["canary"] as Record<string, unknown>), reversibleScopes: arr },
        };
      }
      const expected = runCatch(() =>
        refValidateExperimentPlan(tamperedState.plan as unknown as ExperimentPlan)
      );
      const actual = runCatch(() => canaryRunner.restore(tamperedState as unknown as CanaryState));
      if (!expected.threw || !actual.threw || expected.message !== actual.message) {
        check(`B canary restore tamper ${target}/${kind}`, false, `${expected.message} vs ${actual.message}`);
        return;
      }
      tamperCount += 1;
    }
  }
  check("B fail-closed restore tampering intact", true);
  out(`part B: 2 round-trip restores + ${tamperCount} plan-tampered restores fail closed with reference-identical messages`);
}

/* ------------------------------------------------------------------ */
/* Part C — performance and loser adjudication                         */
/* ------------------------------------------------------------------ */

/** Verbatim local copy of the landed (post-edit) form, for copy-vs-copy. */
function newFormAssertUniqueNonEmpty(values: readonly string[], label: string): void {
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

/** S5-F-3 candidate form: indexed loop instead of for-of + counter. */
function indexedFormAssertUniqueNonEmpty(values: readonly string[], label: string): void {
  if (!Array.isArray(values) || values.length === 0) {
    throw new DomainValidationError(`${label} must be a non-empty array`);
  }
  const seen = new Set<string>();
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (typeof value !== "string" || value.trim() === "") {
      throw new DomainValidationError(`${label} contains an empty entry`);
    }
    seen.add(value);
    if (seen.size !== i + 1) {
      throw new DomainValidationError(`${label} contains a duplicate: ${value}`);
    }
  }
}

/** S5-F-2 candidate form: bulk Set-size uniqueness (obvious alternative). */
function bulkFormAssertUniqueNonEmpty(values: readonly string[], label: string): void {
  if (!Array.isArray(values) || values.length === 0) {
    throw new DomainValidationError(`${label} must be a non-empty array`);
  }
  if (new Set(values).size !== values.length) {
    throw new DomainValidationError(`${label} contains a duplicate`);
  }
  for (const value of values) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new DomainValidationError(`${label} contains an empty entry`);
    }
  }
}

function partC(): void {
  const P = 2000;
  const A = 1000;
  const CALLS = 2 * A;
  const population: string[] = [];
  for (let i = 0; i < P; i++) population.push(`ep_${i.toString(36).padStart(8, "0")}`);

  // Warm every form on the same data.
  for (let i = 0; i < 100; i++) {
    refAssertUniqueNonEmpty(population, "population");
    newFormAssertUniqueNonEmpty(population, "population");
    indexedFormAssertUniqueNonEmpty(population, "population");
  }

  // C1 — copy-vs-copy component (decisive, JIT-identity-fair).
  const tRefHelper = timeMs(() => {
    for (let c = 0; c < CALLS; c++) refAssertUniqueNonEmpty(population, "population");
  });
  const tNewHelper = timeMs(() => {
    for (let c = 0; c < CALLS; c++) newFormAssertUniqueNonEmpty(population, "population");
  });
  out(
    `part C1: P=${P} × ${CALLS} calls (copy-vs-copy): has+add=${tRefHelper.toFixed(2)}ms; ` +
      `add+size=${tNewHelper.toFixed(2)}ms; saving=${(tRefHelper - tNewHelper).toFixed(2)}ms ` +
      `(${(((tRefHelper - tNewHelper) / tRefHelper) * 100).toFixed(1)}%)`
  );
  check("C1 component saving is positive", tRefHelper > tNewHelper);

  // C2 — production full experiment and component share.
  for (const [p, a] of [[200, 100], [2000, 1000]] as const) {
    const plan = makePlan("shadow", p, a);
    validateExperimentPlan(plan);
    const runner = createShadowRunner(plan);
    const outcomes: ExperimentOutcome[] = plan.population.slice(0, a).map((episodeHash) => ({
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
    }, 3);
    check(`C2 P=${p} loop completes`, finalState !== undefined && finalState.outcomes.length === a);
    const tValidate = timeMs(() => {
      for (let i = 0; i < 2 * a; i++) validateExperimentPlan(plan);
    }, 3);
    out(
      `part C2: P=${p} A=${a} production full-experiment=${tFull.toFixed(2)}ms; ` +
        `2A-validate component=${tValidate.toFixed(2)}ms (${((tValidate / tFull) * 100).toFixed(1)}%)`
    );
  }

  // C3 — S5-F-2 bulk-form divergence counterexamples.
  {
    const dupNamed = runCatch(() => refAssertUniqueNonEmpty(["a", "b", "a"], "population"));
    const dupBulk = runCatch(() => bulkFormAssertUniqueNonEmpty(["a", "b", "a"], "population"));
    check(
      "C3 bulk form cannot name the duplicate (message diverges)",
      dupNamed.threw && dupBulk.threw && dupNamed.message !== dupBulk.message,
      `${dupNamed.message} vs ${dupBulk.message}`
    );
    const orderRef = runCatch(() => refAssertUniqueNonEmpty(["x", "", ""], "population"));
    const orderBulk = runCatch(() => bulkFormAssertUniqueNonEmpty(["x", "", ""], "population"));
    check(
      "C3 bulk form reorders empty-vs-duplicate first fault",
      orderRef.threw && orderBulk.threw && orderRef.message !== orderBulk.message,
      `${orderRef.message} vs ${orderBulk.message}`
    );
  }

  // C4 — S5-F-3 indexed-loop form vs the landed form (copy-vs-copy).
  const tIndexed = timeMs(() => {
    for (let c = 0; c < CALLS; c++) indexedFormAssertUniqueNonEmpty(population, "population");
  });
  out(
    `part C4: indexed-loop form=${tIndexed.toFixed(2)}ms vs landed for-of form=${tNewHelper.toFixed(2)}ms ` +
      `(delta ${(tIndexed - tNewHelper).toFixed(2)}ms)`
  );
  check("C4 measured", Number.isFinite(tIndexed));

  // C5 — S5-F-1 dataset.ts mirror ceiling (test-only chain, one-shot).
  for (const U of [2000, 20000]) {
    const hashes: string[] = [];
    for (let i = 0; i < U; i++) hashes.push(`s_${i.toString(36).padStart(10, "0")}`);
    const perCallRef = timeMs(() => {
      for (let c = 0; c < 50; c++) refAssertUniqueNonEmpty(hashes, "episode universe");
    }) / 50;
    const perCallNew = timeMs(() => {
      for (let c = 0; c < 50; c++) newFormAssertUniqueNonEmpty(hashes, "episode universe");
    }) / 50;
    out(
      `part C5: U=${U} dataset-mirror per-validate saving=${((perCallRef - perCallNew) * 1000).toFixed(1)}µs ` +
        `(one-shot per sealed manifest; chain is repo test-only)`
    );
  }
  check("C5 measured", true);
}

partA();
partB();
partC();

out(`\ntotal: ${checks} checks, ${failures} failures`);
if (failures > 0) process.exit(1);
