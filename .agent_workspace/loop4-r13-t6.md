[Model: gpt-5.6-sol]

# Loop 4 Round 13 — R13-6

## Result

Report-only. I made no change to `test/unit/run/flowchart-applyretry-absence.test.ts`.

## Census

The working-tree census covered both complete files named by `FLOWCHART_SOURCES`:

- `src/run/flowchart-run.ts`: zero `applyRetry` or `scheduler.js` matches.
- `src/supervisor/flowchart-supervisor.ts`: zero `applyRetry` or `scheduler.js` matches.
- `assertDiscardAuditMatchesLog` remains called directly in `applyClearingEvent`; the owned AST pin still allows either `applyClearingEvent` or `restoreCheckpointedSupervisor` as the restore-side consumer.
- The owned test still parses and recursively visits the whole AST of both flowchart sources through `assertNoSchedulerRetry`.

The existing pin therefore already covers Round 13's expected diffs without naming their implementation symbols. Adding a special assertion for `onRunStarted` or `taskCriteria` would duplicate the whole-file guarantee and become brittle under harmless renames. R13-1's comments-only `replay.ts` change is outside `FLOWCHART_SOURCES`. R13-3's `src/cli/main.ts` change is likewise irrelevant to this pin: this slot's flowchart sources are only `flowchart-run.ts` and `flowchart-supervisor.ts`, and I do not own `main.ts`.

## Verification

- `pnpm exec eslint test/unit/run/flowchart-applyretry-absence.test.ts` — PASS.
- `pnpm exec tsc --noEmit` — PASS (whole tree).
- `pnpm test -- test/unit/run/flowchart-applyretry-absence.test.ts` — PASS 3/3; each run reported 4 passed, 0 failed, 0 skipped.

No source or test edit, checkout, commit, push, or PR.
