[Model: gpt-5.6-sol]
# Loop 4 · Round 12 · R12-9 — RunStatus vocabulary freeze

## Census before edits
- Verified `test/unit/run/terminal-replay-statuses-freeze.test.ts` exists and is assigned exclusively to R12-9.
- The R10-10 assertions already froze `TERMINAL_REPLAY_STATUSES` to exactly `COMPLETED`, `FAILED`, and `BLOCKED`, and discovered every `RUN_UNBLOCKED*` event from `EVENT_TYPES` for runtime and type-level disjointness checks.
- The R11-9 assertion already prevented a fourth terminal replay status, but it would allow an arbitrary new non-terminal member of `RUN_STATUSES`.
- `RUN_STATUSES` currently has exactly eight members: `PLANNING`, `RUNNING`, `WAITING_FOR_USER`, `PAUSED`, `BLOCKED`, `COMPLETED`, `FAILED`, and `CANCELLED`.
- Consumer census: `RUN_STATUSES` is directly read by `isRunStatus` and this owned freeze test. The sole production membership check against `TERMINAL_REPLAY_STATUSES` is `replayedTerminalStatus`; its source callers are `flowchart-run.ts` and `coordinator.ts`.

## Change
- Added one exact-vocabulary assertion, `R12-1 adds no new RunStatus`, only in the owned test file.
- The assertion freezes all eight current `RunStatus` members, so R12-1 cannot introduce a new status while adding task-criteria carriage or early run-id disclosure.
- The R10-10 exact terminal-trio and `RUN_UNBLOCKED*` assertions and the R11-9 no-fourth-terminal assertion remain unchanged.
- No `src/**`, dependency, skip, or scratch file was changed.

## Verification
- `pnpm exec eslint test/unit/run/terminal-replay-statuses-freeze.test.ts` — pass.
- Whole-tree `pnpm exec tsc --noEmit` — pass.
- `pnpm test -- test/unit/run/terminal-replay-statuses-freeze.test.ts` — pass, 4/4 tests, 0 skipped.
- The owned test is deterministic, so the timing-sensitive 3× requirement does not apply.
- Per dispatch, no full gate was run. The branch remained `agent/opt-continuous`; no checkout, commit, or push was performed.

## Shared-worktree note
- Final status also showed a concurrent edit in `test/unit/tracking/independent-evidence-posture.test.ts` and sibling R12-6/R12-7 reports; R12-9 did not touch them.
