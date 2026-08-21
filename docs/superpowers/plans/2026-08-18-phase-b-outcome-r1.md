# Phase B: Outcome vector, dual LCB, and corrected R1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Production R1 consumes only `taskSuccess` PASS/FAIL, trusts `nObsEff` (not prior strength), uses a coverage-selected LCB, and falls back to the approved R0 baseline when sparse — never the noisiest max-LCB.

**Architecture:** Extend existing `outcomes.ts` / `posterior.ts` / `r1.ts`. Add Beta-quantile LCB beside the current normal approximation. A checked-in coverage fixture picks the live default. Hierarchical models stay out of this phase.

**Tech Stack:** TypeScript, `tsx --test`. No new runtime dependencies. No MCMC.

**Spec:** [2026-08-18-three-line-final.md](../specs/2026-08-18-three-line-final.md) §5, §8 cases 13–19.

## Global Constraints

- Do not import tracking `score` / `P` / `H` into `OutcomeObservation`.
- Do not write interaction or project effects into the live estimator.
- High-risk exploration count remains 0; R0 high-risk whitelist still wins.
- Live `assign.ts` / `ModelRouter` stay R0-equivalent unless a later approved `routing-policy` is present (this phase only corrects the R1 library).
- Tests: `corepack pnpm exec tsx --test <files>` then `corepack pnpm run typecheck`.
- Commit only if the user asked for commits this session.

---

### Task 1: Outcome vector on observations

**Files:**
- Modify: `src/routing/outcomes.ts`
- Test: Create `test/unit/routing/outcomes.test.ts`; update helpers in `test/unit/routing/r1.test.ts`

**Interfaces:**
- Consumes: existing `OutcomeKind`, `outcomeKey`
- Produces:

```ts
export const OUTCOME_CRITERIA = [
  "taskSuccess",
  "policyCompliance",
  "userAcceptance",
  "cost",
  "latency",
  "rework"
] as const;
export type OutcomeCriterion = (typeof OUTCOME_CRITERIA)[number];

export interface OutcomeObservation {
  readonly taskFamily: string;
  readonly role: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly featureVersion: string;
  readonly criterion: OutcomeCriterion;
  readonly outcome: OutcomeKind;
  readonly occurredAtMs: number;
  readonly source?: "deterministic-check" | "human" | "peer";
}
```

`isInformativeOutcome` stays PASS/FAIL only.  
`observationsForR1(observations)` returns rows with `criterion === "taskSuccess"` (default missing `criterion` is **not** allowed — parse fail-closed).

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isInformativeOutcome, observationsForR1, parseOutcomeObservation } from "../../../src/routing/outcomes.js";

const base = {
  taskFamily: "bugfix",
  role: "engineer",
  modelId: "cheap",
  modelVersion: "v1",
  featureVersion: "feat-1",
  occurredAtMs: 1000
};

