MODEL_SLUG: gpt-5.6-sol-xhigh-fast

# Round 2 — R2-gpt-B cost-stop tests

Status: done. No commit created; the parent orchestrator owns the round commit.

## Test file paths

- `test/unit/pi-adapter/cost-gate.test.ts`
  - Proves catalog-priced spend accumulates across turns and requests a stop
    only when the cumulative total reaches `maxCostUsd`.
  - Proves a zero/unknown catalog rate leaves spend undefined and never
    requests a stop, even for very large token usage.
- `test/integration/pi-adapter/cost-stop.test.ts`
  - Uses a faux provider with an explicit stub price catalog. The first
    tool-use turn exceeds the cap; Pi's installed `shouldStopAfterTurn` hook
    prevents the scripted second provider call and emits a `stopped` ledger.
  - Uses the same two-call script with a zero/unknown price catalog. The gate
    reports `disarmed: unpriced-model`, both provider calls run, and no
    fabricated `stopped` event appears.
- `test/unit/pi-adapter/kernel.test.ts`
  - Adds a structural stub-Agent assertion that `SparkleKernel` installs,
    invokes, and removes the stop-after-turn predicate.

## Probe

- `scripts/kernel-reuse-probe.mjs` now separately requires
  `PiAgentExecutor.steerText(text)` to forward to a live kernel. Current output
  has three PASS lines: live stream, kernel facade, and executor steer wiring.

No kernel public-surface redesign was made by this agent.

## Verification

- Focused test command over the three paths above: 8 passed, 0 failed.
- Focused ESLint over all three test files: passed.
- `node scripts/kernel-reuse-probe.mjs`: 3 PASS, exit 0.
- ESLint on `scripts/kernel-reuse-probe.mjs`: passed.
- `pnpm exec tsc --noEmit --pretty false`: passed with the concurrent Round 2
  implementation present.
