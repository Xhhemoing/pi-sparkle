# M0-A: nested recipe ownership and unresolved cleanup

## Identity

- ID: `TASK-20261016-process-ownership`
- Owner: Codex (implementation and self-review; no independent-review claim).
- State: `ready-for-review` (author verified; source publication blocked).
- Opened: 2026-10-16.
- Baseline: PR #60 `415b072b8be18818be84e87489d00d7d44826bce`; main and PR #61 remain separate.
- Authority: ADR-009, architecture-migration M0 / algorithm A10, active status-matrix P0.

## Problem and scope

The outer independent checker and its recipe runner both create detached POSIX
groups. Cancelling the outer checker can leave the actual recipe writing after
the controller has recorded a completed effect. A cleanup deadline also bounds
handles without proving effect settlement.

This slice makes the CLI recipe aggregator join its outer checker group, makes
the group owner clean up residual descendants even after a normal leader exit,
and carries unresolved cleanup through native-write and development ownership.
Standalone command execution remains isolated by default. The inherited mode is
host-internal, never a model-selected permission. No new scheduler or database.

This is bounded M0 progress, not acceptance of all M0. Arbitrary subprocesses
which deliberately detach with ignored stdio are not an OS sandbox. Windows
stopped-process tree containment and parent-crash containment remain separate;
unknown effects retain their claim/action rather than being declared stopped.
No Pi upgrade, live model call, source apply, PR merge, or release is in scope.

## Acceptance criteria

- [x] Real DevelopmentController -> NativeWriteSession -> independent check ->
  recipe chain: explicit abort/repeated abort and deadline leave no subsequent
  fixture writes (including a TERM-ignoring inherited descendant).
- [x] Successful ordinary checks and configured recipe limits preserve their
  results; leftover descendants cannot turn a leader's exit 0 into acceptance.
- [x] An escaped process holding pipes yields explicit unresolved cleanup;
  native attempts stop, action stays needs-reconciliation, task claim remains
  running, accept fails, release/restart cannot replay the unknown effect.
- [x] Source prerequisite-check worktrees are retained when cleanup is unknown.
- [x] Parent crash leaves durable running/uncertain action and no automatic replay.
- [x] Focused tests, typecheck/lint/full gate and relevant probes have dated output;
  platform skips and remaining M0 conditions are explicit.

## Implementation slice

| File / symbols | Change | Risk / verification |
|---|---|---|
| execution/command-runner | host-internal inherited group option; residual group cleanup; explicit unsettled marker | real processes; existing status meanings retained |
| development/recipe-check | entry-point recipes inherit the outer group | default library calls remain isolated |
| execution/independent-check | refuse snapshots / authority after unresolved cleanup | typed error with bounded process evidence |
| native/write-session | retain unsettled failure evidence and stop all repair | optional result field; historical records unchanged |
| development/controller | uncertain action and retained claim/view | no completion or replay grant |
| tests + CI focused list | cancellation, deadline, residue, uncertainty, crash | Linux and Windows evidence distinguished |
| active tasks/status/report | reconcile scoped evidence and remaining M0 | no production/outcome closure |

## Test-first plan and gates

First add real-process regressions to the development chain and runner; run on
the unchanged baseline and retain RED output under `.agent_workspace/m0-settlement/`.
Then implement in small steps and run focused runner, development cancellation,
recipe limits and native repair/check tests. Run the actual pinned-pnpm `gate`
serially using the established one-CPU affinity, plus security/Pi/kernel probes.
Inspect the final diff and the cancellation/uncertainty paths separately.

Abort delivery if a cancellation test leaves an untracked live fixture or if
uncertain effects can become accepted, disposed, or replayed. Fixtures have
self-exit deadlines and `finally` cleanup. Rollback means disabling affected
new dispatch while retaining candidates, claims and receipts, never discarding
unknown effects. Durable closeout goes in the dated report and active tasks.

## Closeout

Linux author acceptance criteria passed. Actual pinned full gate: 3594 pass /
0 fail / 2 skip plus build; security 26, Pi 4 and kernel 3 probes PASS. Review,
failures, exact source/evidence bounds and platform conditions are in the
[verification record](../../reports/2026-10-16-process-ownership.md). Full M0 is
still open. The non-forced existing-branch push was blocked by automatic
approval review; do not use another endpoint to bypass it. Final local evidence
and a reviewable patch are prepared before requesting explicit publication
authorization.
