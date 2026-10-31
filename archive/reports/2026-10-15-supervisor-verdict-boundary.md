# Supervisor verdict and final-round verification

- Task: `TASK-20261015-supervisor-verdict-boundary`.
- Baseline: main `44db4b1`; candidate source uncommitted in the shared checkout.
- Date/environment: 2026-10-15 Asia/Shanghai; Linux, Node 24.19.0.
- Author: runtime audit agent; coordinating agent owns full gate/integration.
- [Plan](../superpowers/plans/2026-10-15-supervisor-verdict-boundary.md).

## Behavior

The REJECTED judge branch previously mapped the child's SUCCESS/PARTIAL to a
completed scheduler outcome. A valid fake SUCCESS/PASSED child plus a custom
rejecting judge recorded `JUDGE_DECISION(REJECTED)` followed by task/run
COMPLETED. `rejectedTaskOutcome` now maps these claims to FAILURE, using the
existing retry/attempt state machine; dependants remain blocked until approval.

The loop also required another round to observe a completed graph. A one-task
run with `maxRounds=1` recorded task COMPLETED then RUN_FAILED. The post-loop
settlement now checks whether every task is COMPLETED before recording round
exhaustion. This adds no round, new status, skip behavior or public event shape.

## Verification

| Command | Outcome |
|---|---|
| `node --import tsx --test test/integration/m2/supervisor-verdict-boundary.test.ts` before fixes | **RED**, 1 pass / 5 fail. Rejection bypassed; final single/parallel/sequential rounds failed. |
| Same command after fixes | **PASS**, 6 pass / 0 fail. Unfinished dependent graph still fails on round exhaustion. |
| Focused command below, first run | 51 pass / 1 fail. Existing scheduler source pin refused new SKIPPED literal; final predicate narrowed to existing COMPLETED-only semantics. |
| Focused command below, final source | **PASS**, 52 pass / 0 fail / 0 skip. |
| `node node_modules/typescript/bin/tsc --noEmit` | **PASS**, exit 0. |
| `node node_modules/eslint/bin/eslint.js src/pi-adapter/pi-executor.ts src/run/supervisor.ts test/unit/pi-adapter/executor-fallback.test.ts test/unit/pi-adapter/provider-failure-attribution.test.ts test/integration/m2/supervisor-verdict-boundary.test.ts` | **PASS**, exit 0. |
| Combined repository gate | Owned by coordinating agent; not claimed by this report. |

```sh
node --import tsx --test \
  test/integration/m2/supervisor-verdict-boundary.test.ts \
  test/integration/m2/supervisor.test.ts \
  test/integration/m2/supervisor-crash.test.ts \
  test/integration/m2/supervised-lifecycle-lock.test.ts \
  test/unit/graph/judge.test.ts \
  test/unit/run/scheduler.test.ts
```

Final local output: `.agent_workspace/executor-fallback-audit/supervisor-green.log`.
The source pin's initial failure is retained above, not counted as a pass.
Independent final source review by the baseline agent returned **PASS**, with
38/38 targeted checks through the corrected test runner (new/existing/crash
supervisor, scheduler and dead-branch). Exact reviewed patch and output are
`.agent_workspace/architecture-20261015/supervisor-reviewed.patch` and
`.agent_workspace/architecture-20261015/supervisor-independent-review-final.log`.
The coordinating report owns exact integrated-source/full-gate evidence.

## Limits

The slice does not introduce independent checks into a caller's custom judge,
alter transport failure attribution, redesign retry accounting, activate
adaptive planning, or enforce root/child aggregate budgets. It ensures a
provided rejecting judge is actually authoritative and a completed final round
settles honestly. Public terminal states and persisted event payloads are
unchanged. No live provider or production operation was performed.
