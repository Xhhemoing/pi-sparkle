[Model: claude-opus-5-thinking-high-fast]

# Loop 4 · Round 2 · R2-3 — `delete --episode` no longer removes a live lock

Slot: R2-3 (P2, privacy/races). Branch `agent/opt-continuous`, **not committed** (per instruction).

| File | Change |
|---|---|
| `src/privacy/deletion.ts` | `deleteEpisodeRecords` gained an additive `options: FileLockOptions = {}`; the unlink moved into a new private `unlinkEpisodeFiles` that acquires `episodeLockPath(stateRoot, episodeId)` via `withExclusiveFileLock` before touching anything; the lock file is no longer unlinked by hand; `readEpisodeText` moved inside the lock |
| `test/unit/privacy/deletion.test.ts` | old `delete --episode removes the episode's cooperative lock` replaced by six tests pinning the acquire-then-unlink discipline (incl. a two-way lock-path pin) |

Nothing else was touched. `src/run/episode-bind.ts` is imported only (`episodeLockPath`), never edited; `src/persist/file-lock.ts` untouched (R2-2 owns it this round).

## The defect

`deletion.ts:168-187` unlinked `runtime/episodes/<id>.{jsonl,events.jsonl,lock}` with no lock held. After T4 both episode writers (CLI `episode close`, run-side `settleBoundEpisode`) serialize their read-decide-append on `<id>.lock`, so the delete had two ways to lose:

1. A settle that is mid read-decide-append writes its snapshot **after** the unlink — the deleted episode is back on disk, and the operator was told the delete succeeded.
2. Unlinking `<id>.lock` under a live holder lets a second writer `open(lockPath, "wx")` immediately, so two writers run the same critical section — precisely the interleaving T4 closed.

## The change

```
cascadeFeedbackTombstones(...)        // unchanged, still first, still fails closed
  ↓
unlinkEpisodeFiles(...)               // NEW: bounded acquire of <id>.lock, then
                                      //      read episode text, then unlink the
                                      //      two record files, then release
  ↓
findResidualEpisodeText(...)          // unchanged
```

- **Bounded / fail-closed.** Acquisition uses `withExclusiveFileLock` with the caller's `FileLockOptions` (defaults 5 s / 10 ms). A timeout throws the standard `DomainValidationError` (R2-2's in-flight `FileLockTimeoutError` is a subclass with the same message, so both the class check and the message pin hold either way) and **nothing is unlinked**.
- **No lock nesting.** The feedback cascade takes `records.jsonl.lock`, finishes, and only then is the episode lock taken. Holding the episode lock across the cascade would make `episode close` wait on an unrelated file and would invent a lock order no other writer is bound by. Disclosed cost, pinned by a test: a delete that strips the feedback text and then cannot take the episode lock leaves the episode's own files in place. That is the privacy-safe half to have completed (text gone, shells intact) and the re-delete is idempotent.
- **The lock file is no longer unlinked by hand.** Releasing the lock removes it, so a completed delete still leaves no `<id>.lock` behind. It is therefore **no longer listed in `removedPaths`**: after a successful acquire the file provably did not pre-exist, so claiming the delete "removed" a file it created itself would be false. `DeletionResult`'s shape, `target`, `droppedInvocations`, `cascadedFeedbackTombstones` and `residualEpisodeTextRunIds` are unchanged; the CLI's `removed:` lines for an episode delete lose the `.lock` line and keep both record lines.
- **No-op stays a no-op.** With no records *and* no lock on disk the function returns early: no lock taken, `runtime/episodes/` not created. A lock present with no records is *not* a no-op — that is a live writer, so the delete waits for it and then removes whatever it wrote (pinned).
- **Text read under the lock.** `readEpisodeText` now runs inside the critical section, immediately before the unlink, so the residual scan seeds off exactly the text being deleted rather than a pre-lock snapshot.

## Disclosed behaviour change (needs an operator-facing note)

