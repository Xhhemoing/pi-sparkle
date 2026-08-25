[Model: gpt-5.6-sol]

# Loop 4 · Round 11 — R11-8 flowchart `applyRetry` absence pin

## Outcome

Appended one AST guard to
`test/unit/run/flowchart-applyretry-absence.test.ts`. It requires R11-4's
restore-side discard-audit validation to remain in either
`applyClearingEvent` or its caller `restoreCheckpointedSupervisor`, then
reapplies the unchanged whole-file `assertNoSchedulerRetry` check to
`flowchart-run.ts`.

The R8-3 whole-file pin, its two mutation cases, and R10-8's marker-gated pin
over both flowchart sources are unchanged. The owned test diff is additive:
38 insertions, 0 deletions.

## Census first

- Verified the owned test path existed before editing.
- `src/run/scheduler.ts` still defines `applyRetry`;
  `src/run/supervisor.ts` contains its only production import and call.
- `src/run/flowchart-run.ts` and
  `src/supervisor/flowchart-supervisor.ts` both retain discard/reopen AST
  markers and contain no `applyRetry` or `scheduler.js` reference.
- Before R11-4's concurrent edit, the new fourth assertion failed only because
  neither restore consumer called `assertDiscardAuditMatchesLog`; the inherited
  three assertions passed. This demonstrates the new pin is not vacuous.
- Final consumer census finds the existing producer-side call in
  `discardAuthorization` and the new restore-side call in
  `applyClearingEvent`.

## Verification

- Owned test, three consecutive cumulative-tree runs: each **4 pass, 0 fail,
  0 skipped**.
- Scoped ESLint:
  `pnpm exec eslint test/unit/run/flowchart-applyretry-absence.test.ts` —
  **pass**.
- Whole-tree `pnpm exec tsc --noEmit` — **pass**.
- Owned-test `git diff --check` — **pass**.
- Scheduler source and both scheduler-focused tests are diff-empty.
- No full gate was run. The test command emitted the existing Node engine
  warning (`22.14.0`; package requests `>=22.19.0`).

## Scope

Owned changes are limited to the additive test assertion and this report. No
`src/**`, scheduler file, dependency, skip, scratch file, branch, commit, or
push change was made.
