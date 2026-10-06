# Native verification cancellation continuation

## Identity

- ID: `TASK-20261002-native-cancellation` (PS-03 / O02 bounded continuation)
- Owner: current implementation agent; independent acceptance remains separate.
- State: in-progress. Opened: 2026-10-02.
- Baseline: main `ab2f11394b46295182ac23185b2c5841c4d7788f`.
- Contracts: ADR-006 source preservation, ADR-008, existing command policy and acceptance records.

## Problem and scope

Verification and coding-tool commands use `spawnSync`, so abort/shutdown cannot run while a command is executing. Apply does not recheck cancellation after verification. Replace these two execution paths with one asynchronous, shell-less runner, propagate signals through closed-loop/write/apply, and wait for managed process cleanup before returning. Preserve accepted-check record fields and command authorization.

Ownership inventory: this checkout has one worktree, no stashes, and no O02 runner draft. The earlier Windows stash `b484c3e2` documented in the September report is not available here and has not been recovered or discarded. This continuation is based only on merged source; future integration of that draft requires reconciliation, never blind restoration. Existing `.tmp/` content is preserved. Commands use this environment's Bash/Node tooling; the earlier Windows PowerShell constraint describes that original environment.

In scope: async command runner, independent check Promise propagation and all callers, coding-command signal, verification cancellation/shutdown, apply refusal before source checkout, focused Linux/Windows CI fixtures. No new host DTO, persisted lifecycle schema, provider runs, production apply, or activation. O03 cross-instance disposal stays behind its existing identity/receipt design boundary.

## Acceptance criteria

- [ ] Pre-aborted commands never spawn; timers progress during execution.
- [ ] Cancellation, timeout, output overflow and spawn error have distinct outcomes. Output storage is bounded per stream; observed byte counts are not represented as full output after termination.
- [ ] Cancellation waits for managed command termination/pipe closure. POSIX process groups and Windows taskkill are used for ordinary inherited child trees; escaped/detached descendants are outside the OS-sandbox guarantee. Cleanup failure refuses acceptance/application.
- [ ] Write verification cancellation/shutdown retains candidate and durable failure evidence with no accepted result.
- [ ] Apply cancellation/shutdown during verification refuses before source staging/checkout, preserving source bytes/index/HEAD and candidate.
- [ ] Existing successful checks, content-drift refusal, command allowlist/environment isolation and source-change protection remain green.
- [ ] Current commands, CI and open gates recorded in tasks/status/report.

## File ownership and test-first plan

Execution owner: `src/execution/command-runner.ts`, `independent-check.ts`, `closed-loop.ts`, `index.ts`; native owner in this serial continuation: `src/native/write-session.ts`, `apply.ts`; adapter: `src/pi-adapter/worktree-coding-tools.ts`. Tests: runner, independent-check, worktree-snapshot, coding-tools, native write/apply. CI: existing focused reliability matrix only. No other current writer is present.

First RED: command-tool abort timer must prevent a delayed marker; native apply abort timer must preserve source; native write abort while verifying must return CANCELLED, not accepted. Then implement the runner and run these exact regressions, followed by adjacent suites.

## Verification and handoff

Focused: `pnpm test -- --test-concurrency=1 test/unit/execution/command-runner.test.ts test/unit/execution/independent-check.test.ts test/unit/execution/worktree-snapshot.test.ts test/unit/pi-adapter/worktree-coding-tools.test.ts test/integration/native/write-session.test.ts test/unit/native/apply.test.ts test/integration/native/apply.test.ts`.

Delivery: `pnpm prerelease`, `pnpm kernel-reuse:probe`, existing hosted quality/Linux/Windows jobs. Independent review is not inferred from self-review or CI. Provider/holdout/S0-min/R10/R11/production authorization remain unchanged. Release publication remains unperformed because no GitHub Release exists and the available connector cannot create one; the previous secure login request was declined. Do not retry credentials without a new user request.

Abort: any source data loss, unbounded output buffering or false successful cleanup stops delivery. Rollback only this source change, never a user workspace reset. Closeout evidence: `docs/reports/2026-10-02-native-cancellation.md`.
