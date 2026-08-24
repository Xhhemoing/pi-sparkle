# Loop 2 Round 1 — opus-2

- **Model:** `claude-opus-5-thinking-high-fast`
- **Branch:** `agent/sota-opt-next-7e63` (no commit — parent commits)
- **Gap closed:** delete-vs-live-appender race on the shared
  `runtime/invocations.jsonl` (PROGRESS gap 2; `docs/data-dictionary.md:114`).

## The race, precisely

`dropRunFromInvocationLog` (`src/privacy/deletion.ts`) does a
read → filter → `writeFile` cycle over the whole log while holding
`invocations.jsonl.lock`. The live executor sink in `src/cli/main.ts` did

```ts
void appendFile(join(runtimeRoot(stateRoot), "invocations.jsonl"), `${JSON.stringify(invocation)}\n`);
```

with no lock. An append landing between the rewrite's read and its `writeFile`
was therefore erased: the appended bytes were in the file, then the rewrite
overwrote the file with the pre-append snapshot minus the deleted run's rows.
The lock the rewrite already held only serialized *deletes against deletes*.

## What landed

### NEW `src/telemetry/invocation-log.ts`

The single writer surface for the shared log. Exports:

| Symbol | Purpose |
|---|---|
| `INVOCATIONS_LOG`, `invocationsLogPath` | Canonical location (moved here from `routing/cost-calibration.ts`) |
| `invocationLogLockPath` | `<log>.lock` — byte-identical to the string the rewrite used before, so no on-disk lock rename |
| `withInvocationLogLock` | Run an operation under the log's exclusive lock (used by the delete rewrite) |
| `appendInvocationRecord` | Validate → queue → lock → `appendJsonlLine` |
| `readInvocationRecords` | Writer-side read: fail-closed on a corrupt middle line, `recovery` for a truncated tail |
| `writeInvocationRecords` | Write half of a rewrite; documented as lock-required |

Three deliberate properties:

1. **Fail closed on a malformed record.** `appendInvocationRecord` runs
   `validateInvocation` before anything touches disk. A row that cannot be read
   back is worse than a missing one, because both calibration and the delete
   filter key off its fields.
2. **In-process append queue keyed by log path.** The file lock alone is
   correct but polls on `EEXIST`; N concurrent appends in one process would
   spin against each other and a fan-out could burn its own 5 s lock timeout
   waiting on siblings. Chaining per path means the process asks for the lock
   once at a time, and appends land in call order (pinned by a test).
3. **Readers stay lock-free.** `loadInvocationsFromStateRoot` already skips
   rows it cannot parse, so a torn tail costs a calibration sample instead of
   blocking a live run behind a writer.

### `src/privacy/deletion.ts`

Rewrite now runs inside `withInvocationLogLock` and uses
`readInvocationRecords` / `writeInvocationRecords`. Behaviour is unchanged:
same fail-closed corrupt-middle error string (`corrupt invocation jsonl at line
N of <path>; refusing to rewrite it for a delete`), same truncated-tail drop,
same structural (not `isInvocation`-gated) runId match, same "no log → no lock,
no mkdir" short-circuit. The contract comment that used to end "It does not
stop the live appender … so deleting a run while it is still executing can
race" now states the opposite invariant.

### `src/cli/main.ts` (only the `onInvocation` body + imports)

```ts
void appendInvocationRecord(stateRoot, invocation).catch(() => undefined);
```

Still fire-and-forget, but the promise takes the lock. Errors are swallowed on
purpose and consistently: the two new failure modes are a lock timeout (a
`delete --run` holding the lock) and a validation rejection, and neither should
kill a run the executor is mid-way through. Note this is *strictly* safer than
before — the old `void appendFile(...)` had no `.catch`, so an EACCES/ENOSPC
would have surfaced as an unhandled rejection. `appendFile` is no longer
imported by the CLI.

### `src/routing/cost-calibration.ts`