No-steal is the repo's deliberate posture, and it now applies to `delete --episode`: **a lock left behind by a killed holder makes the delete fail** (`timed out waiting for lock at …/<id>.lock`) until an operator removes the file, where previously the delete silently unlinked it. From outside the process a stale lock is indistinguishable from a writer that is about to write the records back, so failing is the honest outcome, and it matches the manual-cleanup recovery R2-6 crash-probes for this same lock.

Two artifacts owned by other slots now describe the old behaviour and should be trued up by their owners (I did not edit them):
- `src/privacy/record-classes.ts:86-89` — "Variant file shapes … all removed by delete --episode: … `<id>.lock`". Still true for the success path (release unlinks it), but it is no longer an unlink the delete performs.
- `docs/data-dictionary.md:150-155` (R2-10) — "the episode `.lock` previously survived deletion" reads as though the fix is the hand-unlink.

## Tests (owned file, all six new ones asserted against real locks)

1. `delete --episode waits for a live holder before unlinking the episode records` — external `withExclusiveFileLock` holder; the delete is fired mid-hold, both record files are still present 80 ms later, and after release `removedPaths` is exactly the two record files and the lock is gone.
2. `an episode delete that cannot take the episode lock fails closed` — holder + `{timeoutMs: 40, retryMs: 5}`: rejects with `DomainValidationError`, message matches `/timed out waiting for lock/` **and contains the episode lock path**, both record files byte-identical; then pins the disclosed half-way point (feedback text already stripped) and that the retry after release completes and re-asserts the tombstone.
3. `a completed episode delete leaves no lock behind and does not report one` — lock absent afterwards, `removedPaths` deep-equals the two record files and does **not** include the lock path; the second delete returns `removedPaths: []` with no new lock (idempotency).
4. `a delete of an episode with nothing on disk creates neither the directory nor a lock` — `runtime/episodes/` is not created.
5. `a delete that waits on a live writer removes the records that writer just wrote` — holder writes `<id>.jsonl` *inside* the hold; the waiting delete removes it. This is the anti-"nothing found" case for a records-free lock.
6. `the delete serializes on the same lock file the episode writers take` — direct path equality plus a source pin that `deletion.ts` imports `episodeLockPath` from `../run/episode-bind.js` and does not rebuild a `${episodeId}.lock` template.

T1's cascade tests are untouched and green, including `a corrupt feedback line fails the episode delete closed, before anything is unlinked` (the cascade still throws before any lock is taken).

**Negative check (mutation):** with the `withExclusiveFileLock` call in `unlinkEpisodeFiles` replaced by a direct call of the body (old behaviour), tests 1, 2 and 5 go red — `# pass 29 / # fail 3`. Source restored and re-verified green afterwards.

## Verification on this VM (Node v22.14.0, pnpm 10.17.1)

| Check | Result |
|---|---|
| `npx tsx --test test/unit/privacy/deletion.test.ts` | 32/32 pass |
| `npx tsx --test test/unit/privacy/*.test.ts test/integration/cli/delete.test.ts test/unit/run/episode-bind.test.ts` | 72/72 pass, 0 fail (CLI delete integration + T4's episode-bind suite included because they exercise this path) |
| `npx eslint src/privacy/deletion.ts test/unit/privacy/deletion.test.ts` | clean, exit 0 |
| `npx tsc --noEmit` (whole tree) | **5 errors, all in `src/run/flowchart-run.ts`** — R2-1's uncommitted in-flight work in this shared tree, not mine: the failing type `RunAbortScope` does not exist at `HEAD` (`git grep RunAbortScope HEAD -- src` → no hits). No error in any other file. |

Full gate not run (parent's job, as instructed).

## Risks / notes for the parent

- The shared working tree currently carries eight other slots' uncommitted edits (`file-lock.ts`, `feedback/store.ts`, `flowchart-run.ts`, …). My test runs were made against that live tree, so they include R2-2's lock changes and R2-4's feedback changes as they stood; the gate must be re-run once the tree settles.
- `deleteRunRecords` deliberately did **not** get the same `options` parameter — out of scope for this slot.
- Not done here: live R1, Outcome-supported claims, ADR-006 status, auto-promote, `package.json`, docs, or any cosmetic edit.
