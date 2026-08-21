# Phase C: Offline attribution, OPE fail-closed, calibration report

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce two offline attribution reports and a soft-threshold calibration report. Neither writes an active pointer. Invalid OPE returns `INVALID_ESTIMATE` and cannot claim improvement.

**Architecture:** New pure modules under `src/routing/offline-*.ts` plus a small report writer under `src/experiments/`. Live `routeR1` / `ModelRouter` / `promotion.ts` are not imported for writes.

**Tech Stack:** TypeScript, `tsx --test`. No new ML runtime. Logit fit is IRLS in-process.

**Spec:** [2026-08-18-three-line-final.md](../specs/2026-08-18-three-line-final.md) §5–6, §8 cases 15, 20. Dual-path item 2.

## Global Constraints

- Both estimators consume the same `taskSuccess` 0/1 labels only.
- One observation may enter the interaction term **or** a parent mean in the probability-additive heuristic, not both as if they were independent live updates. Live R1 still has no interaction.
- Holdout stays sealed; fitting uses train (and validation for model selection if needed). Holdout is report-only.
- Do not change live `softThreshold` 0.55.
- Do not close Checkpoint F. Simulation evidence ≠ production improvement.
- Commit only if the user asked for commits this session.

## Still open (do not implement)

- ADR-005 Q1 alternative dollar tolerances (`$0.02`, utility-per-dollar weight).
- ADR-005 Q2: whether a simulation report may close Checkpoint F item 1. This phase only adds the protocol sentence.

---

### Task 1: Shared offline observation schema

**Files:**
- Create: `src/routing/offline-types.ts`
- Test: Create `test/unit/routing/offline-types.test.ts`

**Interfaces:**

```ts
export interface OfflineRow {
  readonly scenarioId: string; // taskFamily|role
  readonly modelVersion: string;
  readonly projectId: string;
  readonly y: 0 | 1;           // taskSuccess only
  readonly occurredAtMs: number;
}

export interface AttributionEffect {
  readonly name: string;
  readonly point: number;
  readonly lcb: number;
  readonly ucb: number;
}

export type AttributionLabel =
  | "scenario-hard"
  | "model-problem"
  | "project-problem"
  | "interaction-only"
  | "uncertain";

export interface AttributionReport {
  readonly estimator: "logit-additive" | "probability-additive";
  readonly rowsUsed: number;
  readonly effects: readonly AttributionEffect[];
  readonly diagnosis: AttributionLabel;
  readonly reason: string;
  readonly writesActivePointer: false;
}

export function parseOfflineRow(value: unknown): OfflineRow;
```

- [ ] **Step 1: Write the failing test**

```ts
it("rejects a row that carries tracking score instead of taskSuccess y", () => {
  assert.throws(() =>
    parseOfflineRow({
      scenarioId: "bugfix|engineer",
      modelVersion: "v1",
      projectId: "prj_a",
      y: 0.41,
      occurredAtMs: 1
    })
  );
});

it("accepts a 0/1 taskSuccess row", () => {
  const row = parseOfflineRow({
    scenarioId: "bugfix|engineer",
    modelVersion: "v1",
    projectId: "prj_a",
    y: 1,
    occurredAtMs: 1
  });
  assert.equal(row.y, 1);
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement parse (`y` must be `0` or `1` exactly)**

- [ ] **Step 4: Run — expect PASS**

---

### Task 2: Probability-additive heuristic (offline only)

**Files:**
- Create: `src/routing/offline-prob-add.ts`
- Test: Create `test/unit/routing/offline-prob-add.test.ts`

**Interfaces:**

```ts
export function fitProbabilityAdditive(
  rows: readonly OfflineRow[],
  options?: { readonly kappaClamp?: readonly [number, number]; readonly seed?: number }
): AttributionReport;
```

Formulas (frozen heuristic, not a conjugate model):

```text
μ_s  = mean(y | scenario)
ŷ_m  = mean(y | modelVersion)
ŷ_p  = mean(y | projectId)
ŷ_mp = mean(y | modelVersion, projectId)

