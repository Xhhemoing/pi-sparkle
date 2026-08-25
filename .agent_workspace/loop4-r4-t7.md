[Model: gpt-5.6-sol-xhigh-fast]

# Loop 4 · Round 4 · R4-7 — Crash-atomic feedback tombstones

Implemented the owned half of the tombstone atomicity change:

- `writeFeedbackTombstones(stateRoot, tombstones, options?)` now publishes sorted, pretty JSON plus the existing trailing newline through `writeFileAtomic`. Its optional `AtomicWriteOptions` is the deterministic rename seam; the on-disk bytes are identical to the current deletion writer.
- `readFeedbackTombstoneIds` converts unparseable JSON into exactly `DomainValidationError` (`malformed feedback tombstones.json: not valid JSON`). Invalid parsed shapes retain the existing typed error.
- Unit pins cover the direct tombstone reader and `readFeedback`, exact error class, sorted bytes, complete staging, and the old destination remaining visible until rename.
- The feedback-row fuzz plane no longer has an unowned escape hatch: both former `skipUnowned` paths now call `failFuzz`, and the unused skip helper/context import are gone.
- The existing `feedback-cascade-strip-before-tombstone` crash-probe case now uses the atomic rename seam instead of a FIFO around the plain writer. In the killed child it publishes the stripped feedback rewrite while holding the feedback lock, stages the complete tombstone update, then self-SIGKILLs before rename. The parent proves the complete old tombstones remain readable, the target is not tombstoned, stripped feedback and the unrelated row survive, and only the unique temp contains the complete candidate tombstones. Keeping the established case name/census also keeps the integration census green.

R4-1 coupling intentionally remains: `src/privacy/deletion.ts` is exclusively owned by R4-1 and still needs its one-line writer swap to `await writeFeedbackTombstones(stateRoot, tombstones)`. This helper preserves that call site's current bytes. I did not edit the unowned file.

Verification:

- Owned unit tests, three consecutive runs: 28/28 pass, 0 fail, 0 skip each run.
- `node scripts/crash-probe.mjs`: `ok: true`, 8 cases × 3 iterations.
- Crash-probe integration census: 1/1 pass.
- Scoped ESLint over all four owned code/test files: pass.
- Whole-tree `npx tsc --noEmit`: pass. An initial run saw a transient error in the unowned in-progress `test/unit/run/zz-scratch-r44.test.ts`; the clean retry completed with zero diagnostics.
- Owned `git diff --check`: pass.

The R2-4 retry/drop contracts remain unchanged and were exercised in all three `store.test.ts` runs. Stayed on `agent/opt-continuous`; no commit was created.
