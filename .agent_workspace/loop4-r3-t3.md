claude-opus-5-thinking-high-fast

# Loop 4 · Round 3 · R3-3 — `delete --run` resurrection race

**Slot:** P2, privacy/races. **Files touched (exclusive, nothing else):**

| File | Change |
|---|---|
| `src/privacy/deletion.ts` | run-subtree removal is now verified and fails closed (`RunRecordsSurvivedError` / `RUN_RECORDS_SURVIVED`); new exported `verifyRunRecordsRemoved(stateRoot, runId)`; private `removeRunSubtree`, `survivingRunEntries`, `runRecordsSurvived`; the derived p50 invalidation moved into the invocation rewrite so a failed delete cannot leave a stale aggregate |
| `test/unit/privacy/deletion.test.ts` | +4 tests (32 → 36) |
| `test/integration/cli/delete.test.ts` | +1 test (9 → 10), plus a module-level `runEvent` helper reused by the pre-existing episode fixture |

No commit (per instruction). `event-store.ts` untouched — see "Report to parent" below.

## The defect, reproduced

`deleteRunRecords` did `rm -rf runtime/runs/<id>/` and reported success. Nothing on the run plane
serializes with a writer: `EventStore.append`, `checkpoint-store.ts`, `pause-controller.ts` and
`track/loop.ts` all write under `runtime/runs/<id>/` with no lock, and `appendJsonlLine` treats a
missing directory as recoverable (`ENOENT` → `mkdir -p` → retry, `persist/jsonl.ts:33-34`). So a
live run recreated the directory it had just been "deleted" from, and the CLI printed
`removed: …/runs/<id>` for records that were back on disk.

Pinned directly, no mocks, in `a live append recreates the deleted run directory, and the check
says so`: real `EventStore`, real delete, then one more `append()` — `existsSync(runDir)` is true
again.

## What I changed, and why this option

The brief offered three. Two are unavailable or dishonest at this tree state:

1. **Run-scoped delete lock — not available.** There is no run-plane lock to join. The six
   `withExclusiveFileLock` call sites are episodes, feedback, invocations, bandit, credentials and
   the adaptation registry; none is run-scoped. Making one work means adding acquisition to *four*
   writers, one of which (`src/run/event-store.ts`) is R3-4's file this round. That is exactly the
   "invasive churn" the brief excludes. Reported to the parent rather than done.
2. **Terminal-event precondition with explicit override — the override cannot exist this round.**
   `deleteCommand` (`src/cli/main.ts:1476`) parses args with `strict` `parseArgs` and passes no
   options through, and `main.ts` belongs to R3-9. A precondition with no reachable override would
   make `delete --run` *impossible* for any run without a terminal event — which, per R3-5's own
   evidence, includes every run that died by an escaping error. Trading a race for "a privacy
   delete an operator cannot execute" is a worse honesty failure than the one being fixed.
3. **Fail-closed detection — implemented.** The removal is followed by
   `verifyRunRecordsRemoved`; a directory that is back (or never left) raises
   `RunRecordsSurvivedError` instead of returning a `DeletionResult`.

Two failure shapes, one error class. A writer that recreates the directory *during* the recursive
walk makes `rm` itself fail (`ENOTEMPTY`); one that recreates it just after leaves a fresh
directory. Both mean "run records on disk after a delete", so both raise the same typed error, with
the `rm` failure attached as `cause` when there was one. An `rm` failure that left *nothing* behind
is rethrown unchanged — it is an I/O fault, not a resurrection, and labelling it one would send the
operator hunting a writer that does not exist.

New public surface (additive; `deleteRunRecords`'s signature and `DeletionResult` shape unchanged):

- `RUN_RECORDS_SURVIVED_CODE` / `RunRecordsSurvivedError extends DomainValidationError`, carrying
  `code`, `runDir`, `survivingEntries` and `cause`. Code-based discrimination, per R2-2 doctrine —
  never string-match the message. Being a `DomainValidationError` means `main.ts`'s existing catch
  maps it to `cliFail(stage: "validation")`, so the operator gets the message and a non-zero exit
  with no CLI change.
- `verifyRunRecordsRemoved(stateRoot, runId)` — the delete's own post-condition, exported so it can
  be re-asserted without deleting again (and so the fail-closed branch is pinned deterministically
  rather than by racing).

One scope extension, disclosed: `invalidateCatalogObserved` moved from the end of `deleteRunRecords`
into `dropRunFromInvocationLog`, next to the rows it invalidates. The subtree removal can now throw,
and a failed delete must not leave a p50 aggregate that still averages rows the rewrite already
dropped. `removedPaths` contents and ordering are unchanged (the existing aggregate test still
passes untouched).

## Measured

Adversarial-writer probe (throwaway script, this VM, 30 attempts: 300-entry run dir, a writer doing
`mkdir -p` + append in a tight loop for the whole delete):

```
{"tally":{"causeless":4,"caused":20,"clean":6},"causes":["ENOTEMPTY"]}
```

24/30 deletes refused: 20 caught as `rm` failing mid-walk, 4 caught by the post-removal check. Zero
raw/untyped errors escaped. The other 6 returned success and the writer recreated the directory
*after* the check — the residual window below, quantified rather than asserted away.

## Disclosed limit (in the source docstring, not just here)

The check is point-in-time. A writer whose append lands after it still recreates the directory and
this delete has already returned success — the same "a late write is a new fact, not a resurrected
one" posture the shared invocation log documents, except the run plane gives the operator no lock to
serialize against. Under an adversarial writer that is ~1 delete in 5; under a real run appending
events at human cadence it is far rarer, but it is not zero and nothing here pretends otherwise.
Closing it needs a run-scoped lock taken by every run-plane writer — a change to those writers.

Considered and rejected: re-checking after a settle delay (buys probability, costs determinism and
latency, and "we waited 50 ms" is not a contract); leaving a file at `runtime/runs/<id>` so the
writer's `mkdir` fails (breaks the live run with an unexplained error and leaves an artifact a
delete has no business creating).