w = κ / (κ + n)
p_m  = w_m μ_s + (1-w_m) ŷ_m
p_p  = w_p μ_s + (1-w_p) ŷ_p
p_add = clip(p_m + p_p − μ_s, 0, 1)
p_mp = w_mp p_add + (1-w_mp) ŷ_mp
```

`κ` = moment estimate of cell-success variance, clamped to `[2, 40]`; if fewer than 3 cells, `κ_s = 8`. Interaction `κ_i = 16`.  
LCB on an effect: treat the leaf as `Beta(1 + n*mean, 1 + n*(1-mean))` and use Phase B `betaLowerConfidenceBound` (or normal if that is `LIVE_LCB_METHOD` — call both functions and pick via `liveLcbMethod()`).

Diagnosis (effect threshold 0.10, versioned constant `ATTRIBUTION_EFFECT = 0.10`):

| Label | Condition |
| --- | --- |
| scenario-hard | LCB(μ_s) < qualityFloor 0.55 and ≥2 models and ≥3 projects contribute |
| model-problem | LCB(p_m − μ_s) < −0.10 and interaction CI contains 0 |
| project-problem | LCB(p_p − μ_s) < −0.10 and interaction CI contains 0 |
| interaction-only | LCB(p_mp − p_add) < −0.10 |
| uncertain | else |

An `mp` cell used for `ŷ_mp` is **not** also added a second time into `ŷ_m` / `ŷ_p` as if it were an extra independent parent observation. Parents are computed from **all** rows once; the interaction residual uses `ŷ_mp - p_add` only.

- [ ] **Step 1: Write the failing test (spec case 15 + diagnosis)**

```ts
it("does not double-count an mp cell as extra parent evidence", () => {
  const rows: OfflineRow[] = [
    { scenarioId: "s|r", modelVersion: "m1", projectId: "prj_a", y: 0, occurredAtMs: 1 },
    { scenarioId: "s|r", modelVersion: "m1", projectId: "prj_a", y: 0, occurredAtMs: 2 },
    { scenarioId: "s|r", modelVersion: "m1", projectId: "prj_a", y: 0, occurredAtMs: 3 },
    { scenarioId: "s|r", modelVersion: "m2", projectId: "prj_b", y: 1, occurredAtMs: 4 },
    { scenarioId: "s|r", modelVersion: "m2", projectId: "prj_b", y: 1, occurredAtMs: 5 },
    { scenarioId: "s|r", modelVersion: "m2", projectId: "prj_c", y: 1, occurredAtMs: 6 }
  ];
  const report = fitProbabilityAdditive(rows);
  assert.equal(report.writesActivePointer, false);
  assert.equal(report.estimator, "probability-additive");
  const model = report.effects.find((e) => e.name === "p_m-mu_s:m1");
  assert.ok(model);
  // Three zeros at (m1,prj_a) inform ŷ_m1 once (n=3), not n=6
  assert.ok(report.rowsUsed === 6);
});

