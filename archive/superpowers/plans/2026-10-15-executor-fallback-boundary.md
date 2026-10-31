# Executor fallback boundary correction

## Identity

- ID: `TASK-20261015-executor-fallback-boundary`
- Owner: runtime audit agent; integration owned by root agent.
- State: `ready-for-review`
- Baseline: main `44db4b1`; opened 2026-10-15 (Asia/Shanghai).
- Contracts: ADR-001; `PiExecutorOptions.fallbackModels` retryable-only contract;
  `AgentExecutionRequest.maxCostUsd` per-execution ceiling; status-matrix executor fallback row.

## Problem and scope

The model fallback loop disregards non-retryable failure classification and keeps
the failed primary's provider error after a successful fallback. It also builds a
fresh full cost ceiling for every model in one execution. These boundaries must
remain valid when more than one model is attempted.

In scope: executor fallback decision, terminal attribution, carried observed spend,
and deterministic offline faux-provider regressions. Out of scope: routing consent,
root/child/run aggregate budgets, live providers, production/holdout acceptance,
supervisor behavior, and changes to frozen CLI/event schemas.

## Acceptance criteria

- [x] Auth/unknown/explicit no-retry failures never invoke fallback models.
- [x] A retryable failure may fall back; successful fallback has no stale failure.
- [x] Exactly one execution terminal follows its task result when the chain fails.
- [x] A failed model's buffered task verdict cannot leak into any terminal
  transcript; cancellation also suppresses prior task-success claims.
- [x] Known priced spend from all prior attempted models reduces the same
  execution's remaining ceiling; each model retains its own catalog price.
- [x] Cancellation, missing models, no-cap and unpriced-model behavior remain
  covered without claiming complete billing or hard pre-request reservations.

Author verification for these criteria: 2026-10-15 final focused 76/76, direct
TypeScript and ESLint pass. [Exact evidence and limits](../../reports/2026-10-15-executor-fallback-boundary.md).
Independent review and the combined repository gate remain separate.

Independent review requested changes on 2026-10-15: decimal subtraction admitted
an extra call at an exact $0.80 ceiling; abort during retry backoff retained a
failed attempt's PASSED verdict; final failed-model reports could similarly be
accepted by the child coordinator. Add RED regressions, use the cost ledger's
microdollar precision, and suppress verdicts from failed/cancelled executions.
The existing provider-attribution test supplied only a FAILED report with no
successful closing response, accidentally causing provider exhaustion; correct
that fixture to explicitly finish successfully while adding a separate genuine
provider-failure-after-report assertion. No requirement promises acceptance of a
failed transport's report, and no frozen DTO change is needed.

## Implementation slice and verification

Files: `src/pi-adapter/pi-executor.ts`,
`test/unit/pi-adapter/executor-fallback.test.ts`, this plan, and the matching
`docs/reports/2026-10-15-executor-fallback-boundary.md` report.
The independent-review correction also clarifies the completed-transport fixture
in `test/unit/pi-adapter/provider-failure-attribution.test.ts`.

First add regression assertions and run
`node --import tsx --test test/unit/pi-adapter/executor-fallback.test.ts` to obtain
RED evidence. Then apply the smallest correction and rerun fallback plus existing
retry/cost-gate/steer tests; run typecheck and lint. Root runs the combined full
gate and reviews the final integrated source independently.

## Gates and handoff

No live provider/network or production behavior is authorized by this slice.
Stop if a fix needs a frozen DTO change or another owner's files. No changes to
shared active task/status files or commits from this agent. Record exact output,
remaining billing limits, and review status in the dated report.
