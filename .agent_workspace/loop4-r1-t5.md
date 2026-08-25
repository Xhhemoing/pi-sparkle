[Model: claude-opus-5-thinking-high-fast]

# Loop 4 · Round 1 — T5 slot report

**Slot:** T5 — pi-executor: honor pre-aborted signals, close the abort race
**Branch:** `agent/opt-continuous` (working tree only — no commit, no push, no PR)
**Metric class:** correctness / fail-closed. **No performance claim.**

## Files touched (exclusive ownership, nothing else)

| Path | Status |
|---|---|
| `src/pi-adapter/pi-executor.ts` | modified |
| `test/unit/pi-adapter/executor-abort.test.ts` | new |
| `test/unit/pi-adapter/executor-retry.test.ts` | modified (one added assertion) |

No other file in the repo was edited. `git status` confirms the other modified paths belong to concurrent slots (T1–T4, T6…), not to this one.

## Problem restated (from the audit, fable §9)

`runAttempt` guarded cancellation with `signal.addEventListener("abort", …)` alone. Per AbortSignal semantics that listener **never fires for an already-aborted signal**, and neither `execute` nor `runAttempt` checked `signal.aborted` up front. `runWithRetry` checked only *after* a backoff sleep. Consequence: an executor reached after its run was cancelled — a parent aborting while the child sat in the concurrency queue — constructed an Agent and ran a full provider call. Real spend and real latency charged to a dead run.

## Change

**(a) `execute` short-circuits a pre-aborted signal.** The first statement after `startedAtMs` is a `signal.aborted` check. When it fires, the executor records the invocation (`callOutcome: "cancelled"`, `tokensIn`/`tokensOut` undefined, `attempt: 1`, `latencyMs` = `Date.now() - startedAtMs` ≈ 0, config from `resolveIdentity`) and emits its terminal events. **No `resolveModel`, no `new Agent`, no `streamFn`.** Because the identity now comes from `resolveIdentity` rather than `resolveModel`, a cancelled run with an unresolvable model reports `CANCELLED` instead of `FAILURE`; cancellation is the more truthful terminal state and this path is aborted-only, so no live non-aborted behavior moves.

**(b) `runWithRetry` checks `signal.aborted` before every attempt.** The loop head now returns the last observed run instead of entering `runAttempt`. To keep the return shape honest a `latest: RetriedRun` accumulator holds the most recent failed attempt's number/events/failure, so an early return still reports the attempt that actually ran (never a phantom attempt N+1). The pre-existing post-sleep check is retained verbatim, so the returned tuple for every previously reachable path is byte-identical.

**(c) `runAttempt` re-checks after registering the listener.** Immediately after `addEventListener("abort", onAbort, { once: true })` the code re-reads `signal.aborted` and calls `agent.abort()` when it is set. Nothing can run between the two statements, so the listener path and this path are mutually exclusive: `agent.abort()` happens **exactly once**, never twice.

Untouched by design: retry classification (`classifyProviderFailure` / `decideRetry` / `resolveRetryPolicy`), usage honesty (`usageIsTrustworthy === callOutcome === "ok"`, the all-zero filter), and Pi event translation.

One refactor rides along, purely mechanical: the tail of `execute` (replay collected events → synthesize a `TASK_RESULT` when the agent produced none → `EXECUTION_FINISHED`) moved into a private `finish()` generator, and the invocation-sink call into `reportInvocation()`. Both the normal and the short-circuit path go through them, so the emitted event sequence for a cancelled run is the same two events (`MESSAGE` with `outcome: "CANCELLED"`, then `EXECUTION_FINISHED / CANCELLED`) that the old code already produced when the aborted attempt collected nothing. Downstream `child-coordinator` handling of `executorOutcome === "CANCELLED"` therefore sees no shape change.

## Tests

New file `test/unit/pi-adapter/executor-abort.test.ts`, 6 tests. The harness wraps real `createModels()` + the faux provider in a counting `Proxy` (methods bound to the underlying instance so its private state stays reachable) that counts **provider stream calls** and **catalog lookups** — the two observable proxies for "did this cost anything" and "was an Agent built".

