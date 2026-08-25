MODEL_SLUG: gpt-5.6-sol-xhigh-fast

# Round 1 — R1-gpt-B

## Writes

- Added `test/unit/pi-adapter/translate-thinking.test.ts`.
- Added `test/unit/pi-adapter/kernel.test.ts`; `src/pi-adapter/kernel.ts` existed,
  so the kernel tests were not skipped.
- The thinking translation test verifies a `thinking_delta`-like event becomes
  `THINKING_DELTA`, reports a positive byte count, and does not expose the raw
  thinking string through serialization.
- Kernel coverage exercises lifecycle forwarding, state/session access,
  steering and follow-up message construction, subscriptions, and the async
  event queue's live/buffered close behavior.

## Tests

- `pnpm exec tsx --test test/unit/pi-adapter/translate-thinking.test.ts`:
  1 passed, 0 failed.
- `pnpm exec tsx --test test/unit/pi-adapter/kernel.test.ts`:
  3 passed, 0 failed.
