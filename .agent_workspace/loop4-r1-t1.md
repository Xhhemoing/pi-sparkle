[Model: claude-opus-5-thinking-high-fast]

# Loop 4 · Round 1 — T1: feedback log cooperative lock + fail-closed delete cascade

- **Slot:** T1 (`src/feedback/store.ts`, `src/privacy/deletion.ts`, `test/unit/feedback/store.test.ts`, `test/unit/privacy/deletion.test.ts`)
- **Branch:** `agent/opt-continuous`, working tree only — no commit, no push, no PR.
- **Verification run (the only one, as instructed):** `pnpm test -- test/unit/feedback/store.test.ts test/unit/privacy/deletion.test.ts` → **41 pass / 0 fail** (14 store + 27 deletion). Full `pnpm test`/`pnpm gate` deliberately not run: other slots are editing the same tree, and the 2 doctor baseline failures belong to T9.
- **Scoped checks:** `npx tsc --noEmit` reports zero errors in the four owned files (the errors it does print are in T4's `test/unit/episode/events-validate.test.ts` and T8's `test/unit/protocol/v1.test.ts`, both in flight); `npx eslint` clean on all four owned files.
- Diff: 4 files, +424 / −27.

## What landed

### `src/feedback/store.ts` — the lock the log never had

Mirrors `src/telemetry/invocation-log.ts` shape for shape:

