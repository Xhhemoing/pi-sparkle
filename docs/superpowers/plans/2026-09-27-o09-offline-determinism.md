# O09 deterministic offline analysis implementation

## Identity

- ID: `TASK-20260927-o09-offline-determinism`.
- Owner: current coordinator; implementation/review subagents have explicit file ownership.
- State: `accepted` for the bounded O09 offline slice on 2026-09-27; integration and publication remain pending.
- Source revision: `e1ce19c0f93d8e34e7ca25512c5d32d2743ba669` (provenance only).
- Parent: [reliability O09](2026-09-27-reliability-optimization.md#o09--deterministic-offline-conclusions).
- Related authority: [ADR-008](../../decisions/0008-remove-sha256.md), [Phase C protocol](2026-08-18-phase-c-offline-attribution.md), [status matrix](../../status-matrix.md).

## Problem and Scope

The parent reliability task is already being implemented in a different active checkout. This isolated `codex/offline-determinism-o09` branch owns O09a/b only; other packages remain with that coordinator. User explicitly authorized cross-chat coordination. Existing uncommitted planning documents in the original checkout are preserved and copied here as context, not authored by this slice.

In scope: offline logit permutation stability and meaningful effects for every model, and deterministic complete-link admission for recurring signatures. No live routing, active-pointer writes, new hash, gate, database, provider execution, holdout, or S0/R10/R11/F6 acceptance. No unrelated cleanup or runtime performance claims.

## Acceptance Criteria

- [x] O09b: every permutation of A~B, B~C, A!~C produces the same result and never combines dissimilar endpoints in one cluster.
- [x] O09b: cross-kind isolation, stable output order, negative controls, severe one-off handling and input immutability hold.
- [x] O09a: fixed shuffles produce the same diagnosis and aligned numerical effects within a declared tolerance, including a weak reference model.
- [x] O09a: model effects use one explicitly documented identifiable predictive contrast; singular/non-identifiable evidence remains uncertain.
- [x] Both focused suites, adjacent tests, `pnpm workflow:check`, and existing `pnpm gate` are recorded with actual outcomes.
- [x] Separate specification and quality review, current limitations, changed semantics and handoff are recorded.

## Implementation Slice

| File/symbol | Change | Owner | Dependency/risk |
|---|---|---|---|
| `src/learning/patterns.ts`, `test/unit/learning/patterns.test.ts` | O09b deterministic group admission | patterns implementer | changes grouping semantics |
| `src/routing/offline-logit.ts`, its unit tests, optional offline-types comments | O09a stable fit/contrasts | logit implementer after design note | statistical interpretation changes |
| this plan, dated report, Phase C correction, task/status references | design, evidence, reconciliation | coordinator | no claim of overall plan acceptance |

## O09b rule decision before implementation

Use deterministic greedy complete-link admission, not connected-components and not an optimal global clustering claim. Sort kinds and signatures by stable exact identity (episode id, then deterministic content tie-breaks); the first unused signature seeds a cluster and another signature joins only if its feature similarity meets `minSimilarity` against **every** current member. All output indices follow that stable traversal. Do not use a digest as identity evidence or alter the existing feature comparison and negative-control policy. This intentionally narrows the previous anchor-only membership rule. Duplicate-ingestion policy remains O10.

## O09a design status

The pre-implementation review is complete. The dated `logit-standardized-v2` decision below and the Phase C correction specify canonical factor/row ordering, common predictive contrasts, rank refusal, naming and retained threshold semantics. Implementation and verification remain pending.

## Test-First Plan

- RED: permutation-dependent chain clusters, followed by the weak-reference/shuffled-logit fixture and non-identifiable design.
- Focused: `pnpm test -- --test-concurrency=1 test/unit/learning/patterns.test.ts test/unit/routing/offline-logit.test.ts`.
- Adjacent: learning attribution/generator and offline attribution/report tests identified from imports.
- Delivery: `pnpm workflow:check`, `pnpm gate`; no additional gate introduced. Coordinate full-suite execution with the other active chat.
- Raw output: `.agent_workspace/verification/2026-09-27-o09/`.

## Gates and Handoff

- S0-min, R10/R11, F6, live-provider and production approvals remain open.
- Abort if a supposedly offline change writes live state, or if numerical non-identifiability is concealed as a meaningful zero effect.
- Rollback only this slice's Git commits; never reset the user's source tree.
- Durable evidence: [O09 verification](../../reports/2026-09-27-o09-offline-determinism.md).
- Next action: run pre-change focused tests, implement O09b RED/GREEN, then two-stage review; settle O09a design before its RED/GREEN.

## Closeout

- Verified date: 2026-09-27. Author RED/GREEN and focused/adjacent runs, independent O09a/O09b specification and quality reviews, and coordinator `pnpm build` then `pnpm gate` are recorded in the [verification report](../../reports/2026-09-27-o09-offline-determinism.md).
- Gate on the combined O09/O08b checkout: exit 0; 2907 pass / 0 fail / 18 skip. A prebuild is disclosed because this branch predates the separate holdout clean-tree import fix; integrated main still needs its own applicable gate.
- Compatibility: `logit-standardized-v2` changes report interpretation and interaction names while retaining report fields, options, offline scope and old evidence. Missing-cell predictions may extrapolate and contrasts are descriptive, not causal.
- No human, live-provider, experiment, holdout or production gate is closed. Other O01-O12 packages are not claimed here.
- Next owner: overall reliability integration chat for reviewed-commit integration, GitHub synchronization and later safe worktree cleanup.

## O09a protocol correction decided before implementation

`logit-standardized-v2` is the dated interpretation revision for new logit reports. Preserve the `AttributionReport` shape, estimator tag, option defaults and offline-only boundary; identify this revision in `reason`. Historical reports are not rewritten or retroactively interpreted as v2.

1. Sort exact string scenario/model/project levels by code-unit order; last level is the canonical treatment reference. Sort a copied row array by scenario, model, project, then binary outcome before fitting and seeded resampling. Time is not a covariate. Use exact tuple identities and structured factor metadata, never delimiter parsing for model/project relationships. V2 interaction report names are `w:` followed by a JSON `[model, project]` tuple; this intentionally replaces ambiguous pipe-joined names. Other factor name prefixes remain unchanged.
2. Keep intercept and nonreference main columns. Include an interaction column only for a nonreference model/nonreference project pair with the existing `n >= 3` support; absent columns impose the same selected model's additive assumption. This removes redundant reference-pair columns. Check unregularized design rank before tiny-ridge fitting, both for the base and bootstrap. Confounded/rank-deficient fits are `uncertain` / `INVALID_ESTIMATE`; ridge must not supply missing identification.
3. Keep every input row and existing `rowsUsed` meaning. There is no new complete-overlap exclusion or universal-cell sample minimum. Let `q_s = n_s/N`, `p_smp = sigmoid(x(s,m,p) beta)` on the full canonical scenario/model/project grid, and `theta_mp = sum_s q_s p_smp`. Define `theta_m = mean_p theta_mp`, `theta_p = mean_m theta_mp`, and `theta = mean_mp theta_mp` with equal weights across model/project levels. Then `u_m = theta_m - theta`, `v_p = theta_p - theta`, `w_mp = theta_mp - theta_m - theta_p + theta` for every level/pair, including references. Scenario effects, if emitted, use the analogous standardized scenario mean minus grand mean. No dropped reference is assigned an artificial zero.
4. These are model-based descriptive predictive contrasts, not causal effects. Predictions for missing cells extrapolate under the selected model. Probability-scale interaction residuals include logistic-link nonlinearity and do not mean the corresponding logit coefficient is nonzero. Fixed labels/rows imply permutation invariance; arbitrary renaming of labels need not preserve a sparsely selected interaction model.
5. Keep the original fitted design, full prediction grid and `q_s` fixed through bootstrap; only sample canonical input rows and refit. Skip single-outcome/rank-deficient/nonfinite draws. Keep the existing 20-successful-draw minimum, 200 draws, seed, quantiles and 50-iteration/tiny-ridge numerical policy. Do not disguise insufficient information with zero intervals.
6. Retain the existing 0.1 effect threshold, 0.55 scenario-quality floor and diagnosis precedence; their new predictive-contrast scale is disclosed, not presented as a pure performance change. Retain the inherited LCB heuristic and zero-containment epsilon rather than introducing an unrequested calibration claim. Determine related interactions from tuple metadata. No live selector or active pointer is touched.

Additional RED acceptance: balanced mixed-outcome full grid yields a negative weak-reference contrast instead of zero; shuffles agree within `1e-10`; perfectly confounded model/project inputs return uncertain; separable existing fixture continues to provide named weak effect; zero/one-outcome and insufficient successful bootstrap remain uncertain. Include delimiter-containing identifiers and input immutability coverage.
