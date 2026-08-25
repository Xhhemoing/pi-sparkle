[Model: gpt-5.6-sol-xhigh-fast]
# Loop 4 Round 9 — R9-10

## Census
- `test/unit/run/event-row-fuzz.test.ts` already pins unknown-key refusal, validates omission of optional `retryNodeId`, and retains the existing three-key seed.
- `test/unit/run/replay.test.ts` already asserts `TERMINAL_REPLAY_STATUSES` is exactly `BLOCKED`, `COMPLETED`, and `FAILED`.
- The same replay test already asserts that `EVENT_TYPES` contains `RUN_UNBLOCKED`.

## Change
- Added only the named test `RUN_UNBLOCKED payload type is frozen to its three allowed keys` to `event-row-fuzz.test.ts`.
- Its bidirectional type equality freezes `keyof` the `RUN_UNBLOCKED` payload to `blockedEventId | reason | retryNodeId`; adding a fourth typed payload key makes whole-tree typechecking fail.
- Did not alter the fuzz seed, `src/**`, or `package.json`.

## Verification
- `pnpm exec eslint test/unit/run/event-row-fuzz.test.ts` — pass.
- `pnpm exec tsc --noEmit` — pass.
- `pnpm test -- test/unit/run/event-row-fuzz.test.ts` — pass, 5/5 tests. The command emitted the pre-existing Node engine warning (`22.14.0` running; package requests `>=22.19.0`).

## Workspace note
- Final status also showed concurrent modifications in `test/unit/routing/live-isolation.test.ts` and `test/unit/run/flowchart-run-abort.test.ts`; R9-10 did not touch them.
