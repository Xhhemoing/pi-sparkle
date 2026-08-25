[Model: gpt-5.6-sol]

# Loop 4 Round 12 — R12-5

## Result

Report-only. I made no change to `test/unit/run/flowchart-applyretry-absence.test.ts`.

The requested path exists. The 2026-08-25T00:55:50Z census included R12-1's in-flight changes in `src/run/flowchart-run.ts` (`taskCriteria`, `onRunStarted`, and `loggedTaskRequests`):

- `applyRetry` / `scheduler.js`: zero matches in both whole files named by `FLOWCHART_SOURCES`.
- `assertDiscardAuditMatchesLog` remains called directly inside `applyClearingEvent`; `restoreCheckpointedSupervisor` remains an allowed restore consumer.
- The owned test is unchanged and retains all four inherited assertions.

No additive assertion would strengthen the contract. `assertNoSchedulerRetry` already parses and visits the entire `flowchart-run.ts` and `flowchart-supervisor.ts` ASTs, so every R12-1 path is covered automatically. A new assertion naming `taskCriteria`, `onRunStarted`, or `loggedTaskRequests` would duplicate that whole-file guarantee and make the pin brittle to implementation-preserving renames.

## Verification

- `pnpm exec eslint test/unit/run/flowchart-applyretry-absence.test.ts` — PASS
- `pnpm exec tsc --noEmit` — PASS (whole tree)
- `pnpm test -- test/unit/run/flowchart-applyretry-absence.test.ts` — PASS 3/3 after the R12-1 diff appeared; 4 tests per run, 0 failures/skips
- Full gate not run, per instruction.

No scratch files, git checkout, commit, or push.
