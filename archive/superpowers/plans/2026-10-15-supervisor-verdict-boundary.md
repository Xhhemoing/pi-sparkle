# Supervisor verdict and terminal settlement correction

## Identity

- ID: `TASK-20261015-supervisor-verdict-boundary`
- Owner: runtime audit agent; integration/review owned by coordinating agent.
- State: `ready-for-review`; opened 2026-10-15 (Asia/Shanghai), baseline `44db4b1`.
- Related contract: accepted M2 deterministic judge/scheduler/state-machine
  design; status-matrix event log and supervisor runtime rows.

## Scope

Fix two observed contradictions: a judge REJECTED verdict can record a
self-reported-successful task as COMPLETED, and a graph completed during its
last allowed round records RUN_FAILED because completion detection needs another
round. Preserve public events/statuses, retry budgets, cancellation and stalls.
No provider, adaptive, production, run-budget or workflow redesign is included.

## Acceptance and test-first plan

- [x] A REJECTED successful child retries/fails under the task attempt budget;
  it never unlocks dependants or creates COMPLETED without approval.
- [x] The graph completes when all tasks finish on the final allowed round,
  including sequential dependencies and parallel final tasks.
- [x] A graph with remaining work still fails on round exhaustion.

Author verification: 2026-10-15 RED 1/5 then GREEN 6/0; final adjacent suite
52/52; direct TypeScript/focused ESLint pass.
[Exact commands, initial source-pin correction and limits](../../reports/2026-10-15-supervisor-verdict-boundary.md).

Write RED regressions in
`test/integration/m2/supervisor-verdict-boundary.test.ts`; fix only
`src/run/supervisor.ts`; run that file plus supervisor/crash/lifecycle and graph
judge/scheduler tests, direct TypeScript and focused lint. Root owns combined
full `pnpm gate`, independent review, active task/status reconciliation and commit.
Rollback/abort if correction requires a public status/event change. Record exact
commands and open limits in the matching dated report.
