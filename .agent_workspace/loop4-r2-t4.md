[Model: claude-opus-5-thinking-high-fast]
# Loop 4 Round 2 — R2-4 (feedback append drop-window parity)

## Decision (pinned by test)

**A terminal feedback drop warns; it does not fail the loop iteration.** Only the
lock-timeout class degrades to a warning — every other persist failure still rejects.

Why warn: by the time `runAutoAdaptLoop` runs, the run is over and the diagnosis is
already computed from in-memory signals. The only cause of a terminal drop is another
writer (the episode-deletion cascade) holding `records.jsonl.lock` past the retry
budget. Failing the iteration would discard the bandit update and the candidate
proposal to punish a contention window nobody can act on, and `pi run` would print
`adapt skipped` for a run that adapted fine.

Why the warning is not silence: the loss is reported three ways — `feedbackDropped`
counts it, `feedbackDropReasons` names each row and the blocking lock, and `reason`
(the one field both CLI surfaces already print) carries the count as
`(warning: N feedback rows dropped, feedback-log lock timeout)`. No non-owned file
had to change for the disclosure to reach an operator.

Why non-lock-timeout failures still reject: a redaction/validation failure or a real
I/O error (`EACCES`, `ENOSPC`, log path is a directory) means the record or the state
root is broken. Retrying cannot fix it and degrading it to a warning would hide an
unwritable state root on every single run. This is a deliberate divergence from
`createInvocationSink`, which swallows everything because it sits on the live executor
path; the *retry classification* mirrors it exactly (lock timeout retried, validation
never retried), the *terminal disposition* does not.

## Changed

`src/feedback/store.ts` (additive only; T1 lock/cascade contracts untouched)
- `appendFeedback(stateRoot, record, options?: FileLockOptions)` — optional third
  argument, forwarded to `withFeedbackLogLock`. Defaults unchanged (5 s / 10 ms), so
  every existing two-argument caller and the cascade's `withFeedbackLogLock` /
  `writeFeedbackRecords` contract behave exactly as before.
- `appendFeedbackWithRetry(stateRoot, record, options?)` → `FeedbackAppendOutcome`
  (`{status:"persisted",record}` | `{status:"dropped",reason}`). Bounded retry
  (default 3 tries / 50 ms backoff), `onDrop` reporter that cannot re-throw into the
  caller, and a per-log-path retry queue mirroring the sink's `sinkQueues` so a
  retrying row still lands ahead of rows queued after it.
- `isLockTimeout` is the same exact-message classifier T2 uses, scoped to this log's
  lock path. It is intentionally not coupled to R2-2's in-flight `FileLockTimeoutError`
  (that slot may or may not land); the doc comment records that a typed discriminator
  carrying the lock path should replace this classifier and the invocation log's
  together. Verified against R2-2's current working-tree state: the timeout message is
  unchanged, so the classifier holds either way.

`src/learning/auto-loop.ts`
- `AutoAdaptInput.feedbackPersist?: FeedbackAppendRetryOptions` (also forwarded by
  `runAutoAdaptFromEvents`) — retry budget plus the sleep/onDrop seams tests use.
- `AutoAdaptResult` gains `feedbackPersisted`, `feedbackDropped`, `feedbackDropReasons`.
  `collected` keeps its meaning (what was observed); the new fields say what observation
  kept, so the two are no longer conflated.
- `persistSignals` returns a summary and appends via `appendFeedbackWithRetry`;
  `discloseDrops` folds the count into `reason` on all four return sites.
- No signature was broken: all additions are optional inputs or new result fields.

## Tests

`test/unit/feedback/store.test.ts` (+5)
- `appendFeedback honours a caller's lock timeout instead of waiting the default out`
  — pins the additive third argument and that a timed-out append writes nothing.
- `a retried append lands once the lock clears inside the budget` — sleep seam releases
  the held lock at the backoff (attempt 1 has provably timed out), so "cleared between
  attempts" is deterministic; exactly one backoff, no drop, row on disk.
- `a lock held past the budget drops the row honestly instead of rejecting` — resolves
  with `{status:"dropped"}`, two backoffs for three tries, `onDrop` fires once, the
  reason names the record and the lock, and the log is byte-identical.
- `a failure that is not a lock timeout is never retried and still rejects` — a
  directory at the log path (EISDIR) rejects with zero backoffs and zero drops.
- `a retrying row still lands ahead of the rows queued after it` — retry-queue ordering.

`test/unit/learning/auto-loop.test.ts` (+4)
- `a feedback lock held past the retry budget warns, and the iteration still adapts`
  — the pinning test for the decision: the loop resolves, `feedbackPersisted: 0`,
  `feedbackDropped: 2`, reasons match the result's, `reason` carries the warning, no
  row reached the log, and the iteration still diagnosed and wrote the bandit.
- `a feedback lock that clears inside the budget costs nothing but a retry` — one
  backoff, zero drops, both rows persisted, no `warning:` in `reason`.
- `a persist failure that is not lock contention still fails the iteration` — EISDIR
  rejects out of the loop and no bandit file is written.
- `a run with no project snapshot reports zero persisted and zero dropped` — the new
  counters are present on the early-return path too.

## Verification (this VM, Node v22.14.0)

- `npx tsx --test test/unit/learning/*.test.ts test/unit/feedback/*.test.ts` — 113 pass,
  0 fail. Timing-sensitive subset (`auto-loop.test.ts` + `store.test.ts`) run 3×:
  31 pass / 0 fail each time.
- `npx eslint src/learning/auto-loop.ts src/feedback/store.ts test/unit/learning test/unit/feedback/store.test.ts` — clean.
- `npx tsc --noEmit -p tsconfig.json` (whole tree) — clean. An earlier run showed
  errors in `src/run/flowchart-run.ts` from R2-1's concurrent edits in this shared
  working tree; they cleared on their own and are not from these files.
- Neighbour sanity (not owned, not edited): `test/unit/privacy/deletion.test.ts` 32 pass
  (T1 cascade contracts intact), `test/integration/m3/redaction.test.ts` 2 pass.
- Full gate not run — parent's job, per the brief.

## Notes and residual risk

- Not committed, per instructions.
- Retry budget default is 3 tries × 50 ms ≈ one extra 5 s lock wait per attempt in the
  worst case; a cascade longer than ~15 s of held lock still drops. That ceiling is
  disclosed, not hidden, and the drop is counted per row.
- `feedbackDropReasons` grows with the number of dropped rows in one call, which is
  bounded by the signals already held in memory for that call.
- If R2-2's typed lock-timeout discriminator lands, `store.ts`'s `isLockTimeout` and
  `invocation-log.ts`'s should migrate together; nothing here blocks that.
- No live R1/bandit/topology on the execution path, no Outcome-supported claim, no
  ADR-006 status change, no auto-promote (unchanged: `autoPromote` is still ignored),
  no `package.json` edits.
