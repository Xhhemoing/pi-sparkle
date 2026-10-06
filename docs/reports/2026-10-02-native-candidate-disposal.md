# Native candidate disposal — evidence record

Task: `TASK-20261002-o03-issued-candidate-disposal`. Date: 2026-10-02.

## Delivered slice

- Registration records now bind the canonical source repository path as well as the accepted result.
- The receipt also captures source and candidate filesystem identities at issue time; disposal rejects identity drift.
- Registration schema `2` refuses older records that do not carry source identity.
- A fresh `NativeApplySession` can dispose an issued candidate after reconstructing the trusted run-scoped receipt.
- Disposal rechecks the live Git worktree registration, common repository identity, detached base revision, and candidate path before removal.
- Git removal failure is reported as unresolved and never falls back to recursive filesystem deletion.
- Candidate edits, untracked/ignored files, locked worktrees, and replacement registrations are retained for manual inspection.
- A run-scoped disposal artifact makes a successful repeated disposal return `DISPOSED` without touching the filesystem again.
- Host-only `/sparkle-dispose-candidate` accepts structured JSON or the existing five quoted positional arguments.

## Verification

- TypeScript: `node_modules/.bin/tsc --noEmit` — PASS.
- ESLint on changed files — PASS.
- `git diff --check` — PASS.
- Focused native/apply/registration/command/extension suite: **59 pass / 0 fail / 0 skip**.
- Integration fixture includes spaces, apostrophes, and Chinese characters in the temporary root.
- Replaced candidate path is refused and retained; no recursive fallback is performed.
- Run evidence remains readable after disposal; repeated disposal is idempotent.

## Boundaries still open

- Crash reconciliation between a successful Git removal and writing the final disposal artifact remains part of R10/R11 and is not claimed here.
- This does not authorize automatic write-to-apply chaining, production apply, or removal of run evidence.
- Independent review and owner authorization remain open.

## 2026-10-06 crash-window receipt reconciliation

Task: `TASK-20261006-o03-crash-reconciliation`. Plan: [2026-10-06 O03 crash reconciliation](../superpowers/plans/2026-10-06-o03-crash-reconciliation.md).

The new integration regression reproduces the crash window after a successful
`git worktree remove --force` and before the disposal receipt is written. The
pre-fix retry failed on the absent candidate path. A temporary Git probe also
confirmed that successful removal removes both the path and its exact
administrative worktree record on this environment.

`disposeAuthorized` now checks the issued source identity first. If the exact
authorized candidate path is absent and Git has no record for that exact path,
it reports `DISPOSED` so the ordinary durable receipt is persisted. If a
prunable stale record remains, it prunes that record, rechecks that the exact
record disappeared, and then reports `DISPOSED`. A missing path with a
non-prunable record, a live replacement, a foreign or mutated identity, and a
failed Git removal continue to fail closed.

### Author verification

- RED: `node --import tsx --test test/integration/native/apply-registration-crash.test.ts` failed before the fix on the absent candidate path.
- Regression: same command passed with 1 test / 1 pass / 0 fail / 0 skip.
- Focused native/apply/registration suite: 37 tests / 37 pass / 0 fail / 0 skip, including the existing replacement, tracked-edit, untracked, ignored, and locked-worktree refusal cases.
- `node_modules/.bin/tsc --noEmit`: PASS.
- `node_modules/.bin/eslint src/native/apply.ts test/integration/native/apply-registration-crash.test.ts`: PASS.
- `git diff --check`: PASS.

### Still open

- Independent review of this exact source is required; author commands are not independent acceptance.
- The separate R10/R11 evaluator-definition and candidate-snapshot boundary remains open.
- This is receipt reconciliation after one completed Git removal, not a claim that apply and disposal are fully crash-atomic.
- No production authorization or automatic write-to-apply chaining is claimed.
