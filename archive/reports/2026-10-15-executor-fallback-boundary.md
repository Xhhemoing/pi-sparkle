# Executor fallback boundary verification

## Identity

- Task: `TASK-20261015-executor-fallback-boundary`.
- Baseline: main `44db4b1`; source changes uncommitted in the shared audit checkout.
- Date: 2026-10-15 (Asia/Shanghai); Linux, Node 24.19.0.
- Author: runtime audit agent. Independent source review and the combined full
  gate are owned by the coordinating agent; this record does not claim either.
- Plan: [bounded task plan](../superpowers/plans/2026-10-15-executor-fallback-boundary.md).

## Confirmed defects and changes

1. **Non-retryable failures bypassed through fallback.** Faux-provider 401,
   403, 400 and an explicit `do not retry` remedy all invoked a second model.
   Fallback now honors the existing `ProviderFailure.retryable` classification.
2. **Recovered execution retained the primary error.** A 502 primary followed
   by a successful silent fallback emitted `SUCCESS` with `PROVIDER_ERROR`
   and a failure summary. Success/cancellation now clear superseded failure
   attribution; primary and fallback invocation records remain distinct.
3. **All-model failure emitted two execution terminals.** The failure branch
   yielded an `EXECUTION_FINISHED` before `finish()` generated the task result
   and another terminal. One final `finish()` now owns completion emission.
4. **Changing models refreshed the same execution's cost ceiling.** A billed
   primary failure costing $0.50 and fallback tool turn costing $0.60 at a
   different catalog rate made a third provider request despite a $1 ceiling.
   Each model's gate now receives the remaining ceiling after prior known
   priced spend; stopped telemetry combines model ledgers and names the
   original requested ceiling. That reproduction now makes two calls and
   records $1.10 observed spend. This remains an after-turn ceiling, so the
   turn crossing the cap can overshoot it.
5. **Superseded task verdict leaked across models.** A primary reported PASSED,
   then failed on a later provider turn; a silent fallback succeeded. Both
   the primary verdict and fallback's synthesized result escaped as separate
   `TASK_RESULT`s. Final-attempt event release now belongs to the model-chain
   boundary; intermediate failed models discard their buffered verdicts.
   Independent review then found that preserving the final failed model's own
   report could also authorize false success downstream. All failed/cancelled
   executions now suppress buffered reports and synthesize honest terminal
   outcomes; successful transported reports remain unchanged.

All production changes are inside `src/pi-adapter/pi-executor.ts`; regression
coverage is in `test/unit/pi-adapter/executor-fallback.test.ts`. No CLI, public
event union, persisted record shape, routing policy or dependency is changed.

Independent review supplied further counterexamples, all fixed test-first:

- $0.80 minus $0.10 produced a binary floating-point remainder greater than
  the gate's rounded $0.70. Remaining ceilings now subtract at microdollar
  precision; positive sub-microdollar caps remain armed.
- Cancellation during retry backoff exposed the discarded attempt's PASSED
  result. Failed/cancelled executions now suppress buffered task reports.
- Final failed fallback reports, PASSED and FAILED alike, now become
  UNOBSERVED/provider failure rather than claiming trustworthy task results.
  The existing task-failure attribution fixture now supplies an explicit
  successful closing provider response; its earlier implicit provider
  exhaustion was accidental. Both real failure cases have distinct tests.
- Cancellation after a completed verdict had begun publishing could synthesize
  a second result. Settlement now snapshots cancellation/outcome once before
  buffered publication. A cancellation received after this terminal commitment
  cannot retract the committed verdict or create a duplicate.

## Commands and results

