[Model: gpt-5.6-sol]

# Loop 4 · Round 10 — R10-8 flowchart `applyRetry` absence pin

## Outcome

Kept R8-3's whole-file AST pin unchanged and appended the named assertion
`discard and reopen identifiers remain under the whole-file scheduler absence
pin`.

The new assertion parses both pinned flowchart sources, requires each to retain
an AST identifier or string literal related to `discard`,
`RUN_UNBLOCKED_WITH_DISCARD`, or `reopenAfterUnblock`, and then applies the
existing whole-file `assertNoSchedulerRetry` check. R10-1's cumulative discard
implementation is covered in both files:

- `src/run/flowchart-run.ts` contains `RUN_UNBLOCKED_WITH_DISCARD` and the
  discard snapshot transform call.
- `src/supervisor/flowchart-supervisor.ts` contains
  `reopenAfterUnblock`, `reopenAfterUnblockWithDiscard`, and the corresponding
  snapshot transforms.

Neither file references `applyRetry` or imports `scheduler.js`.

## Census first

- Verified that
  `test/unit/run/flowchart-applyretry-absence.test.ts` existed before editing.
- The existing pin already enumerated both whole source files and rejected
  identifier/string-literal `applyRetry`, static `scheduler.js` imports or
  exports, and dynamic `scheduler.js` imports.
- The existing mutation test already supplied and rejected both required
  mutants: a namespace import from `./scheduler.js` and a reopen helper calling
  `applyRetry`. It remained unchanged and passed, so no duplicate mutation case
  was added.
- Final `src/**` census finds the `applyRetry` definition in
  `src/run/scheduler.ts` and its production import/call only in
  `src/run/supervisor.ts`; the flowchart files remain outside that transition.

## Verification

- `pnpm test -- test/unit/run/flowchart-applyretry-absence.test.ts`, three
  consecutive final cumulative-tree runs: each **3 pass, 0 fail, 0 skipped**.
- `pnpm exec eslint test/unit/run/flowchart-applyretry-absence.test.ts`:
  **pass**.
- `pnpm exec tsc --noEmit`: **pass** against the cumulative working tree.
- Owned-test `git diff --check`: **pass**.
- Node v22.14.0 produced the expected `>=22.19.0` engine warning.
- No full gate was run.

During concurrency, an early test run before R10-1 reached
`flowchart-run.ts` correctly found no discard marker there, and early
whole-tree typechecks observed incomplete sibling-owned edits. The final runs
above were taken after the discard identifiers and their missing types had
landed in the shared working tree.

## Scope

Owned changes are limited to:

- additive assertions in
  `test/unit/run/flowchart-applyretry-absence.test.ts`;
- this report.

No `src/**`, scheduler file, dependency, skip, scratch file, branch, commit, or
push change was made.
