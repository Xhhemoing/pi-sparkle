# ADR-005: Checkpoint F Holdout Evidence — Open Questions for Expert Review

## Status

Open (pending expert input). No implementation of the holdout experiment runs
until these are decided.

## Date

2026-08-14

## Context

Checkpoint F item 1 requires: *"On a sealed held-out set, adaptive routing meets
the approved cost-quality target against R0 under paired isolated evaluation or
a predeclared estimator with valid overlap diagnostics."* All supporting
machinery is in place and test-verified:

- R0 (deterministic static router) — `src/routing/r0.ts:62`
- R1 (posterior LCB adaptive router) — `src/routing/r1.ts:52`
- Paired comparison reports with 95% CIs, raw counts, task-family breakdown,
  and evaluation-card cross-checks — `src/experiments/comparison-report.ts`
  (claim gating: `validateComparisonReport`; default config
  `maxCostIncreaseUsd: 0` at line 76)
- CheckpointStore, episode replay, propensity ledger, and F-2/F-4 tests

The only missing piece is the approved policy threshold ("adaptive routing is
better") and a legitimate held-out data source. Two questions are open.

## Question 1: The cost-quality target

Code currently gates improvement claims (`improve|outperform|better|regret`)
on: non-provisional paired samples (n >= 5), utility-delta 95% CI excluding
zero on the positive side, and **cost-delta 95% CI upper bound <=
`maxCostIncreaseUsd`** (default 0).

Proposed strict target (aligned with code): *utility-delta 95% CI excludes
zero AND cost-delta 95% CI upper bound <= 0*.

Note: the code checks the CI **upper bound**, not the mean. Approving "mean
cost does not increase" would diverge from the implementation (code is
stricter). The approved wording should either match the CI formulation or
explicitly relax the code.

Alternatives if the strict target is too strong for early validation:

- Utility improves, cost-delta CI upper bound <= $0.02 per episode
- Expected-value improvement under an explicit utility-per-dollar weight
  (needs the weight and the utility scale — evaluation cards bound utility
  to [-1, 1])

## Question 2: The holdout data source

Two candidate paths were considered. **The pure test-fixture path is
rejected** (see Reasons): injecting hand-authored utility/cost pairs into
`computeComparisonReport` exercises only the report validator, never runs R0
or R1, and would be self-dealing evidence — I would be "discovering" a result
I authored. "Sealed" is vacuous there because no learning loop exists to
contaminate. Closing the checkpoint on it would violate the plan's own stop
condition (*"a claim of improvement without held-out or comparable later
evidence"*) and ADR-004's rule that only `Outcome-supported` candidates may be
claimed improved.

The recommended path for expert validation:

1. Build the M6-T2 machinery (in progress): three-way train/validation/holdout
   sealed manifests with contamination checks, read-only isolation guards for
   original state/event logs/active resources, and an audited
   seal-and-replace holdout lifecycle.
2. Run a genuine paired experiment: frozen episodes split by the manifest; R1's
   posterior updated from the **train split only**; both R0 and R1 route the
   holdout episodes; a **deterministic outcome simulator** (faux world)
   produces per-arm utility/cost from actual routing decisions; results feed
   `computeComparisonReport`.
3. The report carries provenance (`evidenceClass: "simulation"`). Checkpoint F
   item 1 would then be recorded as *simulation-evidence closed*, with
   real-world confirmation deferred until production episodes accumulate — not
   as an unqualified improvement claim.

Open sub-questions for the expert:

- Is deterministic-simulator evidence acceptable to close item 1 as
  "simulation evidence", or must item 1 stay open until real production
  episodes exist?
- Is the paired-design (both arms route every holdout episode) preferred over
  a predeclared off-policy estimator (propensity machinery already exists in
  `src/routing/propensity.ts`)?
- What sample size and minimum per-family counts make a simulation report
  non-provisional?

## Decision

Deferred to expert input. Until then:

- The experiment runner, outcome simulator, and any improvement claim are
  **frozen** (no code).
- M6-T2 machinery (manifests, isolation, holdout lifecycle) proceeds because
  it is decision-independent and reusable under any of the above answers.
- Checkpoint F item 1 stays unchecked; M6-T3+ stay gated.

## Consequences

- Honest checkpoint state: no unqualified "adaptive routing is better" claim
  exists in code or docs.
- When the expert answers, the remaining work is: wire the sealed holdout
  harness, run the experiment, produce the provenance-tagged report, and
  update the checkpoint wording to match the approved target.