1. *pre-aborted signal → nothing is paid for*: `streamCalls === 0`, `faux.state.callCount === 0`, `modelLookups === 0`, outcome `CANCELLED`, event types exactly `["MESSAGE", "EXECUTION_FINISHED"]`, no retries, no sleeps.
2. *pre-aborted invocation honesty*: exactly one record, `isInvocation` true, `callOutcome: "cancelled"`, `tokensIn`/`tokensOut` undefined, `attempt: 1`, config provider/model preserved, `latencyMs <= 50`.
3. *pre-aborted without an invocation sink*: still `CANCELLED`, still zero stream calls (the sink is optional, the short-circuit is not).
4. *abort between attempts*: the injected `sleep` aborts the controller mid-backoff after a retryable 429 — one stream call, one recorded wait of 10 ms, outcome `CANCELLED`, invocation `attempt: 1` / `cancelled` / undefined usage.
5. *abort racing listener registration*: the controller aborts synchronously on the provider's first tick of the stream call — one stream call only (the 429 is **not** retried), outcome `CANCELLED`, zero `onRetry` callbacks.
6. *uncancelled control*: 429 → retry → success still yields `SUCCESS`, two stream calls, `callOutcome: "ok"`, `attempt: 2`. This is the "no behavioral change for non-aborted paths" pin.

`test/unit/pi-adapter/executor-retry.test.ts`: all eight existing pins (429 retry, Retry-After, remedy_hint, attempt cap, auth-never-retried, 503/504, clean first call, cancelled run) and both usage-integrity pins are unchanged and green. One assertion was **added** to the existing cancellation test — `callCount() === 0`, "a run cancelled before it started must not be paid for" — so the retry suite itself now pins zero spend after cancellation.

### Negative control (the tests are real)

Verified by temporarily disabling the guards in the source and re-running, then restoring:

| Disabled | Result |
|---|---|
| (a) only | 1 test red — `modelLookups` is 1: the Agent/model resolution still happens. Stream calls stay 0 because (b) already blocks the attempt. |
| (a) + (b) | 2 tests red — the provider is actually called for a cancelled run, which is the original defect reproduced. |

Both edits were reverted; the file now contains only the intended change.

## Commands run

Only the two files this slot owns, as instructed:

```
pnpm test -- test/unit/pi-adapter/executor-abort.test.ts test/unit/pi-adapter/executor-retry.test.ts
→ # tests 16  # pass 16  # fail 0
```

Also run (read-only checks, not the gate): `npx eslint` on the three owned files → clean; `npx tsc --noEmit` → **zero** errors under `src/pi-adapter/**` or `test/unit/pi-adapter/**`. The two errors tsc does report are in `test/unit/episode/events-validate.test.ts` (T4) and `test/unit/protocol/v1.test.ts` (T8) — other slots' in-flight work, not mine, and not touched.

`pnpm test` (full) and `pnpm gate` were **not** run, per the slot instruction. The known baseline on this VM (Node 22.14.0, 2 pre-existing `test/unit/cli/doctor.test.ts` failures owned by T9) is therefore unverified from here and unchanged by this slot.

## Honest limitations / disclosures

- **(c) is defense in depth, not a separately reachable branch.** With (b) in place, the path from `runWithRetry`'s pre-attempt check through `new Agent(...)` to `addEventListener` contains no `await`, so on a single-threaded runtime no abort can land inside that window. The re-check therefore cannot be driven red by a test today; it exists so `runAttempt` is correct as a unit if a future caller reaches it without (b). Related: pi's `Agent.abort()` is `this.activeRun?.abortController.abort()`, so calling it before `prompt()` is a no-op — (c) protects the registration window, it is not a substitute for (a)/(b), and it is not claimed to be.
- Test 5 ("racing listener registration") aborts inside the stream call, which is *after* registration, so it exercises the ordinary listener path plus the no-retry-after-cancel rule. It does not exercise (c) itself, for the reason above.
- Test 2's `latencyMs <= 50` bound is a smoke assertion, not a performance claim; the faux provider is fast enough that it would also pass on the old code. Its purpose is usage/attempt honesty on the short-circuit, and the zero-spend proof lives in test 1.
- Event buffering (the executor collects the whole transcript before yielding) is unchanged — noted in the audit as a design choice, out of scope here.
- Run-level abort wiring into flowchart teardown remains open and was explicitly deferred by the round plan.

## Acceptance against the task's own criteria

- Zero provider calls after cancellation demonstrable in all three windows: **yes** for the pre-start and between-attempts windows (counted directly, and shown red without the fix); the third window is closed by construction and argued above rather than test-driven.
- No behavioral change for non-aborted paths: pinned by test 6 plus the ten unchanged retry-suite pins.
- Retry classification, usage honesty, event translation: untouched.
- `pnpm gate` green: **not verified from this slot** (instructed not to run it). Typecheck and lint are clean for the owned files.

## Forbidden-list compliance

No live R1/bandit/topology change; no Outcome-supported claim; ADR-006 untouched (stays Proposed); no auto-promote; no `package.json` / dependency edits; no git history rewrite; no commit, push, or PR. The diff is behavioral, not cosmetic: 57 insertions / 11 deletions in the executor plus a new test file, every line serving one of the three specified short-circuits.
