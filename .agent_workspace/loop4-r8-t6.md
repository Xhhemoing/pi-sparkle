[Model: gpt-5.6-sol-xhigh-fast]
# Loop 4 · Round 8 · R8-6 — catalog-route posture and bandit producer

## Verdict

Landed parent option (b). `CATALOG_OBSERVED_CORRUPT` remains a frozen
defense-in-depth route for a future command producer; no producer was invented.
The real bandit producer is now covered end to end.

## Census first

- `loadCatalogObservedSnapshot` has exactly two `src/**` references: its
  definition in `src/routing/catalog-observed.ts` and doctor's call. Doctor
  catches `CatalogObservedCorruptError` and records a damaged/derived
  `learnedState` entry, so it does not propagate the error to `main`.
- The real bandit producer remains `adapt auto` → `runAutoAdaptLoop` →
  `updateProjectBandit` → read-under-lock of the project's `bandit.json`.
- Before deletion, `configurePreferencePersistence` appeared in the owned test
  file only as its import and the `finally` repair. R7-8 made doctor's inventory
  read pure, and the failed preference bind does not adopt damaged state. The
  owned file now has no occurrence.
- `src/cli/main.ts` was not edited. `GENERIC_FAILURE_NEXT` and all five
  `DOCTOR_ROUTED_NEXT` route strings therefore remain character-exact.

## Changes

- Added the option-(b) posture beside `CatalogObservedCorruptError`: the route
  is future-facing defense-in-depth, while today's sole command-path reader
  (doctor) absorbs the typed error into inventory.
- Added a real-project CLI test. It writes one model-attributed Pi subagent run,
  enables `SPARKLE_AUTO_ADAPT`, places truncated bytes at
  `projectBanditPath(stateRoot, stableProjectKey(projectRoot))`, and runs real
  `adapt auto`.
- The test pins exit 1, `command: "adapt"`, `stage: "validation"`, the complete
  routed `next:` string, and the damaged path in the error. It then runs doctor
  and proves `learnedState.entries` carries that exact path and project key as
  damaged learned state with move-aside/relearn remediation.
- Removed the obsolete preference-persistence `finally` repair and import.
- Added no catalog CLI-producer test and made no catalog command reachable.

## Verification

- `pnpm exec eslint src/routing/catalog-observed.ts test/integration/cli/command-error-doctor.test.ts`
  — PASS.
- `node scripts/run-tests.mjs test/integration/cli/command-error-doctor.test.ts`
  — PASS four runs, 10/10 each, 0 skipped.
- `pnpm exec tsc --noEmit` — PASS for the whole tree.
- `git diff --check -- src/routing/catalog-observed.ts test/integration/cli/command-error-doctor.test.ts .agent_workspace/loop4-r8-t6.md`
  — PASS.
- No full gate run, as instructed.

Concurrent sibling edits were present outside the two owned code files and this
report; none were modified or reverted by this slot. No scratch file was added.
