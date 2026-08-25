[Model: gpt-5.6-sol]
# Loop 4 · Round 11 · R11-9 — option (a) terminal-status freeze

## Census before edits
- Verified `test/unit/run/terminal-replay-statuses-freeze.test.ts` exists and is assigned exclusively to R11-9.
- At `2026-08-24T23:57:20Z`, the existing pin already froze `TERMINAL_REPLAY_STATUSES` to exactly `COMPLETED`, `FAILED`, and `BLOCKED`.
- The existing `RUN_UNBLOCKED` family pin discovers members with `EVENT_TYPES.filter(type => type.startsWith("RUN_UNBLOCKED"))`; it does not enumerate the family. Its runtime and type-level checks kept every discovered member outside `RUN_STATUSES`, `RunStatus`, and the terminal set.
- `RUN_STATUSES` contained five statuses outside the signed-off terminal trio. No option-(a) source marker was present yet in the concurrent working tree.
- Production consumers remain `replayedTerminalStatus` callers in `src/run/coordinator.ts` and `src/run/flowchart-run.ts`; the sole direct production membership check remains in `src/run/replay.ts`.

## Change
- Added one test, `option (a) adds no fourth terminal RunStatus`, only in the owned test file.
- The test discovers the full non-terminal vocabulary from `RUN_STATUSES`, asserts the census is non-vacuous, and proves every status outside the signed-off trio remains outside `TERMINAL_REPLAY_STATUSES`.
- The existing exact-trio pin and discovered-from-`EVENT_TYPES` `RUN_UNBLOCKED` family pin remain unchanged.
- No `src/**`, `replay.test.ts`, dependency, skip, or scratch file was changed.

## Verification
- `pnpm exec eslint test/unit/run/terminal-replay-statuses-freeze.test.ts` — pass.
- Whole-tree `pnpm exec tsc --noEmit` — pass.
- `pnpm test -- test/unit/run/terminal-replay-statuses-freeze.test.ts` — pass, 3/3 tests, 0 skipped.
- `git diff --check -- test/unit/run/terminal-replay-statuses-freeze.test.ts` — pass.
- The owned test is deterministic, so the timing-sensitive 3× requirement does not apply.
- Per dispatch, no full gate was run. The branch remained `agent/opt-continuous`; no checkout, commit, or push was performed.

## Shared-worktree note
- The initial census was clean apart from R11-8's concurrent test edit. At `2026-08-24T23:57:42Z`, final status also showed sibling edits in `docs/status-matrix.md`, `scripts/crash-probe.mjs`, `test/unit/run/episode-contract-boundary.test.ts`, and `test/unit/run/inspection.test.ts`. R11-9 did not touch them.
