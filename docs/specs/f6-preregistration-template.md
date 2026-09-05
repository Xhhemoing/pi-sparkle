# F6 Pre-Registration — Holdout Collection (TEMPLATE, freeze before Week 1)

> Fill every field; then commit this file's SHA-256 into the seal manifest.
> Anything marked ASSUMPTION is a number chosen without a pilot — it binds
> anyway. Changing any field after Week 1 starts voids episodes collected
> after the change (decision package §2.10).

- **Seal commit**: `<commit sha of this file + commitments.json>`
- **Custodian** (plaintext specs + oracles holder, independent of router tuning): `<name/role>`
- **Collection window**: Week 1–4, `<dates>`

## 1. Endpoint
Primary: `taskSuccess` per the per-family mechanical oracles below. Tracking
score is NOT an endpoint (ADR-005 gate 4).

## 2. Units
taskSpec / armRun / pairedBlock as defined in the decision package §2.1.
Confirmatory sample: **100 pairedBlocks** (200 armRuns) — the strictest
reading of the ADR-005 floor.

## 3. Families
Claimed (30 blocks each): implementation, testing, review.
Exploratory only (10 blocks): research — never promoted post hoc.

## 4. Power (numeric, binding)
- Utility: sd(Δ) = **0.63** (ASSUMPTION), MDE = **0.15** (ASSUMPTION) →
  formula n = 139; adopted budget n = 100 blocks ⇒ detectable overall delta
  ≈ **0.18** at 80% power. Pilot trigger: if the block-10 safety look shows
  sd(Δ) > 0.80, pause and re-power (no quiet extension).
- Cost: sd = **$0.40/block** (ASSUMPTION), one-sided margin **$0.10** →
  n = 126; at n = 100 the excludable cost harm is ≈ **$0.11/block**.

## 5. Closure rule (the only close condition)
Overall utility-delta 95% CI lower bound > 0 **AND** overall cost-delta 95%
CI upper bound ≤ 0. Intersection–union: both at α = 0.05, no adjustment.
Utility CI: BCa bootstrap over block deltas, 10,000 resamples, seed = `<n>`.
Sensitivity: McNemar exact reported alongside. Family CIs descriptive only.

## 6. Isolation protocol
Disposable git worktree + fresh state root per armRun; provider cache
disabled or recorded (`cacheHit` on every invocation row — a true on
holdout-derived content voids the pair); cross-arm information barrier until
both arms complete; carryover diagnostic per block; matched-pair fallback
trigger: `<exact condition>`.

## 7. Arms
- R0: `<complete static definition — model per family or single default>`
- Adaptive: routing policy frozen at parameterHash `<hash>`; learning from
  holdout tasks/labels during collection is prohibited.

## 8. Executor policy
Real provider invocations only (`executorClass: "pi"` on every row;
programmatic check, fail-closed). Fake executor banned for holdout episodes.
Smoke blocks (excluded): `<taskIds>`.

## 9. Backlog seal
100 specs + 15 reserves: SHA-256 commitments in
`holdout/commitments.json` (via `node scripts/holdout-seal.mjs seal`).
Plaintext with the custodian; reveal-on-schedule only.

## 10. Exclusion / replacement
Objective arm-blind criteria only (infrastructure failure evidenced in
invocations.jsonl, cache-contamination flag, provenance failure). Failed
armRuns retained and reported. Reserves drawn by committed schedule,
seed = `<n>`. Per-arm failure rates reported.

## 11. Randomization
Per-block arm order: `sha256(seed || specHash)` bit 0 (implemented in
`scripts/holdout-block.mjs`). Seed = `<n>`.

## 12. Cost source
- [ ] Provider billing records reconciled per invocation ID, OR
- [ ] Owner-frozen price table v`<n>` (results labeled ESTIMATE).
Retries/failed calls count toward the arm (intention-to-treat on cost).

## 13. Adjudication
Scorer: `<name>`; arm-blind where feasible; 48h window; frozen predicates only.

## 14. Stopping
Fixed n = 100 blocks; no efficacy peeking; one non-inferential safety look
after block 10.

## 15. Owner sign-offs (the five §5 questions)
1. Dogfood-as-production under ADR-005: `<yes/no + rationale>`
2. Custodian: `<name>`
3. xhh pricing source: `<billing records | frozen table v…>`
4. R0 definition: `<text>`
5. Learning-arm freeze scope: `<text>`