Path constant de-duplicated: it now re-exports `INVOCATIONS_LOG` /
`invocationsLogPath` from the telemetry module (`join` + `runtimeRoot` imports
dropped). Every existing importer (`deletion.ts`, `deletion.test.ts`,
`test/integration/cli/delete.test.ts`) keeps working. Calibration math,
eligibility gating, and `loadInvocationsFromStateRoot` are untouched.

## Tests

`test/unit/telemetry/invocation-log.test.ts` (11) — path identity with the
calibration re-export (same function object, not a second copy); append creates
the runtime plane and round-trips through `loadInvocationsFromStateRoot`;
malformed record fails closed with nothing written; 12 concurrent appends land
whole and in call order; an append **blocks** while another writer holds the
lock and lands after release; a read → append → `writeInvocationRecords` cycle
under the lock does not clobber the queued append; corrupt-middle refusal text;
truncated-tail `recovery`; missing log reads empty; empty rewrite leaves no
blank line; a lock timeout rejects instead of falling back to an unlocked
write.

`test/unit/privacy/deletion.test.ts` (+3, 21 total) — the rewrite waits for the
lock (held externally, log provably unmodified during the hold); an invocation
appended concurrently with `deleteRunRecords` survives while the deleted run's
rows do not; a late append after a delete is a new fact, not a resurrection,
and a second delete clears it.

**Mutation check.** With `withInvocationLogLock` stubbed to call the operation
directly (no lock), 5 of these fail — including the end-to-end
`Promise.all([deleteRunRecords, appendInvocationRecord])` case, which loses the
appended row deterministically on this machine. Restored, all pass. The guards
are not vacuous.

## Verification

- `tsc --noEmit`: clean for every file in this slot. (One pre-existing error in
  `test/unit/run/inspection.test.ts` belongs to opus-1's in-flight edit in the
  shared worktree, not to this change.)
- `eslint` on all six touched/added files: clean.
- Full suite: **1434 tests, 1433 pass, 0 fail, 1 skip** (R3 baseline was 1363;
  the delta includes other slots' concurrent work).
- `test/unit/routing/live-isolation.test.ts` still green: the new module enters
  the live closure but reaches nothing on the watchlist.
- `test/unit/privacy/plane-boundary.test.ts` still green: the new module is
  runtime-plane (`telemetry/`), and no adaptation-plane file imports it.

## Handoffs / residual

1. **`docs/data-dictionary.md:114-117` is now stale** — it still says "the live
   appender (`onInvocation`) appends without taking it. Delete a run after it
   terminates". That file belongs to fable-2 this round. Suggested replacement:
   both writers take `invocations.jsonl.lock`, so a concurrent append lands
   wholly before or wholly after the rewrite; what a delete still cannot do is
   stop a *later* append from a run that is still executing, so a row written
   after the delete requires a second delete. (`docs/reports/2026-08-24-sota-r2/
   r3-isolation.md` also describe the race, but those are dated findings and
   should stay as written.)
2. **Not touched, by instruction:** `inspectCommand`, R1 enablement,
   auto-promotion, `package.json`.
3. **Cross-process contention is bounded by the 5 s lock timeout.** Two
   processes appending heavily to one state root could time out an append and
   silently drop a telemetry row. Acceptable for a single-CLI workflow; if
   multi-process telemetry becomes real, the append needs a bounded retry with
   a visible counter rather than a longer timeout.
4. **Silent drop has no counter.** The swallowed `.catch` means a lost row
   leaves no trace. A `--verbose`-gated stderr note (or a per-run dropped-row
   count in the run summary) would close that, but it changes CLI output, which
   is outside this slot's ownership.
5. If gpt-sol-2 writes the `scripts/` probe for the locked append, the helper it
   should drive is `appendInvocationRecord` (validating, lock-taking) — writing
   the log with a bare `appendFile` in a probe would reintroduce exactly the
   unlocked writer this change removed.