| Command | Result | Evidence |
|---|---|---|
| `node --import tsx --test test/unit/pi-adapter/executor-fallback.test.ts` before first fix | **RED**, 1 pass / 7 fail | Auth/unknown/no-retry fallback, stale failure, duplicate execution terminal, shared-budget regression all fail on the baseline. Local log: `.agent_workspace/executor-fallback-audit/red.log`. |
| Same command after first fix | **GREEN**, 8 pass / 0 fail | Restores the first four boundaries. |
| `node --import tsx --test --test-name-pattern='discards a failed primary' test/unit/pi-adapter/executor-fallback.test.ts` before verdict-buffer fix | **RED**, 0 pass / 1 fail | Actual terminal count 2, expected 1. |
| Focused command below after the first implementation | **PASS**, 71 pass / 0 fail / 0 skip | Fallback, retry, cost gate, cancellation, steering, report tool and provider attribution. Local log: `.agent_workspace/executor-fallback-audit/green.log`. |
| Review regressions: exact decimal cap and retry-backoff cancellation | **RED**, 0 pass / 2 fail | Extra provider call and stale SUCCESS result independently reproduced before correction. |
| Review regressions: final failed model PASSED/FAILED reports | **RED**, 0 pass / 2 fail | Terminal task-success/verification claims survived provider failure before correction. |
| Review regression: abort while buffered verdict publishes | **RED**, 0 pass / 1 fail | Actual TASK_RESULT count 2, expected 1. |
| Focused command below on final reviewed-candidate source | **PASS**, 76 pass / 0 fail / 0 skip | Includes all author and review regressions. Local log: `.agent_workspace/executor-fallback-audit/green-final.log`. |
| `pnpm typecheck && pnpm exec eslint src/pi-adapter/pi-executor.ts test/unit/pi-adapter/executor-fallback.test.ts` | **BLOCKED before typecheck** | Environment wrapper attempted dependency install and refused ignored build scripts for `@google/genai`, `esbuild`, `protobufjs`. No policy changes made by this slice. |
| `node node_modules/typescript/bin/tsc --noEmit` | **PASS**, exit 0 | Direct installed TypeScript command. |
| `node node_modules/eslint/bin/eslint.js src/pi-adapter/pi-executor.ts test/unit/pi-adapter/executor-fallback.test.ts` | **PASS**, exit 0 | Direct installed ESLint command. |
| Direct TypeScript and focused ESLint rerun including provider-attribution and supervisor files | **PASS**, exit 0 | Final source checked after review corrections; subsequent supervisor-only removal of unsupported skip allowance also passes focused tests. |
| Combined repository `pnpm gate` | **NOT RUN by this agent** | Coordinating agent owns the integrated gate and environment reconciliation. |

Focused command:

```sh
node --import tsx --test \
  test/unit/pi-adapter/executor-fallback.test.ts \
  test/unit/pi-adapter/executor-retry.test.ts \
  test/unit/pi-adapter/cost-gate.test.ts \
  test/unit/pi-adapter/cost-gate-ledger.test.ts \
  test/unit/pi-adapter/executor-abort.test.ts \
  test/unit/pi-adapter/steer-inflight.test.ts \
  test/unit/pi-adapter/report-task-result.test.ts \
  test/unit/pi-adapter/provider-failure-attribution.test.ts
```

## Limits and handoff

- Missing usage or catalog prices remain explicitly unaccounted. Unpriced
  models still disclose a disarmed gate. A mixed-priced stopped ledger does
  not invent an aggregate dollar amount; known priced spend still constrains
  subsequent priced calls.
- This is one `execute()` call's budget, not a root/child/resume spend ledger,
  a provider billing reconciliation, or a pre-request reservation system.
- No paid/live-provider request, holdout/F6, production apply, adaptive
  activation, new credential use or dependency upgrade was performed.
- Final source requires independent review and the combined gate. Future
  changes to model-chain control flow should retain the transcript and spend
  regressions rather than checking only final `SUCCESS` and invocation counts.

## Other runtime findings for a separate slice

The following were independently reproduced through `startSupervisedRun` with a
valid fake child; no supervisor code is changed by this fallback slice. They
were then addressed under the separately authorized [supervisor slice](2026-10-15-supervisor-verdict-boundary.md).

- **P1: rejected judge decision can complete the task.** The REJECTED branch
  in `src/run/supervisor.ts` feeds the child's SUCCESS into `applyTaskOutcome`.
  A custom judge returning REJECTED therefore produces the durable sequence
  `JUDGE_DECISION(REJECTED)` → task COMPLETED → run COMPLETED. The judge's
  rejection must determine retry/failure even when the child's self-report is
  successful. Regression: one task, fake SUCCESS/PASSED child, rejecting judge;
  assert no COMPLETED task/run and the configured attempt budget is respected.
- **P2: final allowed round cannot complete the run.** Completion is detected
  only at the beginning of the following round. One valid task with
  `maxRounds=1` reaches APPROVED and task COMPLETED, then records RUN_FAILED
  `maxRounds (1) exhausted without completion`. The loop should settle a fully
  completed graph immediately after its final round, before exhaustion failure.

Architecturally, these show why worker outcome, independent verdict, scheduling
attempt, model retry and run settlement must retain separate ownership. Pi's
adapter boundary and durable event contracts are useful existing seams; fixes
can strengthen these seams without replacing the runtime or agent kernel.
