# Exploratory A/B/C pilot preregistration (draft)

## Status and gate

- State: `draft — no live calls authorized`
- Verdict: **REQUEST CHANGES** from fresh-context same-model review; this is
  not independent review and not an approval.
- Owner: pending owner budget/data-transfer approval, Stage 0 boundary review,
  and evaluator freeze.
- Dependencies: projection hardening, read-only evaluator freeze, and the
  pre-pilot evaluator/apply boundary design review/freeze.
- Related: [A/B/C pilot plan](../superpowers/plans/2026-09-21-ab-c-pilot.md),
  [read-only evaluator manifest](../superpowers/specs/2026-09-21-readonly-evaluator-manifest.md),
  [measurement specification](../superpowers/specs/2026-09-21-projection-measurement.md),
  [Stage 0 draft](../superpowers/specs/2026-09-21-evaluator-boundary-freeze.md)
- This document is a proposed protocol, not an experiment result.

## Objective and arm manifests

Primary contrast: **B versus C**, the marginal effect of enabling native
observation projection under an otherwise frozen common tuple. Secondary
contrast: **A versus B**, a system-level difference, not a pure projection
contrast.

- **A:** native Pi single-agent baseline; sparkle learned routing disabled.
  Freeze A's actual runtime identity, auth-resolution identity, and tool schema
  independently before live collection.
- **B:** pi-sparkle with the common frozen routing tuple and projection off.
- **C:** the same B common tuple with projection on and the explicitly declared
  `sparkle_recall_observation` schema difference.

Common evaluator/task/repository constraints are shared. Tool schemas and
runtime identities are arm-scoped and may differ. A's source-bound native
configuration is a separate `PiAgentExecutor` using host-resolved auth, only
`sparkle_read_file` from the native coding-tool set, and no recall tool unless
projection is supplied; this must be frozen independently. Every arm has its
own `armManifestDigest`; every ledger/result row records that digest and the
common manifest digest. A mismatch is declared and blocks the affected
collection; it is not repaired or falsely reported as complete schema identity.

## Population and fixed schedule

- Approximately 30 distinct real development tasks, selected and stratified
  before outcome inspection by broad task class, language/repository size,
  context size, test duration, and arm-independent expected repeat mass.
- Every task appears in A, B, and C; an incomplete block requires prior approval
  and is reported.
- Exactly two scheduled runs per task per arm (`K=2`). No outcome-driven extra
  run, replacement, or favorable-arm rerun is allowed.
- The task attempt field is frozen as `taskAttemptsPerScheduledRun=1` before
  collection. This documentation-only change does not implement enforcement;
  an observed mismatch is `INVALID_COLLECTION` and blocks collection.
- The existing provider executor's `maxAttempts=3` is recorded as a local upper
  bound per `PiAgentExecutor.execute()` execution, including the first attempt.
  It is not exactly three API calls and not a global budget across children or
  tool turns. It applies only where that executor retry policy is in use, and
  all observed retries/cost remain inside the scheduled-run row.
- Arm and repeat order are randomized and recorded. Repository revision,
  evaluator, budget, retention, and data-transfer constraints are frozen.

## Primary estimand

```text
costPerAcceptedTaskBundle(arm) =
  sum(providerCost + runtimeCost for K scheduled runs and applicable
      provider-executor retries)
  /
  count(distinct tasks with >=1 valid independently accepted run
          without human correction)
```

Zero accepted tasks makes the arm KPI undefined and blocks a claim. Secondary
metrics are cost per accepted run, independent acceptance rate, correction
minutes, wall time, applicable retry/failed-attempt counts, repeat mass,
integrity incidents, and an all-in human-time sensitivity. Missing usage is
unknown, not zero.

## Run states and missingness

Each scheduled run is one of:

- `ASSIGNED_NOT_STARTED`
- `STARTED_PROVIDER_FAILURE`
- `RUNTIME_FAILURE`
- `EVALUATOR_FAILURE`
- `VALID_COMPLETED_ACCEPTED`
- `VALID_COMPLETED_REJECTED`
- `CANCELLED`
- `INVALID_COLLECTION`

Provider, authentication, quota, timeout, and runtime failures contribute all
observed cost and zero operational acceptance. Evaluator/manifest/identity
failures are `INVALID_COLLECTION`, not model failures; cost and reason remain in
the ledger. Assigned-not-started and cancelled rows remain. No task/run is
replaced or excluded after outcome inspection. A reserve task can replace only
a predeclared invalid collection before outcome inspection, while the original
remains.

If a required provider/runtime cost component is unknown, the arm's primary
point estimate is `UNKNOWN_COST`; report a known-cost lower bound separately and
never impute zero. Invalid collection handling follows the frozen incomplete-
block rule and is always reported.

## Analysis and decision rules (draft)

- Task is the resampling unit; repository is an additional cluster.
- Use paired task bootstrap or a preregistered hierarchical estimator; repeats
  are not independent tasks.
- No efficacy peeking unless a sequential rule is frozen in advance. A critical
  integrity incident is an immediate safety stop.
- Exact quality, advance, MDE, interval, unknown-cost, and stopping rules must
  replace any provisional language before the first live call and before outcome
  inspection. Non-significance is never proof of no degradation.
- The pilot cannot establish non-inferiority, F6/F-PROD closure, live adaptive
  benefit, production readiness, or broad Outcome-supported benefit.

## Data handling and approval checklist

The manifest records provider, model, task/repo revisions, arm/runtime/tool/
routing identities, policy and evaluator digests, boundary design digest,
environment, budget, retry scope, retention, and data-transfer policy. Every
usage row records known tokens/cost, unknown status, runtime cost, applicable
retry/failed-attempt counts, wall time, and evidence class. Raw ledgers remain
under the approved privacy class.

- [ ] Stage 0 design independently reviewed and owner-approved; record binds
  `boundaryDesignDigest` without circular digest inputs.
- [ ] Read-only evaluator manifest frozen and mutation-tested.
- [ ] Projection/measurement implementation gate passed.
- [ ] Task and confirmation set digests frozen.
- [ ] A native configuration frozen independently; B/C common tuple and C's
  declared recall-tool difference recorded.
- [ ] Provider/model/version, budget, data-transfer, retention, and environment
  approved.
- [ ] Exact thresholds, estimator, K=2 schedule, task attempt field,
  provider-executor retry upper-bound scope, missingness, exclusions, and stop
  rules approved before any outcome is inspected.
- [ ] Independent reviewer identity/verdict and owner authorization recorded.

No checklist item is satisfied by this author-run documentation pass. A future
live run requires an exact approved evidence record and no product/config
mutation is authorized by this draft.