describe("outcome vector", () => {
  it("rejects an observation without criterion", () => {
    assert.throws(() => parseOutcomeObservation({ ...base, outcome: "PASS" }));
  });

  it("keeps policy FAIL out of the R1 taskSuccess stream", () => {
    const success = parseOutcomeObservation({ ...base, criterion: "taskSuccess", outcome: "PASS" });
    const policy = parseOutcomeObservation({ ...base, criterion: "policyCompliance", outcome: "FAIL" });
    const rows = observationsForR1([success, policy]);
    assert.deepEqual(rows, [success]);
    assert.equal(isInformativeOutcome(policy), true);
  });

  it("does not treat UNOBSERVED as a failure", () => {
    const row = parseOutcomeObservation({ ...base, criterion: "taskSuccess", outcome: "UNOBSERVED" });
    assert.equal(isInformativeOutcome(row), false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Add `criterion` as required; `parseOutcomeObservation` throw `DomainValidationError` on missing/unknown criterion. Update every `OutcomeObservation` fixture in `test/unit/routing/r1.test.ts` to `criterion: "taskSuccess"`.**

- [ ] **Step 4: Run outcomes + r1 tests — r1 may still be green if helpers were updated; outcomes tests PASS**

---

### Task 2: nObsEff vs nPriorEff

**Files:**
- Modify: `src/routing/posterior.ts`
- Test: Modify `test/unit/routing/r1.test.ts` (posterior describe); Create `test/unit/routing/posterior-samples.test.ts`

**Interfaces:**

```ts
export interface PosteriorStats {
  readonly posterior: BetaPosterior;
  readonly nObsEff: number;
  readonly nPriorEff: number;
}

export function posteriorStats(
  config: PosteriorConfig,
  observations: readonly OutcomeObservation[],
  nowMs: number
): PosteriorStats;

export function isWellSampled(config: PosteriorConfig, stats: PosteriorStats): boolean;
```

`nPriorEff = config.priorAlpha + config.priorBeta` (default 2).  
`nObsEff = weightedSampleSize` (sum of decayed PASS/FAIL weights only).  
`isWellSampled` ⇔ `nObsEff >= config.minSamples` **and** at least one observation has `source` of `"deterministic-check"` or `"human"` when `requireIndependentSource` is true (default true for promotion/trust).  
A parent-only prior must not satisfy the gate.

Keep `updatePosterior` for the Beta numbers. Change `isWellSampled` callers in `r1.ts` to use `posteriorStats`.

- [ ] **Step 1: Write the failing test (spec case 13)**

```ts
it("does not let a strong prior satisfy nObsEff >= 5", () => {
  const config = { ...DEFAULT_POSTERIOR_CONFIG, priorAlpha: 50, priorBeta: 2, minSamples: 5 };
  const stats = posteriorStats(config, [], 1000);
  assert.ok(stats.nPriorEff >= 5);
  assert.equal(stats.nObsEff, 0);
  assert.equal(isWellSampled(config, stats), false);
});

it("counts only informative taskSuccess rows toward nObsEff", () => {
  const stats = posteriorStats(
    DEFAULT_POSTERIOR_CONFIG,
    [
      { ...base, criterion: "taskSuccess", outcome: "UNOBSERVED", occurredAtMs: 1000, source: "deterministic-check" },
      { ...base, criterion: "taskSuccess", outcome: "PASS", occurredAtMs: 1000, source: "deterministic-check" }
    ],
    1000
  );
  assert.equal(stats.nObsEff, 1);
});
```

- [ ] **Step 2: Run — expect FAIL** (`posteriorStats` missing; current `isWellSampled` uses alpha+beta−prior which is nObs, but a fat prior is not currently testable as a fake nObs — add the explicit split)

- [ ] **Step 3: Implement `posteriorStats`; switch `isWellSampled` to nObsEff. Keep `weightedSampleSize` as an alias of nObsEff for old tests or update those tests.**

- [ ] **Step 4: Run — expect PASS**

---

### Task 3: Dual LCB (Beta quantile + normal)

**Files:**
- Create: `src/routing/lcb-beta.ts`, `src/routing/lcb-normal.ts`, `src/routing/beta-quantile.ts`
- Modify: `src/routing/posterior.ts` (`lowerConfidenceBound` becomes a wrapper)
- Test: Create `test/unit/routing/lcb.test.ts`

**Interfaces:**

```ts
export function regularizedIncompleteBeta(x: number, a: number, b: number): number;
export function betaQuantile(a: number, b: number, p: number): number; // p in (0,1)
export function betaLowerConfidenceBound(posterior: BetaPosterior, tail = 0.025): number;
export function normalLowerConfidenceBound(posterior: BetaPosterior, z = 1.96): number;
```

`lcb-normal.ts` is the current `mean - z * sd`, clipped to `[0, 1]`.  
`lcb-beta.ts` is `betaQuantile(alpha, beta, tail)`.  
Implement `betaQuantile` by bisection on `regularizedIncompleteBeta` (no new dependency). Clamp x to `(0,1)`, 80 iterations or width `< 1e-10`.

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { betaQuantile } from "../../../src/routing/beta-quantile.js";
import { betaLowerConfidenceBound } from "../../../src/routing/lcb-beta.js";
import { normalLowerConfidenceBound } from "../../../src/routing/lcb-normal.js";

describe("beta quantile", () => {
  it("matches Uniform(0,1) = Beta(1,1)", () => {
    assert.ok(Math.abs(betaQuantile(1, 1, 0.025) - 0.025) < 1e-6);
  });

  it("matches Beta(2,1) whose CDF is x^2", () => {
    assert.ok(Math.abs(betaQuantile(2, 1, 0.25) - 0.5) < 1e-6);
  });

  it("gives a lower Beta LCB than the raw mean on a sparse posterior", () => {
    const sparse = { alpha: 3, beta: 1 }; // mean 0.75, nObs small
    const lcb = betaLowerConfidenceBound(sparse);
    assert.ok(lcb < 0.75);
    assert.ok(lcb >= 0);
  });

  it("keeps the existing normal approximation", () => {
    const dense = { alpha: 51, beta: 11 };
    const lcb = normalLowerConfidenceBound(dense);
    assert.ok(lcb < 51 / 62);
    assert.ok(lcb > 0.7);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement incomplete beta via the continued-fraction form for `I_x(a,b)` (Lentz). If `x === 0` or `x === 1`, return 0/1. Swap via `I_x(a,b) = 1 - I_{1-x}(b,a)` when `x > (a+1)/(a+b+2)` for stability.**

- [ ] **Step 4: Run — expect PASS**

---

### Task 4: Coverage fixture selects the live default

**Files:**
- Create: `src/routing/lcb-select.ts`, `src/routing/lcb-coverage.ts`
- Test: Create `test/unit/routing/lcb-coverage.test.ts`
- Fixture output (generated in test, asserted, not a binary): function `simulateLcbCoverage` returns numbers the test checks in.

**Interfaces:**

```ts
export type LcbMethod = "beta-quantile" | "normal";
export interface CoverageCell {
  readonly n: 3 | 5 | 10 | 30;
  readonly trueP: 0.3 | 0.5 | 0.8;
  readonly trials: number;
  readonly betaCoverage: number;
  readonly normalCoverage: number;
}

export function simulateLcbCoverage(input: {
  readonly ns: readonly (3 | 5 | 10 | 30)[];
  readonly truePs: readonly (0.3 | 0.5 | 0.8)[];
  readonly trials: number; // 2000
  readonly seed: number;   // 20260818
}): readonly CoverageCell[];

export function selectDefaultLcb(cells: readonly CoverageCell[]): {
  readonly method: LcbMethod;
  readonly reason: string;
};
```

Coverage for a one-sided 95% LCB: fraction of trials where `trueP >= LCB`.  
Pre-registered: a method **passes** if mean coverage across cells is `>= 0.90`.  
Default: among passing methods, pick the one whose mean coverage is closer to 0.95; tie → `beta-quantile`. If neither passes, throw `DomainValidationError` (do not silently ship a failing default).

Seeded RNG: reuse `createSeededRng` from `src/experiments/replay.ts`.  
For each trial: draw `s ~ Binomial(n, trueP)` via n Bernoulli draws from the seeded rng; posterior `Beta(1+s, 1+n-s)`.

- [ ] **Step 1: Write the failing test (spec case 16)**

```ts
it("records coverage for both LCB methods on the registered grid", () => {
  const cells = simulateLcbCoverage({
    ns: [3, 5, 10, 30],
    truePs: [0.3, 0.5, 0.8],
    trials: 2000,
    seed: 20260818
  });
  assert.equal(cells.length, 12);
  for (const cell of cells) {
    assert.ok(cell.betaCoverage >= 0 && cell.betaCoverage <= 1);
    assert.ok(cell.normalCoverage >= 0 && cell.normalCoverage <= 1);
  }
  const selected = selectDefaultLcb(cells);
  assert.ok(selected.method === "beta-quantile" || selected.method === "normal");
});

it("is deterministic under the registered seed", () => {
  const a = simulateLcbCoverage({ ns: [5], truePs: [0.5], trials: 200, seed: 20260818 });
  const b = simulateLcbCoverage({ ns: [5], truePs: [0.5], trials: 200, seed: 20260818 });
  assert.deepEqual(a, b);
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement simulation + selector. Export `LIVE_LCB_METHOD` as the result of `selectDefaultLcb(simulateLcbCoverage({ ns:[3,5,10,30], truePs:[0.3,0.5,0.8], trials:2000, seed:20260818 }))` computed once in module init **or** (preferred) a function `liveLcbMethod()` that memoizes. Do not hard-code the winner until the test has run; the test is the source of the choice.**

Keep the loser callable for reports (`compareLcbMethods(cells)` returns both means).

- [ ] **Step 4: Run — expect PASS.** Note the selected method in the PR/commit body, not in product copy as “Outcome-supported”.

---

### Task 5: R1 cheapest-above-floor + conservative fallback

**Files:**
- Modify: `src/routing/r1.ts`
- Test: Modify `test/unit/routing/r1.test.ts`

**Interfaces:**
- Consumes: `posteriorStats`, `liveLcbMethod()`, R0 decision
- Produces: updated `R1Estimate` with `nObsEff`, `nPriorEff`, `lcbMethod`

```ts
export interface R1Config extends PosteriorConfig {
  readonly qualityFloor: number;      // 0.55 standard
  readonly highRiskQualityFloor: number; // 0.70
  readonly hysteresisDelta: number;   // 0.03
  readonly hysteresisTurns: number;   // 2
}

export const DEFAULT_R1_CONFIG: R1Config = {
  ...DEFAULT_POSTERIOR_CONFIG,
  qualityFloor: 0.55,
  highRiskQualityFloor: 0.70,
  hysteresisDelta: 0.03,
  hysteresisTurns: 2
};

export interface R1Input {
  // existing fields, plus:
  readonly previousSelection?: string;
  readonly pendingSelection?: string; // last turn's unused proposal for hysteresisTurns
}
```

Live decision (after R0 eligibility):

```text
high-risk → R0 whitelist only (already); never explore
no well-sampled estimate → R0 selection (fallback=true)
well-sampled with LCB >= floor → cheapest in R0 tier order among those
none meet floor → R0 selection (fallback=true)   // NOT max LCB
```

Replace the current “highest LCB among well-sampled” test. That test expected `mid` over `cheap` because mid’s LCB was higher; under the new rule, if both LCBs are ≥ 0.55, pick `cheap` (R0 cheapest). Rewrite it:

```ts
it("selects the cheapest well-sampled model whose LCB meets the quality floor", () => {
  const cheapPasses = Array.from({ length: 30 }, () =>
    obs({ modelId: "cheap", modelVersion: "v1", outcome: "PASS", criterion: "taskSuccess", source: "deterministic-check" })
  );
  const midMixed = Array.from({ length: 50 }, () =>
    obs({ modelId: "mid", modelVersion: "v2", outcome: "PASS", criterion: "taskSuccess", source: "deterministic-check" })
  ).concat(Array.from({ length: 10 }, () =>
    obs({ modelId: "mid", modelVersion: "v2", outcome: "FAIL", criterion: "taskSuccess", source: "deterministic-check" })
  ));
  const decision = routeR1(r1Input([...cheapPasses, ...midMixed]));
  assert.equal(decision.fallback, false);
  assert.equal(decision.selection, "cheap");
  assert.match(decision.reason, /cheapest|floor|quality/i);
});

it("does not pick max LCB among sparse cells", () => {
  const noisy = [
    obs({ modelId: "mid", modelVersion: "v2", outcome: "PASS", criterion: "taskSuccess", source: "deterministic-check" }),
    obs({ modelId: "mid", modelVersion: "v2", outcome: "PASS", criterion: "taskSuccess", source: "deterministic-check" })
  ];
  const decision = routeR1(r1Input(noisy));
  assert.equal(decision.fallback, true);
  assert.equal(decision.selection, decision.estimates[0] && /* R0 cheapest */ "cheap");
  assert.match(decision.reason, /baseline/);
});
```

Keep: R0 refusal propagation, feature-version isolation, determinism, sparse fallback.

- [ ] **Step 1: Change the highest-LCB test as above; run — expect FAIL** (current code still picks max LCB)

- [ ] **Step 2: Implement cheapest-above-floor. Use `input.r0.request.highRisk` to pick the floor. Compute LCB via `liveLcbMethod()`.**

- [ ] **Step 3: Run r1 tests — expect PASS**

---

### Task 6: Cooldown / hysteresis

**Files:**
- Modify: `src/routing/r1.ts`
- Test: `test/unit/routing/r1.test.ts`

Rule: if `previousSelection` is still eligible and well-sampled, do not switch to a different model unless:

1. `lcb(new) - lcb(previous) >= hysteresisDelta` (0.03), **or**
2. `pendingSelection === newSelection` (the same challenger was proposed last turn).

Otherwise keep `previousSelection` and set `pendingSelection` on the result so the caller can persist it.

```ts
export interface R1Decision {
  readonly selection: string | undefined;
  readonly pendingSelection?: string;
  readonly estimates: readonly R1Estimate[];
  readonly reason: string;
  readonly exploratory: false;
  readonly fallback: boolean;
}
```

- [ ] **Step 1: Write the failing test**

```ts
it("does not flip on a sub-threshold LCB gap", () => {
  const cheapObs = Array.from({ length: 20 }, () =>
    obs({ modelId: "cheap", modelVersion: "v1", outcome: "PASS", criterion: "taskSuccess", source: "deterministic-check" })
  );
  const midObs = Array.from({ length: 20 }, () =>
    obs({ modelId: "mid", modelVersion: "v2", outcome: "PASS", criterion: "taskSuccess", source: "deterministic-check" })
  );
  const first = routeR1(r1Input([...cheapObs, ...midObs]));
  assert.equal(first.selection, "cheap");
  const second = routeR1({
    ...r1Input([...cheapObs, ...midObs]),
    previousSelection: "mid"
  });
  // mid is eligible and well-sampled; cheap may be slightly better but stay if delta < 0.03
  if (Math.abs(
    (second.estimates.find((e) => e.modelId === "cheap")?.lcb ?? 0) -
    (second.estimates.find((e) => e.modelId === "mid")?.lcb ?? 0)
  ) < 0.03) {
    assert.equal(second.selection, "mid");
    assert.equal(second.pendingSelection, "cheap");
  }
});

it("flips after two consecutive agreeing turns", () => {
  const cheapObs = Array.from({ length: 40 }, () =>
    obs({ modelId: "cheap", modelVersion: "v1", outcome: "PASS", criterion: "taskSuccess", source: "deterministic-check" })
  );
  const midFail = Array.from({ length: 20 }, () =>
    obs({ modelId: "mid", modelVersion: "v2", outcome: "FAIL", criterion: "taskSuccess", source: "deterministic-check" })
  );
  const once = routeR1({
    ...r1Input([...cheapObs, ...midFail]),
    previousSelection: "mid"
  });
  const twice = routeR1({
    ...r1Input([...cheapObs, ...midFail]),
    previousSelection: "mid",
    pendingSelection: "cheap"
  });
  assert.equal(twice.selection, "cheap");
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement hysteresis after the cheapest-above-floor pick. Fallback-to-R0 is not a “flip” that hysteresis blocks: if the new decision is fallback, keep R0 baseline.**

- [ ] **Step 4: Run — expect PASS**

---

### Task 7: Version keys stay isolated

**Files:**
- Modify: none if Task 1–5 already keep `outcomeKey(taskFamily, role, modelVersion, featureVersion)`
- Test: existing `model-version resets isolate estimates` and `feature-version changes isolate estimates` must still pass. Add:

```ts
it("does not inherit old modelVersion outcomes into a new version key", () => {
  const old = Array.from({ length: 8 }, () =>
    obs({ modelId: "cheap", modelVersion: "v1", outcome: "FAIL", criterion: "taskSuccess", source: "deterministic-check" })
  );
  const models = [CHEAP, { ...CHEAP, version: "v2" }];
  const decision = routeR1(r1Input(old, { models, featureVersion: "feat-1" }));
  const v2 = decision.estimates.find((e) => e.modelId === "cheap" && e.key.includes("|v2|"));
  // If the catalog now advertises v2, nObsEff for v2 is 0
  if (v2 !== undefined) {
    assert.equal(v2.nObsEff ?? v2.samples, 0);
  }
});
```

If `R1Estimate` does not yet expose `nObsEff`, add it in this task.

- [ ] **Step 1–4: RED if needed / implement / GREEN.** Old v1 rows remain in the input array (auditable); they simply do not match the new key.

---

### Task 8: Phase B quality gate

- [ ] **Step 1: Run** `corepack pnpm exec tsx --test test/unit/routing/outcomes.test.ts test/unit/routing/r1.test.ts test/unit/routing/lcb.test.ts test/unit/routing/lcb-coverage.test.ts test/unit/routing/posterior-samples.test.ts`

- [ ] **Step 2: Run** `corepack pnpm test` **and** `corepack pnpm run typecheck`

- [ ] **Step 3: Confirm `src/routing/r1.ts` does not import `src/tracking/` and does not read `score`**

Expected: cases 13–19 except OPE (case 20, Phase C). Live ModelRouter still has no R1 import.

---

## Handoff

After Phase B is green, open [2026-08-18-phase-c-offline-attribution.md](./2026-08-18-phase-c-offline-attribution.md). Do not connect hierarchical estimates to `routeR1`.
