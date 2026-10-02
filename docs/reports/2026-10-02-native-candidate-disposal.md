# Native candidate disposal — evidence record

Task: `TASK-20261002-o03-issued-candidate-disposal`. Date: 2026-10-02.

## Delivered slice

- Registration records now bind the canonical source repository path as well as the accepted result.
- Registration schema `2` refuses older records that do not carry source identity.
- A fresh `NativeApplySession` can dispose an issued candidate after reconstructing the trusted run-scoped receipt.
- Disposal rechecks the live Git worktree registration, common repository identity, detached base revision, and candidate path before removal.
- Git removal failure is reported as unresolved and never falls back to recursive filesystem deletion.
- A run-scoped disposal artifact makes a successful repeated disposal return `DISPOSED` without touching the filesystem again.
- Host-only `/sparkle-dispose-candidate` accepts structured JSON or the existing five quoted positional arguments.

## Verification

- TypeScript: `node_modules/.bin/tsc --noEmit` — PASS.
- ESLint on changed files — PASS.
- `git diff --check` — PASS.
- Focused native/apply/registration/command/extension suite: **53 pass / 0 fail / 0 skip**.
- Integration fixture includes spaces, apostrophes, and Chinese characters in the temporary root.
- Replaced candidate path is refused and retained; no recursive fallback is performed.
- Run evidence remains readable after disposal; repeated disposal is idempotent.

## Boundaries still open

- Crash reconciliation between a successful Git removal and writing the final disposal artifact remains part of R10/R11 and is not claimed here.
- This does not authorize automatic write-to-apply chaining, production apply, or removal of run evidence.
- Independent review and owner authorization remain open.
