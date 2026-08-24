[Model: gpt-5.6-sol]
# Loop 4 · Round 10 · R10-10 — terminal replay status freeze

## Census before edits
- Verified the preferred path `test/unit/run/terminal-replay-statuses-freeze.test.ts` did not exist and was not assigned to another slot.
- At `2026-08-24T23:05:23Z`, `RUN_UNBLOCKED_WITH_DISCARD` had no `src/**/*.ts` match. `EVENT_TYPES` contained `RUN_UNBLOCKED`.
- `TERMINAL_REPLAY_STATUSES` was exactly `COMPLETED`, `FAILED`, and `BLOCKED`.
- `RunStatus` came solely from `RUN_STATUSES`, which did not contain any `RUN_UNBLOCKED*` value.
- Production consumers use the set through `replayedTerminalStatus`: `flowchart-run.ts` calls it once and `coordinator.ts` calls it once. The only direct production membership check remains inside `replay.ts`.

## Change
- Added only `test/unit/run/terminal-replay-statuses-freeze.test.ts`.
- One runtime pin freezes the terminal replay set to exactly the three signed-off values.
- A second pin discovers every `EVENT_TYPES` entry whose name starts with `RUN_UNBLOCKED`, requires the ordinary `RUN_UNBLOCKED` event to exist, and proves each discovered event is absent from both `RUN_STATUSES` and `TERMINAL_REPLAY_STATUSES`.
- A type-level intersection also requires all current and future `RUN_UNBLOCKED*` event literals to remain disjoint from `RunStatus`. This stays green before R10-1 lands and automatically covers `RUN_UNBLOCKED_WITH_DISCARD` after it enters `EVENT_TYPES`.
- No `src/**`, `replay.test.ts`, `event-row-fuzz.test.ts`, `flowchart-run.ts`, skip, dependency, or scratch file was changed.

## Verification
- `pnpm exec eslint test/unit/run/terminal-replay-statuses-freeze.test.ts` — pass.
- Whole-tree `pnpm exec tsc --noEmit` — pass.
- `pnpm test -- test/unit/run/terminal-replay-statuses-freeze.test.ts` — pass, 2/2 tests, 0 skipped.
- Node was `v22.14.0`; the expected package-engine warning for `>=22.19.0` appeared.
- `git diff --no-index --check` against `/dev/null` for the new test and report — pass.
- Per dispatch, no full gate was run. The branch remained `agent/opt-continuous`; no checkout, commit, or push was performed.

## Shared-worktree note
- Final status also showed concurrent sibling edits in docs, tracking sources/tests, `src/run/child-tracking.ts`, `test/unit/pi-adapter/report-task-result.test.ts`, `test/unit/protocol/v1.test.ts`, `test/unit/run/flowchart-applyretry-absence.test.ts`, and `test/unit/run/gate-status-posture.test.ts`, plus R10-2's report. R10-10 did not touch them.
