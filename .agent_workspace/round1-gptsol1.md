# Round 1 gpt-sol-1
MODEL_SLUG: gpt-5.6-sol-xhigh-fast

## Implemented
- Added runtime JSONL/lock benchmark probe at `scripts/bench-runtime.mjs` (1,000 samples, four contending workers, JSON-only stdout).
- Expanded JSONL coverage for round trips, missing/empty files, parent creation, an observed fsync call, truncated-tail recovery, newline-terminated corrupt tails, corrupt middle lines, and valid non-newline tails.
- Added lock coverage for two concurrent writers, timeout behavior, timeout-only stale locks, exact owner-token release, operation failures, and metadata-write acquisition failures.
- Fixed a real acquisition leak: if lock metadata writing fails after exclusive creation, the handle is now closed and the partial lock file removed before the original error is rethrown.
- Release now parses lock metadata and requires an exact `ownerToken` match instead of accepting a matching substring in malformed content.
- Stale locks deliberately remain timeout-only. PID reuse and shared/container filesystems mean a dead local PID is not sufficient proof that the recorded owner is inactive.

## Bench numbers
Node v22.22.2, `samples=1000`, four contending workers:
- `jsonlAppendMs`: 49.32
- `jsonlReadMs`: 1.053
- `lockSerialMs`: 217.262
- `lockContendedMs`: 303.547
- `ok`: true

## Tests
- `pnpm test -- test/unit/persist/*.test.ts`: PASS, 13/13 (Node v22.22.2).
- `pnpm typecheck`: PASS (Node v22.22.2).
- `node scripts/bench-runtime.mjs`: PASS, `ok: true` (Node v22.22.2).
- Owned-file ESLint and `git diff --check`: PASS.
- The exact requested `pnpm test -- test/unit/persist` does not discover a directory with the current `tsx --test` script; on both Node v22.14.0 and v22.22.2 it fails before loading tests with `ERR_UNSUPPORTED_DIR_IMPORT`. Explicit `*.test.ts` paths run the intended suite successfully.

## Residual risks
- An abandoned lock requires timeout plus manual cleanup; there is intentionally no automatic stale-lock stealing.
- `appendJsonlLine(..., true)` fsyncs the file, but not the parent directory entry when creating a new file.
- Bench values are a local wall-clock probe, not a stable CI performance gate.

## Blocked / handoff
- If directory-form test invocation is required, the parent-owned/forbidden test command configuration needs to expand `test/unit/persist/*.test.ts`; no package script was changed in this slot.
