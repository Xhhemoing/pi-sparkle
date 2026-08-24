MODEL_SLUG: claude-opus-5-thinking-high-fast

# Round 2 — R2-opus-B: `shouldStopAfterTurn` from accumulated cost vs `maxCostUsd`

Target 2 in `R1-KERNEL-BRIEF.md`: `maxCostUsd` was validated in `src/domain/limits.ts`
and enforced nowhere. It is now enforced inside the adapter, on the one condition
that the spend can actually be accounted for.

## What landed

**`src/pi-adapter/cost-gate.ts` (new).** The arithmetic, separated from the executor
so the rule is readable and testable on its own.

- `catalogPrices(cost)` reads USD-per-MTok off a resolved model's `cost` block —
  the same numbers `listed-model.ts` surfaces (`model.cost.input` / `.output`).
  No new price source, no fallback rate, no estimate.
- `CostGate` accumulates provider-reported tokens per finished turn, prices them,
  and answers `exceeded`. `requestStopIfExceeded()` latches `stopRequested` so the
  caller can tell afterwards that the ceiling, not the model, ended the run.
- Disarmed states are named, not silent: `no-cap`, `invalid-cap` (a ceiling that
  is not a positive finite number), `unpriced-model`. A disarmed gate returns
  `spentUsd: undefined` and never stops anything.
- `ledger` reports `turnsWithoutUsage`. A nonzero count means `spentUsd` is a
  floor, not a total — spend the ceiling could not see.

**`src/pi-adapter/kernel.ts`.** `SparkleKernel.setStopAfterTurn(predicate)` plus the
`stopAfterTurn` constructor option. `SparkleKernelAgent` gains
`shouldStopAfterTurn?: ((...args: never[]) => boolean | Promise<boolean>)`. The
`never[]` is load-bearing: the loop passes its turn context here, and naming that
context would put a Pi type on an exported signature (ADR-001). A hook that ignores
its arguments is assignable to the richer signature Pi declares, and `tsc` checks
that at the `new Agent(...)` call site, where the structural match is made.

**`src/pi-adapter/pi-executor.ts`.**

- `buildCostGate(request, model)` per `execute()`: ceiling from
  `request.maxCostUsd ?? options.maxCostUsd`, prices from the resolved model.
- Usage is folded into the gate inside the `subscribe` listener, not off the
  drained queue — the loop consults the stop predicate immediately after it emits
  `turn_end`, and the queue consumer may not have been scheduled yet.
- The predicate is installed only when the gate is armed; an unpriced run does not
  carry a hook that can never fire.
- `runWithRetry` re-checks the gate before each retry. A retry is a fresh `Agent`,
  so the predicate installed on the last one cannot hold the line, and a failing
  task would otherwise keep buying attempts past its budget.
- The synthesized `TASK_RESULT` summary becomes `"pi agent stopped at the cost
  ceiling"` when the gate tripped, so a budget-truncated task does not read like a
  completed one.
- `onCostGate?: (event: CostGateEvent) => void` — `{ kind: "disarmed", reason }`
  when a requested ceiling could not be enforced, `{ kind: "stopped", ledger }`
  when one ended a run. No event at all when no ceiling was requested.

**`src/execution/contract.ts`.** `AgentExecutionRequest.maxCostUsd?: number`
(additive, optional). The doc comment says executors that cannot price their own
spend ignore it rather than guess.

**`src/pi-adapter/index.ts`.** Exports the new surface.

## The honesty rule this is built around

If the catalog quotes no usable price, the gate disarms, reports
`reason: "unpriced-model"` through `onCostGate`, and the run continues uncapped.
No USD figure is produced for an unpriced model — `spentUsd` is `undefined`, not
zero — and nothing claims the ceiling was honored.

An all-zero `cost` block counts as unpriced, not free: `runtime.ts` fills an
unspecified custom-provider rate with `0`, so a zero pair cannot be told apart from
a model nobody priced. This is why the faux provider (`cost` all zeros) disarms the
gate by default.

Two deliberate divergences, both commented at the site:

1. The gate counts reported usage regardless of the turn's eventual outcome, unlike
   `sumUsage`'s cost-eligibility rule. That rule exists to keep per-token averages
   from being dragged toward zero by error payloads; a ceiling asks a different
   question, and tokens a provider reported before a stream failed are tokens it
   will still bill. All-zero usage never reaches the gate — `translatePiEvent`
   drops it — so an error payload's zeroed block adds nothing.
2. A gate trip does not change `EXECUTION_FINISHED.outcome`. `shouldStopAfterTurn`
   fires at a turn boundary that may well have been the last one anyway, so
   "capped" does not imply "unfinished". The summary text carries the fact instead.

## Verification

Ran an offline probe (faux provider, model priced by hand, scripted tool calls) to
confirm the hook is really installed and consulted by the live loop, then deleted it:

- uncapped, 3 scripted turns: 3 provider calls, 3 `TURN_FINISHED`, 2 tools.
- `maxCostUsd` tripped after turn 1: **1 provider call**, 1 `TURN_FINISHED`, the
  in-flight tool still completed, summary `"pi agent stopped at the cost ceiling"`,
  one `onCostGate` `stopped` event with the ledger.
- unpriced model + ceiling: run completes normally, one `disarmed` /
  `unpriced-model` event, no stop.
- no ceiling: no events, no behavior change.

Committed test: `test/unit/pi-adapter/cost-gate-ledger.test.ts` — 14 tests, the
`CostGate` arithmetic and disarm reasons plus the kernel's stop-hook seam. Named
`-ledger` to stay clear of R2-gpt-B, who owns the executor-level stop-after-turn
tests; that file is not touched here.

- `pnpm exec tsc --noEmit --pretty false` — clean.
- ESLint on every touched file — clean.
- `node scripts/run-tests.mjs` — 1441 pass, 0 fail, 2 skipped.
- `test/unit/pi-boundary.test.ts` — passes; no Pi type reaches an exported
  signature outside the adapter.

## Notes for R2-gpt-B

- The faux model's `cost` is a mutable plain object:
  `models.getModel("faux","faux-1").cost.input = 1000` prices it, which is how the
  probe above armed the gate. The alternative is a `createProvider` custom provider
  with `inputCostPerMTok` set, matching `runtime.ts`.
- Faux reports ~10 input / ~1 output tokens for a bare prompt, so a ceiling around
  `0.001` USD at `cost.input = 1000` trips after the first turn.
- Use `onCostGate` to assert; there is no new `ExecutionEvent` variant, so the
  execution stream is unchanged apart from the `TASK_RESULT` summary text.

## Left open (not mine to write)

Nothing sets `request.maxCostUsd` yet, so a real run still does not carry its
ceiling to the executor. `src/run/coordinator.ts` has `input.limits` in scope where
it builds the request (~line 149); the missing line is:

```ts
...(input.limits?.maxCostUsd !== undefined ? { maxCostUsd: input.limits.maxCostUsd } : {})
```

The same applies to `child-coordinator.ts` (~line 507) and `flowchart-executor.ts`.
I did not touch those: my scope was `src/pi-adapter/**`, and R2-opus-A is editing
`coordinator.ts` for `RunningRun.steer` in this same worktree. Until that line
lands, the claim is "the adapter enforces a ceiling it is given", not "runs are
capped". Do not upgrade the docs past that.

Also unwritten: `ModelInvocation.pricing` is still never populated, so the prices
the gate used are not recorded on the invocation. Filling it needs a
`catalogVersion` the codebase does not yet mint.

No commit.
