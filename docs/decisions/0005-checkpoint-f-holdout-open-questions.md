# ADR-005: Checkpoint F Holdout Evidence

## Status

Accepted (2026-08-19). Expert decisions are locked in
[model-routing-final-plan.md](../research/model-routing-final-plan.md) §1.

## Date

2026-08-14 (questions) / 2026-08-19 (decision)

## Context

Checkpoint F item 1 requires: *"On a sealed held-out set, adaptive routing meets
the approved cost-quality target against R0 under paired isolated evaluation or
a predeclared estimator with valid overlap diagnostics."*

R0 and R1 library machinery exists. Live routing stays R0-equivalent until this
checkpoint closes on **production** evidence. Simulation cannot impersonate that
close.

## Protocol (2026-08-18 three-line final)

Simulation, replay, and offline attribution reports are `evidenceClass: simulation`
or `replay`. They do **not** equal production improvement and must not be
written as Outcome-supported. Checkpoint F item 1 stays open until the
cost-quality target (Q1) and holdout data source (Q2) are answered.
Primary endpoint for any later claim is pre-registered `taskSuccess`
(or an explicit multi-objective utility), never tracking `score`.
Cost comparisons use the CI **upper bound**, not the mean.
## Decision

1. **Primary gate (F-PROD item 1).** Paired utility-delta 95% CI **lower bound
   > 0**, and cost-delta 95% CI **upper bound ≤ 0**. A $+0.02/episode cost
   allowance may be reported as a separate quality-for-cost frontier. It must
   not close the same-cost improvement gate.

2. **Simulation.** Deterministic-simulator evidence may close an independent
   **F-SIM** item with `evidenceClass: "simulation"`. It must not close F-PROD
   item 1. `simulation ≠ production improvement`.

3. **Estimator and sample size.** Sealed paired evaluation is primary. OPE is
   supplementary and is `INVALID_ESTIMATE` without overlap/ESS. Claim sample
   size uses a pre-registered MDE:
   `n >= ((1.96 + 0.84) * sd(delta) / MDE)^2`. Without a pilot, conservative
   start gates are 100 episodes total and 30 per family that is claimed
   separately. Shortfalls are `provisional`. Code `n >= 5` is a unit smoke
   test only.

4. **Public prior in R0.** A frozen snapshot may rank live R0 while R1 stays
   shadow, but only after unified hard filters, a full provenance hash, a
   two-point min-max fix, pinned model versions, and an explicit CLI snapshot
   path. Routing must never HTTP-fetch leaderboards.

5. **Tracking score.** Never enters avoid lists, bandit reward, or R1.
   Persistence and `extraSignals` must fail closed if a caller forges
   `criterion: taskSuccess`.

6. **Cascade positive evidence.** A cheap tier may be retained only on
   deterministic tests, compile, schema, or explicit acceptance PASS. An
   independent critic may lower confidence, escalate, or ABSTAIN; it cannot
   alone prove PASS. Model self-report weight is 0. No deterministic check
   means ABSTAIN, then the approved conservative model or a human gate.

Until F-PROD item 1 closes and CAS promotion is approved, live execution must
not import R1, bandit, or shadow routers.

## Consequences

- No unqualified "adaptive routing is better" claim exists until F-PROD item 1
  closes on production paired outcomes.
- Propensity logs record the full behavior distribution. A deterministic live
  policy is one-hot (selected = 1, other eligible = 0). Fabricating strictly
  positive probabilities to pass overlap checks is forbidden.
- Importance-weighted ESS (π/μ) is required for OPE; raw propensity squares
  are not.

## Enforcement status (2026-08-24 audit — informative, decision unchanged)

The import ban above is enforced by
`test/unit/routing/live-isolation.test.ts`. As of the Round 2 working tree
(2026-08-24) that test builds the **transitive import closure** from the four
live entry points and judges reachability, superseding the earlier version
that only scanned the literal source text of a fixed ten-file list. The
transitive import-closure audit
(see `docs/reports/2026-08-24-sota-isolation-privacy.md`, re-verified in
`docs/reports/2026-08-24-sota-r2-isolation.md`) found:

- No live entry point (`src/cli/main.ts`, `src/run/flowchart-run.ts`,
  `src/track/loop.ts`, `src/run/supervisor.ts`) reaches `routing/r1.ts`,
  `routing/shadow.ts`, `routing/r1-shadow-report.ts`,
  `experiments/shadow-compare.ts`, or `experiments/simulation-holdout.ts`.
  The selection ban holds.
- `routing/bandit.ts` **is** transitively loaded by the live track path, but
  only via `learning/bandit-store.ts`'s post-run reward bookkeeping
  (`createBanditState` / `recordReward`). The selector `selectArm` has no
  caller outside `routing/shadow.ts` (unreachable from live entry points),
  and no live module reads `bandit.json`.
- `routing/topology.ts` is imported at module level by `run/supervisor.ts`
  for the parked `planTaskTopology`, which the run loop does not call (pinned
  by the isolation test). Topology is not named in this ADR's import ban; the
  status-matrix phrase "must not import into live execution" is broader than
  both this ADR and the code.

Round 2 update (2026-08-24): the queued hardening shipped. The test now walks
the module graph transitively, forbids the R1/shadow/holdout modules anywhere
in the live closure, and pins the two reachable learned-routing modules
(bandit via `learning/bandit-store.ts`, topology via `run/supervisor.ts`) to
their exact importers, with symbol-level guards that `selectArm`,
`loadProjectBandit`, and `planTaskTopology` gain no live caller.