- `feedbackLogLockPath(stateRoot)` → `adaptation/feedback/records.jsonl.lock`, with the doc comment stating both failure modes the lock closes (an append clobbered inside a rewrite's read→write window, and an append landing *after* the rewrite that puts free text back on disk under an id the cascade just tombstoned).
- `withFeedbackLogLock(stateRoot, operation, options?)` → thin wrapper over the untouched `withExclusiveFileLock`.
- Module-level `appendQueues: Map<string, Promise<void>>` — the in-process per-path append chain, so N concurrent appends in one process ask for the file lock one at a time instead of spinning on `EEXIST` against their own siblings, and in-process call order is preserved.
- `appendFeedback` now redacts (unchanged), then appends through the queue **under the lock**. Signature unchanged: `(stateRoot, record) => Promise<FeedbackRecord>`.
- `writeFeedbackRecords` gained the required "callers must already hold the lock (`withFeedbackLogLock`)" doc, exactly like `writeInvocationRecords`. Signature unchanged.
- `readFeedbackRecordsRaw(stateRoot, refusal = "refusing to use it")` — optional second parameter only (every existing call site still compiles and behaves the same). The corrupt-line message is now `corrupt feedback jsonl at line N of <path>; <refusal>`, matching `readInvocationRecords`, so a rejection says what the caller declined to do instead of being an anonymous parse failure that invites a `.catch(() => [])`.
- `readFeedback` untouched (signature, tombstone filter, class validation, legacy-row semantics all unchanged).

### `src/privacy/deletion.ts` — the cascade fails closed

- `cascadeFeedbackTombstones(stateRoot, episodeId, options: FileLockOptions = {})` (optional third parameter; the CLI call site in `main.ts` is untouched and unaffected) now:
  - returns `[]` **without taking a lock or creating the adaptation plane** when `records.jsonl` does not exist — the ENOENT no-op, mirroring `dropRunFromInvocationLog`'s `statExists` guard;
  - otherwise runs read → filter → `writeFeedbackRecords` → tombstone write **entirely inside `withFeedbackLogLock`**;
  - **no longer swallows read errors.** `readFeedbackRecordsRaw(...).catch(() => [])` is gone; the read is called with the refusal `"refusing to cascade an episode delete through it"`, so a corrupt line rejects with a `DomainValidationError` naming the line, the path, and the refusal. This was the fail-open privacy defect: `delete --episode` used to report success with zero cascade while the episode's feedback text stayed on disk.
- Strip-before-tombstone ordering kept verbatim (crash-safe direction per audit §4), and the reason is now written down in the function's contract comment rather than living only in the audit.
- **One change beyond the literal spec, disclosed:** `deleteEpisodeRecords` now runs the cascade *before* unlinking `runtime/episodes/<id>.{jsonl,events.jsonl,lock}` (the episode's own text is still read first, so the residual scan is unaffected). Without the move, a corrupt feedback log would fail the delete *after* the episode files were already gone — a half-delete reported as a failure. This is the same doctrine `deleteRunRecords` already documents and `"a corrupt middle line fails the run delete closed, before anything is unlinked"` already pins on the run side. `DeletionResult` shape, `removedPaths` contents, and idempotency are unchanged; the new ordering is pinned by a test.

Not changed, as required: `withExclusiveFileLock`, `appendJsonlLine`/`readJsonlObjects` signatures, the JSONL format, any record shape, any file name.

## Tests

`test/unit/feedback/store.test.ts` (+5, all 9 pre-existing still green):

1. `the write lock sits beside the log it guards` — `records.jsonl.lock`, derived from the log path, not a second copy of it.
2. `an append waits for the log lock instead of writing under another writer` — external holder; the log file does not exist for the whole 80 ms hold, the row lands after release, lock file removed.
3. `concurrent appends from one process all land, whole and in call order` — 12 parallel `appendFeedback` calls, exactly 12 rows, in issue order (pins the queue).
4. `a rewrite under the lock cannot clobber a concurrent append` — read → (append fired) → sleep → `writeFeedbackRecords`, all inside the lock; the appended row survives *whole* (parses, payload intact) and the filtered row is gone.
5. `the writer-side read names the corrupt line and what it is refusing to do` — exact message equality including line number, path and refusal; `readFeedback` still fails closed on the same file.

`test/unit/privacy/deletion.test.ts` (+6, all 21 pre-existing still green, including the two idempotency pins):

1. `the episode cascade waits for the feedback log lock` — external holder; log byte-identical during the hold, cascade completes after release, lock released.
2. `a cascade that cannot take the feedback lock fails closed and changes nothing` — holder never releases, cascade called with `{timeoutMs: 40, retryMs: 5}` → `DomainValidationError` / `timed out waiting for lock`, records file **byte-identical**, no `tombstones.json` created.
3. `feedback appended while the episode cascade runs survives whole` — `Promise.all([deleteEpisodeRecords, appendFeedback])`; deterministic in both interleavings: exactly 2 rows, the live row's body intact, the doomed row's `body`/`summary` stripped.
4. `a late append cannot resurrect stripped text through the read API` — the other side of the race: a post-cascade append under the tombstoned id is a new fact, invisible to `readFeedback`, and cleared by a second delete (the second delete reports the id once per row, which is what the cascade counts).
5. `a corrupt feedback line fails the episode delete closed, before anything is unlinked` — `deleteEpisodeRecords` rejects naming line 2 and the refusal; log byte-identical (no partial rewrite), no tombstone file, episode records still on disk, lock released.
6. `an episode delete with no feedback log is a no-op, not an adaptation-plane write` — ENOENT path returns `[]` and does not create `adaptation/`.

Contract regressions covered by the pre-existing suites that stayed green without edits: `readFeedback` tombstone filtering, redaction-class round-trip/validation, oversized-body drop, forward-field preservation, cascade strips every `FREE_TEXT_FEEDBACK_FIELDS` entry, summary-only cascade, repeat-delete idempotency, episode lock removal, and every `delete --run` invocation-log behavior.

## Residual / not done

- `pnpm gate` was not run (instructed): typecheck and lint were verified only for the four owned files, and the full suite still carries T9's 2 doctor baseline failures plus other slots' in-flight compile errors. Whoever integrates the round should run the gate once the tree settles.
- `appendFeedback` still has no lock-timeout knob (signature frozen this round), so it uses the 5 s `withExclusiveFileLock` default and *rejects* on timeout. Its live caller `src/learning/auto-loop.ts:251` awaits it — a delete cascade holding the lock past 5 s would surface as a failed auto-adapt persist rather than a dropped row. That is the same drop-window class T2 is fixing for invocation telemetry; the feedback side is not wired to a bounded-retry sink and is left honest rather than silently swallowed.
- Cross-process appends still poll the file lock (the queue is in-process only), unchanged from the invocation-log design.
- A crash-truncated *final* line in `records.jsonl` is dropped by the cascade's rewrite, matching the invocation rewrite's documented behavior; not separately pinned here (T10's crash probe owns real-kill coverage).
- No perf claim is made: this slot is correctness/fail-closed only. Nothing here is Outcome-supported, nothing touches live R1/bandit/topology, ADR-006 stays Proposed, no auto-promote, no `package.json` change, no git history rewrite.
