[Model: gpt-5.6-sol-xhigh-fast]

# Loop 4 · Round 8 · R8-9 — root-keyed bandit reader removal

## Census before edits

The exact `loadProjectBandit` identifier census covered `src/**` and `test/**`:

- `src/learning/bandit-store.ts`: its declaration and its own keyed-reader
  docstring only. There was no production caller outside the defining module.
- `test/unit/learning/bandit-store.test.ts`: six calls.
- `test/unit/learning/bandit-store-atomic.test.ts`: three calls.
- `test/unit/learning/auto-loop.test.ts`: two calls.

No other source or test file imported, called, or re-exported the symbol. The
related helper census found:

- `loadProjectBanditByKey`: defined in the store and called in production only
  by `src/cli/doctor.ts`.
- `projectBanditPath`: used by the keyed reader, by the root-keyed path helper,
  and by doctor.
- `banditPath`: used by both the retired reader and `updateProjectBandit`.
  Because the production writer still takes `projectRoot`, the helper remains
  live after deletion and was retained.

## Change

- Deleted the caller-less `loadProjectBandit` export and updated the adjacent
  keyed-reader contract wording so it does not name the retired alias.
- Migrated all eleven test call sites to
  `loadProjectBanditByKey(stateRoot, stableProjectKey(projectRoot))`.
- Added the R6-9/R7-7 namespace-export absence pin:
  `"loadProjectBandit" in banditStore` must remain false. Reintroducing the
  root-keyed export without a live production caller now fails its owned unit
  test.

`loadProjectBanditByKey`, `projectBanditPath`, and the live writer's
`banditPath` behavior are unchanged. Doctor was not edited: it remains the only
production bandit reader and still uses the keyed seam. No import entered the
live closure, `selectArm` remains absent there, and the `learnedState` JSON
contract is unchanged.

## Post-edit census

- `src/**` has no `loadProjectBandit` occurrence.
- `test/**` has one occurrence: the string in the namespace absence pin.
- The only production `loadProjectBanditByKey` call remains doctor.
- `banditPath` remains called by `updateProjectBandit`.

## Verification

- Scoped ESLint on `src/learning/bandit-store.ts` and the three migrated tests:
  clean.
- Whole-tree `pnpm exec tsc --noEmit`: clean.
- Focused learning tests plus `test/unit/routing/live-isolation.test.ts`:
  33/33 pass, 0 fail, 0 skipped.
- The touched atomic/race test file was run two additional times:
  5/5 pass on each run (three green runs total).
- Scoped `git diff --check`: clean.

The test command emitted the existing engine warning (package requires Node
`>=22.19.0`; this VM is Node `22.14.0`) but exited zero. Per dispatch, no full
gate was run. No package, doctor, isolation-pin, ADR, branch, or git-history
change was made.
