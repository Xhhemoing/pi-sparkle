# Generic command-tool uncertainty

## Identity
- ID: TASK-20261019-command-uncertainty / BF-20261019-command-uncertainty
- Owner: Codex; state: ready-for-review (full merge gate remains open); opened: 2026-10-19.
- Baseline: PR #60 branch fetched at 2ec715a5cf0c43333710ebb7050fe7278d62be8f; ADR-009 and M0-A/M0-B. Existing main and dirty personal-team worktree preserved.

## Problem and scope
The generic tool drops cleanupUnsettled into an ordinary error. Worker error handling can then report success; NativeWriteSession has no independent command uncertainty receipt and controller can complete the candidate-write action and release its claim.
In scope: generic tool typed error and synchronous host notification; native factory host callback with sticky per-attempt uncertainty; existing failure artifact/effectsSettled/controller fencing. No default command authorization, new ledger/schema/hash/baseline/gate, process backend, OS containment, publication or merge.

## Acceptance criteria
- Real timed-out command notifies the host and throws CommandCleanupIncompleteError before returning; per-call abort is honored.
- Even when a worker catches that error and reports success, native skips verification/repair, preserves candidate, records effectsSettled=false; controller retains uncertain ledger and running claim across restart and refuses overlapping work.
- Ordinary nonzero exit, policy denial and pre-spawn cancellation do not falsely report unresolved effects. Later successful commands cannot clear an earlier uncertainty receipt.
- Focused RED/GREEN, neighboring tests, pnpm gate, security:probe and pi:probe recorded; workflow:check passes.

## Implementation slice
- src/pi-adapter/worktree-coding-tools.ts: host notification, typed cleanup error, per-call signal.
- src/native/write-session.ts: factory callback and sticky receipt before acceptance/cancellation branches.
- test/unit/pi-adapter/worktree-coding-tools.test.ts; test/integration/development/controller-admission.test.ts: real commands and persistent ownership.
- tasks/{plan,todo,migration-todo}.md; docs/status-matrix.md; dated verification.

## Test-first and handoff
Run pnpm test test/unit/pi-adapter/worktree-coding-tools.test.ts test/integration/development/controller-admission.test.ts RED then GREEN. Expand to native/development/execution adjacent suites and applicable existing gate/probes. No paid/live/crash/benchmark/holdout runs. No independent review or human acceptance claimed. Host factories opting into generic commands must wire the host callback from NativeWriteExecutorFactoryInput to WorktreeCodingToolsContext; arbitrary external executors remain trusted host responsibility. Abort on conflicting contract. Rollback: revert only this task diff, after reconciling unknown effects; never replay/delete unknown rows. No commit/snapshot requested or made.

## Closeout (2026-10-19)
- Final focused 23/23; final typecheck and changed-file lint pass; build, security 26 and Pi 4 pass.
- Full gate: 3695 total / 3645 pass / 2 fail / 48 skip. Both failures are unchanged batch deadline assertions; standalone serial file rerun passes 3/3. Initial stale-fixture failures retained, not counted as current product failures.
- [Verification and host wiring](../../reports/2026-10-19-command-uncertainty.md). Maintainer owns clean full gate under isolated load and independent review before merge; no human acceptance, publication or all-M0 closure.
