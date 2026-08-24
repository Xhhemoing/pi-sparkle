# Round 2 — gpt-sol-2

MODEL_SLUG: gpt-5.6-sol-xhigh-fast

## Changes

- Added `test/acceptance/evidence-invariant.test.ts`.
  - Exercises the deterministic `FakeExecutor` success path.
  - Requires the bound durable terminal episode to be `COMPLETED` with at least one evidence reference.
  - Requires matching `run-complete` PASSED acceptance evidence whose source is
    `run-status:<runId>:COMPLETED`.
  - This is terminal-status evidence only; it is not Outcome-supported evidence.
- Extended `test/unit/run/checkpoint-store.test.ts` without removing existing coverage.
  - Simulates a crash after a fully written/fsynced temp checkpoint but before rename.
  - Proves the previous committed checkpoint remains schema-valid and resumable.
  - Proves a later write reclaims the leftover temp file.
  - Proves a partial temp file is ignored when no committed checkpoint exists and does
    not poison the next write.
  - Proves a corrupt committed checkpoint fails closed even if a valid-looking
    uncommitted temp file is present.

No source changes were needed: the checkpoint store's committed-file-only read and
atomic rename behavior satisfy these crash-window cases. The optional benchmark field
was not added.

## Verification

- PASS:
  `pnpm exec tsx --test test/acceptance/evidence-invariant.test.ts test/unit/run/checkpoint-store.test.ts`
  — 5/5 tests.
- PASS: scoped strict TypeScript check of both owned test files.
- PASS: full `pnpm typecheck` (a first run observed transient errors in a concurrently
  edited, out-of-scope file; the final retry passed).

## Scope note

The shared worktree also contains unowned changes outside the three files assigned to
this slot. I did not edit or revert those files. Per instruction, no commit was
created.
