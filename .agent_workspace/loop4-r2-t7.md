[Model: gpt-5.6-sol-xhigh-fast]
# Loop 4 Round 2 — R2-7 persistence-row fuzz

## Result

Added `test/unit/persist/row-fuzz.test.ts`, a dependency-free, deterministic
xorshift32 mutation fuzzer with seed `0x4f320007`. Each target has a 5-second
test timeout; the scoped file completes in under one second on this VM.

Covered persistence boundaries:

- all four `validateEpisodeEvent` variants;
- `pause.json` parsing through the public file pause controller;
- checkpoint JSON parsing plus `validateCheckpoint`;
- feedback JSONL row loading and canonical reloading;
- invocation-record validation.

Accepted values are decoded again and compared (or validated again for the
void invocation validator). Rejections must be exactly `DomainValidationError`;
checkpoint's existing documented malformed-JSON contract additionally permits
exactly `SyntaxError`. Structural mutations include deletion, replacement,
root-type changes, bounded array growth, semantic corruption, nesting,
unknown/prototype-named keys, and malformed/truncated JSON text. Every
unexpected failure includes the seed and iteration.

## Finding and ownership boundary

- **SKIPPED — unowned invocation-row validator error-discipline defect:** seed
  `0x4f320007`, iteration 11 replaces `config` with `null`; `validateInvocation`
  escapes with `TypeError: Cannot read properties of null (reading
  'provider')` instead of `DomainValidationError`. The test emits a named skip.
  `src/telemetry/invocation-log.ts` and the underlying telemetry decoder were
  not patched because they are owned by R2-2.
- Feedback-row fuzz completed without a non-`DomainValidationError`; no
  `src/feedback/store.ts` edit was made.
- No defect surfaced in the two fix-authorized modules, so
  `src/episode/events.ts` and `src/run/pause-controller.ts` remain unchanged.

## Verification

- `pnpm test -- test/unit/persist/row-fuzz.test.ts` — PASS: 5 tests, 4 pass,
  1 named skip, 0 fail; 450 ms test duration.
- `pnpm exec eslint test/unit/persist/row-fuzz.test.ts` — PASS.
- `pnpm typecheck` — PASS (whole-tree `tsc --noEmit`).

No dependency, package manifest, or production-source changes were made.