## Tests

Unit (`test/unit/privacy/deletion.test.ts`, 32 → 36):

1. `verifying a run delete passes on an absent subtree and fails on a recreated one` — absent ⇒
   resolves; a bare recreated directory ⇒ `RunRecordsSurvivedError` with `code`, `runDir`,
   `survivingEntries: []`, "an empty directory" wording, and `instanceof DomainValidationError` (the
   CLI mapping). The empty case matters: the appender creates the directory first and appends
   second, so a bare directory is a resurrection caught mid-flight.
2. `a live append recreates the deleted run directory, and the check says so` — the defect
   mechanism end to end with a real `EventStore`, plus: the delete's success is verified, the
   post-delete append is detected (`survivingEntries: ["events.jsonl"]`), and the re-delete is
   honest and idempotent.
3. `a run directory recreated by a live writer fails the delete loudly` — the real race. Bounded
   retry (≤12 attempts, breaks on first observation) because ~1 attempt in 5 has the writer land
   after the check; every attempt also asserts that nothing raw escaped. Ran 3× — stable, ~85 ms.
4. `the run delete cannot report a subtree removal it did not verify` — source pin: the only path
   that pushes `runDir` into `removedPaths` is the verified helper. A window that closes cannot be
   caught behaviourally after it is gone; this is what stops it silently reopening.

Integration (`test/integration/cli/delete.test.ts`, 9 → 10):

5. `delete --run proves the subtree is gone, and re-deletes a run that wrote again` — CLI exit 0 +
   `removed:` line only after `verifyRunRecordsRemoved` passes; then a live appender recreates the
   directory and the operator's remedy (delete again) is pinned. The CLI cannot be made to *fail*
   this way deterministically without owning `main.ts`, so the failure shape is pinned at the unit
   level instead.

R2-3's episode semantics are untouched: no change to `deleteEpisodeRecords`, `unlinkEpisodeFiles`,
the fail-closed stale-lock posture, the lock-not-in-`removedPaths` rule, or the no-op posture. All
14 pre-existing episode tests pass unmodified.

## Verification (this VM, Node v22.14.0)

- `npx tsc --noEmit` (whole tree) — clean.
- `npx eslint src/privacy/deletion.ts test/unit/privacy/deletion.test.ts test/integration/cli/delete.test.ts` — clean.
- Owned files: **46/46 pass** (36 unit + 10 integration), 0 fail, 0 skip. Timing-sensitive test run 3×, stable.
- `test/unit/privacy` + `test/integration/cli`: 120/120, three consecutive runs.
- Whole suite on the shared working tree (all Round 3 slots' in-flight edits present):
  **1601 tests / 1600 pass / 0 fail / 1 skip**. Baseline measured at HEAD in a scratch `git worktree`
  for comparison: 1547 / 1545 / 0 fail / 2 skip. The +54/-1-skip delta is the other slots, not this
  one; this slot is +5 tests. Full gate remains the parent's call.

## Report to parent

1. **Writer-side lock, not taken.** Closing the residual window needs a run-scoped cooperative lock
   (`runtime/runs/<id>.lock`, `withExclusiveFileLock`) acquired by `EventStore.append`
   (`src/run/event-store.ts` — R3-4's file this round) and, to be complete, by
   `src/run/checkpoint-store.ts`, `src/run/pause-controller.ts` and `src/track/loop.ts`. That is a
   four-writer change plus a per-append lock cost on the hot event path, and it interacts with
   `EventStore`'s in-process `queue`. Not this slot's to make unilaterally — flagging for a future
   round, with the caveat that it should be measured (the append path is the run's hot loop).
2. **R3-10 docs sync.** `docs/status-matrix.md`'s privacy row and `docs/data-dictionary.md` still
   describe `delete --run` as a plain subtree removal. The accurate wording now is: the removal is
   verified, and a subtree that is back fails the delete with `RUN_RECORDS_SURVIVED` rather than
   reporting success. R3-10's current diff has not picked this up yet.
3. **Possible R3-9 follow-on (not requested):** if `main.ts` ever grows a `delete --run --force`,
   the terminal-event precondition becomes available as a second layer. It is deliberately *not*
   implemented as dead surface here.

Forbidden list respected: no live R1/bandit/topology, no Outcome-supported claim, ADR-006 untouched,
no auto-promote, no `package.json` or dependency edit, no unowned file edited, no commit.
