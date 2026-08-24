gpt-5.6-sol-xhigh-fast
# Loop 4 Round 3 — R3-4 run-event decoder discipline

## Result

- `EventStore.readAll()` now raises exactly `DomainValidationError` for a
  malformed non-final JSONL line. The existing message and the frozen
  `readJsonlObjects` signature are unchanged.
- Added deterministic xorshift32 event-row fuzzing with seed `0x4f330004`.
  All 34 event types have conforming seeds and 120 bounded structured
  mutations apiece. Accepted rows revalidate identically and replay
  deterministically; every rejection must be exactly
  `DomainValidationError`.
- Added 180 corrupted-middle-row `EventStore.readAll()` iterations spanning
  malformed JSON text and semantically mutated JSON values. Successful reads
  are re-read, revalidated, and replayed.
- Added the named regression
  `corrupt middle event-log lines fail with exactly DomainValidationError`.

No `validateEvent` or `replayRun` error-discipline defect surfaced, so
`src/run/events.ts` and `test/unit/run/events.test.ts` required no change.

## Verification

- Owned tests: PASS — 8 tests, 0 failures, 0 skips.
- Scoped ESLint across all four owned paths: PASS.
- Whole-tree `tsc --noEmit`: PASS after the concurrent shared-tree edit
  settled.

No dependency, package-manifest, frozen JSONL-signature, or forbidden-plane
changes were made. No commit was created.