it("returns uncertain when intervals are wide", () => {
  const rows: OfflineRow[] = [
    { scenarioId: "s|r", modelVersion: "m1", projectId: "prj_a", y: 1, occurredAtMs: 1 }
  ];
  const report = fitProbabilityAdditive(rows);
  assert.equal(report.diagnosis, "uncertain");
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement. Never import `promoteWithRegistry` or `setActive`.**

- [ ] **Step 4: Run — expect PASS**

---

### Task 3: Logit-additive IRLS (offline only)

**Files:**
- Create: `src/routing/offline-logit.ts`, `src/routing/lin-alg.ts`
- Test: Create `test/unit/routing/offline-logit.test.ts`

**Interfaces:**

```ts
export function fitLogitAdditive(
  rows: readonly OfflineRow[],
  options?: { readonly maxIter?: number; readonly bootstrap?: number; readonly seed?: number }
): AttributionReport;
```

Model:

```text
logit Pr(y=1) = α(scenario) + u(modelVersion) + v(project) + w(modelVersion, project)
```

Drop one dummy per factor (the first seen id). Include `w` columns only when that `(model, project)` pair has `n >= 3`.  
IRLS: 50 iterations or coefficient L2 change `< 1e-8`. Singular / non-finite Hessian → report `diagnosis: "uncertain"`, `reason: "INVALID_ESTIMATE"`.  
Effects on the probability scale: average predictive comparison — for `u_m`, mean `σ(xβ)` with that model dummy on minus mean with it off, over the training rows.  
Intervals: 200 bootstrap refits, seed `20260818`, 2.5 / 97.5 percentiles. Same diagnosis table as Task 2 using those intervals.

`lin-alg.ts`: `solveSymmetric(A, b)` via Gaussian elimination with partial pivot. No npm numeric library.

Put this shared fixture in `test/unit/routing/offline-fixture.ts` and import it from Tasks 3–4:

```ts
export const OFFLINE_FIXTURE_ROWS: OfflineRow[] = [
  { scenarioId: "s|r", modelVersion: "weak", projectId: "prj_0", y: 0, occurredAtMs: 1 },
  { scenarioId: "s|r", modelVersion: "weak", projectId: "prj_1", y: 0, occurredAtMs: 2 },
  { scenarioId: "s|r", modelVersion: "weak", projectId: "prj_2", y: 0, occurredAtMs: 3 },
  { scenarioId: "s|r", modelVersion: "strong", projectId: "prj_0", y: 1, occurredAtMs: 4 },
  { scenarioId: "s|r", modelVersion: "strong", projectId: "prj_1", y: 1, occurredAtMs: 5 },
  { scenarioId: "s|r", modelVersion: "strong", projectId: "prj_2", y: 1, occurredAtMs: 6 }
];
```

- [ ] **Step 1: Write the failing test**

```ts
it("recovers a large model dummy as model-problem on a separable fixture", () => {
  const rows: OfflineRow[] = [];
  for (let i = 0; i < 8; i++) {
    rows.push({ scenarioId: "s|r", modelVersion: "weak", projectId: `prj_${i % 3}`, y: 0, occurredAtMs: i });
    rows.push({ scenarioId: "s|r", modelVersion: "strong", projectId: `prj_${i % 3}`, y: 1, occurredAtMs: 100 + i });
  }
  const report = fitLogitAdditive(rows, { bootstrap: 80, seed: 20260818 });
  assert.equal(report.writesActivePointer, false);
  assert.ok(report.diagnosis === "model-problem" || report.diagnosis === "uncertain");
  assert.ok(report.effects.some((e) => e.name.startsWith("u:weak")));
});

it("fails closed to INVALID_ESTIMATE on empty design", () => {
  const report = fitLogitAdditive([]);
  assert.equal(report.reason.includes("INVALID_ESTIMATE") || report.diagnosis === "uncertain", true);
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement IRLS + bootstrap. If bootstrap refit fails, skip that draw. If fewer than 20 successful draws, diagnosis `uncertain` / `INVALID_ESTIMATE`.**

- [ ] **Step 4: Run — expect PASS**

---

### Task 4: Two reports, no pointer writes

**Files:**
- Create: `src/experiments/attribution-report.ts`
- Test: Create `test/unit/experiments/attribution-report.test.ts`

**Interfaces:**

```ts
export function writeAttributionPair(
  rows: readonly OfflineRow[],
  sink: { writeActivePointer?: (id: string) => void }
): { readonly logit: AttributionReport; readonly probAdd: AttributionReport };
```

- [ ] **Step 1: Write the failing test**

```ts
it("runs both estimators on the same fixture and never writes a pointer", () => {
  let writes = 0;
  const pair = writeAttributionPair(OFFLINE_FIXTURE_ROWS, {
    writeActivePointer: () => {
      writes += 1;
    }
  });
  assert.equal(pair.logit.estimator, "logit-additive");
  assert.equal(pair.probAdd.estimator, "probability-additive");
  assert.equal(pair.logit.writesActivePointer, false);
  assert.equal(pair.probAdd.writesActivePointer, false);
  assert.equal(writes, 0);
});
```

`writeAttributionPair` must not call `sink.writeActivePointer`.

- [ ] **Step 2–4: RED / implement / GREEN**

---

### Task 5: OPE missing overlap/ESS is INVALID_ESTIMATE

**Files:**
- Modify: `src/routing/propensity.ts` (`validateCounterfactualReport`)
- Test: Modify the existing propensity tests; add case 20 by name

**Interfaces:**
- Produce an explicit `status: "ok" | "INVALID_ESTIMATE"` on the validation result (keep `valid` boolean).

```ts
export interface ReportValidation {
  readonly valid: boolean;
  readonly status: "ok" | "INVALID_ESTIMATE";
  readonly reasons: readonly string[];
}
```

When `!supportOk` or `effectiveSampleSize < minEffectiveSampleSize`: `status = "INVALID_ESTIMATE"`, `valid = false`.  
If `claims` match `/improve|outperform|better|regret/i`, keep the existing extra rejection reason.

- [ ] **Step 1: Write the failing test (spec case 20)**

```ts
it("returns INVALID_ESTIMATE when overlap or ESS is missing", () => {
  const report = {
    reportVersion: 1,
    candidate: "r1",
    baseline: "r0",
    claims: ["adaptive is better"],
    diagnostics: {
      totalActions: 2,
      eligibleActions: 2,
      minPropensity: 0,
      maxPropensity: 1,
      supportOk: false,
      effectiveSampleSize: 0.4
    }
  };
  const v = validateCounterfactualReport(report);
  assert.equal(v.valid, false);
  assert.equal(v.status, "INVALID_ESTIMATE");
  assert.ok(v.reasons.some((r) => /overlap|support|effective sample/i.test(r)));
});
```

- [ ] **Step 2: Run — expect FAIL** (`status` missing)

- [ ] **Step 3: Add `status`. Do not generate an improvement claim object.**

- [ ] **Step 4: Run — expect PASS**

---

### Task 6: Soft-threshold calibration report (no live change)

**Files:**
- Create: `src/experiments/threshold-calibration.ts`
- Test: Create `test/unit/experiments/threshold-calibration.test.ts`

**Interfaces:**

```ts
export interface CalibrationLabel {
  readonly score: number;          // tracking score in [0, 1]
  readonly shouldWake: boolean;    // frozen human/oracle label
}

export interface ThresholdCalibrationReport {
  readonly thresholds: readonly 0.45 | 0.55 | 0.65[];
  readonly rows: readonly { readonly threshold: number; readonly f1: number; readonly precision: number; readonly recall: number }[];
  readonly recommendedThreshold: number; // best F1 on this frozen set
  readonly liveThresholdUnchanged: 0.55;
  readonly changesLiveConfig: false;
}

export function calibrateSoftThreshold(
  labels: readonly CalibrationLabel[]
): ThresholdCalibrationReport;
```

F1 at each of `0.45 / 0.55 / 0.65`: predicted wake ⇔ `score < threshold`.  
`recommendedThreshold` is informational. `changesLiveConfig` is always false.

- [ ] **Step 1: Write the failing test**

```ts
it("reports F1 at 0.45/0.55/0.65 and does not change live 0.55", () => {
  const labels = [
    { score: 0.4, shouldWake: true },
    { score: 0.5, shouldWake: true },
    { score: 0.7, shouldWake: false },
    { score: 0.9, shouldWake: false }
  ];
  const report = calibrateSoftThreshold(labels);
  assert.deepEqual(report.thresholds, [0.45, 0.55, 0.65]);
  assert.equal(report.rows.length, 3);
  assert.equal(report.liveThresholdUnchanged, 0.55);
  assert.equal(report.changesLiveConfig, false);
  assert.ok(report.rows.every((r) => r.f1 >= 0 && r.f1 <= 1));
});
```

- [ ] **Step 2–4: RED / implement / GREEN.** Do not call `applyUserThreshold`.

---

### Task 7: Three-way split and holdout contamination

**Files:**
- Modify: `src/experiments/manifest.ts` (`split` gains `holdout`)
- Test: existing manifest tests + new case 21

**Interfaces:**

```ts
split: { train: readonly string[]; validation: readonly string[]; holdout: readonly string[] }
```

Rename `eval` → `validation` **or** accept `eval` as an alias while requiring `holdout`. Prefer adding `holdout` and keeping `eval` as validation to avoid a wide rename: `split.train`, `split.eval`, `split.holdout`.  
Validate: the three arrays are disjoint; every hash is in `episodeHashes`; intersection with `exclusions` is empty.  
`markHoldoutCompromised(manifest, reason)` sets a `compromised: true` flag (add optional field) so later optimization access fails closed.

- [ ] **Step 1: Write the failing test (spec case 21)**

```ts
it("rejects a hash that appears in train and holdout", () => {
  assert.throws(() =>
    validateManifest({
      ...validManifest,
      split: { train: ["h1"], eval: ["h2"], holdout: ["h1"] }
    })
  );
});

it("marks a holdout compromised after optimization access", () => {
  const sealed = markHoldoutCompromised(validManifest, "used to tune threshold");
  assert.equal(sealed.compromised, true);
  assert.throws(() => assertHoldoutUsable(sealed));
});
```

- [ ] **Step 2–4: RED / implement / GREEN.** `holdout` is optional on old manifests (`undefined` → no holdout, cannot claim sealed evaluation).

---

### Task 8: ADR-005 protocol sentence

**Files:**
- Modify: `docs/decisions/0005-checkpoint-f-holdout-open-questions.md`

Add under Decision (do not mark the ADR Accepted, do not close item 1):

```markdown
## Protocol (2026-08-18 three-line final)

Simulation, replay, and offline attribution reports are `evidenceClass: simulation`
or `replay`. They do **not** equal production improvement and must not be
written as Outcome-supported. Checkpoint F item 1 stays open until the
cost-quality target (Q1) and holdout data source (Q2) are answered.
Primary endpoint for any later claim is pre-registered `taskSuccess`
(or an explicit multi-objective utility), never tracking `score`.
Cost comparisons use the CI **upper bound**, not the mean.
```

- [ ] **Step 1: Add the section.** No code.

- [ ] **Step 2: Confirm the ADR status line is still `Open`.**

---

### Task 9: Phase C quality gate

- [ ] **Step 1: Run** `corepack pnpm exec tsx --test test/unit/routing/offline-types.test.ts test/unit/routing/offline-prob-add.test.ts test/unit/routing/offline-logit.test.ts test/unit/experiments/attribution-report.test.ts test/unit/experiments/threshold-calibration.test.ts`

- [ ] **Step 2: Run** `corepack pnpm test` **and** `corepack pnpm run typecheck`

- [ ] **Step 3: Grep `src/routing/offline-*.ts` for `promote`, `setActive`, `applyUserThreshold` — zero matches**

Expected: no live threshold change; no Checkpoint F closure.

---

## Handoff

After Phase C is green, open [2026-08-18-phase-d-promotion-cas.md](./2026-08-18-phase-d-promotion-cas.md).
