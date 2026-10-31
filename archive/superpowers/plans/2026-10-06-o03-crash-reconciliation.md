# Task Plan: O03 crash-window receipt reconciliation

Task ID: `TASK-20261006-o03-crash-reconciliation`

## Problem

`disposeIssuedCandidate` persists the run-scoped disposal receipt only after a
successful Git worktree removal. A crash in that window leaves the candidate
path absent. The next disposal call reconstructs the receipt identity, then
fails because the candidate path no longer exists, so the already-completed
removal cannot be acknowledged and the receipt cannot be written.

A measured Git 2.51 Windows probe showed that successful
`git worktree remove --force` removes both the candidate path and its exact
administrative worktree record. Therefore the common crash-window state is not
a prunable listing entry; receipt reconciliation must be bounded by the durable
issued authorization instead.

## Scope

- Add a focused integration regression for
  `issue -> apply -> git worktree remove --force -> retry dispose`.
- When the exact authorized candidate path is absent and Git has no record for
  that exact path, return `DISPOSED` so the normal durable receipt is written.
- Retain a narrow repair path for a prunable stale registration if one is
  present: prune it, verify the exact record disappeared, and return
  `DISPOSED` for receipt persistence.
- Preserve source-identity and issued candidate-identity checks before the
  missing-path branch.
- Preserve all existing refusals for live replacements, foreign paths, tracked
  or untracked changes, ignored files, locks, and failed Git removals. Never
  recursively delete a live path.

## Acceptance criteria

1. Before the fix, the new test fails because the crash-window retry rejects
   the missing candidate path.
2. After the fix, the crash-window retry returns `DISPOSED`, persists a
   disposal receipt, reports no exact worktree registration, and a repeated
   call remains `DISPOSED`.
3. Existing replacement, mutation, lock, foreign-identity, and failed-removal
   refusal behavior remains covered and passing.
4. Focused native/apply/registration suites, typecheck, focused lint, and
   `git diff --check` pass. `pnpm workflow:check` passes for the updated
   records.

## Files and symbols

- `src/native/apply.ts`: `NativeApplySession.disposeAuthorized` gains a bounded
  missing-path reconciliation branch; helper `exactWorktreeRecord` reads the
  exact porcelain worktree record.
- `test/integration/native/apply-registration-crash.test.ts`: new crash-window
  regression test.
- `docs/reports/2026-10-02-native-candidate-disposal.md`: dated evidence
  append.
- `tasks/report-execution-todo.md`: O03 checklist update.
- `docs/status-matrix.md`: clarify the newly covered crash window while keeping
  broader crash-atomicity and owner gates open.

## Non-goals

No production authorization, automatic write-to-apply chaining, recursive
cleanup of arbitrary or live paths, R10/R11 evaluator redesign, removal of run
evidence, or claim that the full apply/removal pipeline is crash-atomic.
