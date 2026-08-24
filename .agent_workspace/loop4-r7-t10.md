# Loop 4 · Round 7 · R7-10 — command-error doctor producers

## Verdict: STOP — catalog producer is not CLI-reachable

The requested two-test addition cannot be completed without a `src/**` change.
`BANDIT_STATE_UNREADABLE` has a real command producer, but
`CATALOG_OBSERVED_CORRUPT` does not. Per the R5-8/R5-9 stop precedent and this
slot's explicit instruction, I did not add a one-sided test or construct the
catalog error in another test.

## Census and reproduction

### Bandit: reachable

The command path is:

`main(["adapt", "auto", ...])`
→ `adaptCommand`
→ `runAutoAdaptLoop`
→ `updateProjectBandit`
→ the read-under-lock of that project's existing `bandit.json`.

I reproduced this with a temporary real project containing one Pi subagent-run
record with a model id, `SPARKLE_AUTO_ADAPT=1`, and truncated bytes at the
project's real `stableProjectKey` bandit path. The real command returned 1 with:

- `command: adapt`
- `stage: validation`
- the exact bandit `next:` route naming
  `pi-sparkle doctor --json --state-root <root>` and `learnedState[]`
- the damaged bandit's exact path in the error

This route can support the requested R6-5 test-2 pattern.

### Observed catalog: unreachable

The complete `src/**` caller census for `loadCatalogObservedSnapshot` is:

1. its own definition in `src/routing/catalog-observed.ts`; and
2. `src/cli/doctor.ts`.

No run, adapt, models, learning, or routing command calls it. The other
`catalogObservedPath` consumers either write the snapshot or delete it; they do
not read damaged bytes.

Doctor is not a failing producer. Its inventory catches
`CatalogObservedCorruptError`, appends a `damaged` / `derived` entry with the
rebuild remediation, and leaves `scanErrors` empty. I reproduced a real
`doctor --json` command over a truncated snapshot. Its report contained:

```json
{
  "kind": "catalog-observed",
  "stateClass": "derived",
  "status": "damaged",
  "remediation": "derived state: delete the damaged file and rebuild it from runtime/invocations.jsonl; doctor never changes it"
}
```

The command's exit 1 on this VM came from another failing doctor check and used
doctor's generic `checks[]` next step; the catalog error was absorbed as
advisory inventory. Therefore no real command can currently throw the frozen
catalog code into `main` and select its routed `next:`.

Making that route observable would require adding a command-path read/rebuild
surface in `src/**`, outside R7-10 ownership.

## Changes

- Added this report only.
- No `src/**` changes.
- No change to `test/integration/cli/command-error-doctor.test.ts`.
- No fixture or scratch file retained.

## Verification

- `pnpm exec eslint test/integration/cli/command-error-doctor.test.ts` — PASS.
- Owned suite run 3× with
  `node scripts/run-tests.mjs test/integration/cli/command-error-doctor.test.ts`
  — PASS 9/9 each run, 0 skipped.
- `pnpm exec tsc --noEmit` — shared-tree FAIL:
  `test/unit/graph/empty-graph.test.ts:28` adds a `reason` property not present
  on the `EXECUTION_FINISHED` event type. That untracked R7-9-owned test and
  the concurrent `src/graph/validate.ts` edit are outside this slot; no owned
  file appears in the diagnostic.
- No full gate, as instructed.

Both temporary reachability repros used `/tmp` and removed their state/project
directories in `finally`.
