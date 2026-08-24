[Model: claude-opus-5-thinking-high-fast]

# Loop 4 · Round 1 — T2 slot report

**Slot:** invocation telemetry — bounded lock-timeout retry + flowchart hook wiring
**Branch:** `agent/opt-continuous` (working tree only; no commit, no push, no PR — per instructions)
**Metric class:** correctness / fail-closed. **No performance claim is made.**

## Files touched (exclusive ownership only)

| Path | Change |
|---|---|
| `src/telemetry/invocation-log.ts` | +114 lines, additive only (new sink factory; existing exports untouched) |
| `src/cli/main.ts` | +25/-10, entirely inside `runCommand`: the import line, one sink construction, and the two `createExecutor(...)` hook arguments |
| `test/unit/telemetry/invocation-log.test.ts` | +270 lines, five new tests |

Nothing else was edited. `src/persist/file-lock.ts`, `src/persist/jsonl.ts`, and every other slot's files are untouched.

## The two defects

1. **Silent telemetry loss on lock contention.** `main.ts` fired `appendInvocationRecord(...).catch(() => undefined)`. While a `delete --run` rewrite holds `invocations.jsonl.lock` past the 5 s default, every live invocation in that window rejected with `timed out waiting for lock at …` and was discarded with no retry and no signal — cost calibration simply lost the rows.
2. **Flowchart path recorded nothing.** The flowchart branch called `createExecutor(kind, stateRoot, undefined, undefined, thinkingLevel)`, so `run --flowchart --executor pi` persisted **zero** invocation rows. Nothing in the suite would have noticed the hook going missing.

## Change

### `createInvocationSink(stateRoot, options?)`

New exported factory returning `InvocationSink = (invocation) => Promise<void>`. Semantics:

- **Retry on lock timeout only.** `isLockTimeout` matches exactly `withExclusiveFileLock`'s message for *this* log's lock path (`timed out waiting for lock at <invocations.jsonl.lock>`). Anything else — including a `DomainValidationError` from `validateInvocation`, which is the same error class — is terminal on the first try. An unrecognized message also fails closed to "do not retry", so a future wording change in the lock degrades to today's drop behavior rather than to a retry loop.
- **Bounded budget.** `maxAttempts` defaults to 3 (two retries), `retryBackoffMs` defaults to 50 ms, with an injectable `sleep` seam used by the tests to make the retry windows deterministic. Remaining options (`timeoutMs`, `retryMs`, `fsync`) pass straight through to `appendInvocationRecord`.
- **Never rejects.** The terminal outcome is reported through `onDrop(reason)`; the returned promise always resolves. `onDrop` itself is called inside a `try`/`catch` so a throwing reporter cannot turn a dropped row back into a failed live call.
- **Ordering under retry.** A second per-log-path queue (`sinkQueues`) wraps the whole retry loop. `appendInvocationRecord`'s own queue is not enough: a retrying record re-enters that queue at the back, so without the outer chain a row that waited out a timeout would land after rows issued later.

`appendInvocationRecord`'s signature is unchanged, readers stay lock-free, and no writer surface was added — the sink is a wrapper around the existing locked append.

### `runCommand` wiring

One sink is built immediately after `stateRoot` resolves, with `onDrop` emitting a single `io.stderr` line (`warning: invocation telemetry dropped: …`). Both `createExecutor` call sites — the flowchart branch and the children/track branch — now pass `{ onInvocation: (invocation) => { void invocationSink(invocation); } }`. The old inline fire-and-forget append and its comment are gone.

## Tests (all new, in the owned test file)

1. `the sink retries a lock timeout and the row lands once the lock clears` — an external holder owns the lock through attempt 1; the injected backoff is the synchronization point that releases it, so "lock cleared between attempt 1 and attempt 2" is exercised without sleep races. Asserts exactly one backoff, no drop, row present.
2. `the sink gives up after its retry budget without throwing and reports the drop once` — lock held for all three tries: the call resolves (never rejects), exactly two backoffs, `onDrop` fires once naming the lock path, and the pre-existing log is byte-identical afterwards.
3. `the sink drops an invalid record immediately, with no retry` — `tokensIn: -5` resolves, **zero** backoffs recorded, one drop naming the validation message, no file written.
4. `sink writes keep call order even when the first one has to retry` — six records issued while the lock is held; the first retries, the rest queue behind it, and all six land in call order with no drops.
5. `both createExecutor call sites in runCommand pass an invocation hook` — a source pin in `plane-boundary.test.ts` style: reads `src/cli/main.ts`, blanks comment and string contents (length-preserving, so a hook surviving only as a comment cannot satisfy the pin), slices `runCommand`, paren-matches every `createExecutor(` call, and asserts there are exactly two and that both pass `onInvocation` using the shared `invocationSink`. It also pins the single shared sink construction and the `createInvocationSink` import.

**Negative check on the pin:** reverting the flowchart branch's hooks argument to `undefined` in a scratch copy made test 5 fail with `createExecutor called without an invocation hook`; the file was restored immediately and re-verified by `git diff`. The pin is not vacuous.

## Verification run

```
pnpm test -- test/unit/telemetry/invocation-log.test.ts
# tests 16  pass 16  fail 0
```

Additionally, as read-only checks scoped to the owned files: `npx eslint src/telemetry/invocation-log.ts src/cli/main.ts test/unit/telemetry/invocation-log.test.ts` is clean, and `npx tsc --noEmit` reports no diagnostic in either owned source file. The full suite and `pnpm gate` were **not** run from this slot, as instructed; other slots were editing the shared tree concurrently, so a repo-wide result from here would not have been attributable.

## Limits and residual risk

- The lock-timeout classification is string-exact against `withExclusiveFileLock`'s current message. Tests 1 and 2 pin it against a real lock, so a wording change turns into a red test rather than a silent behavior change — but it is a coupling worth knowing about.
- The retry budget serializes later rows behind a retrying one for up to `maxAttempts × timeoutMs`. With the defaults that is bounded by the caller-supplied lock timeout; telemetry queues in memory during a long rewrite instead of being dropped, and is discarded at the end of the budget.
- The default 3 tries × 5 s lock timeout does not cover an arbitrarily long `delete --run` rewrite. Rows lost past that budget are now reported on stderr rather than vanishing, which is the fail-closed part of this change; it is not a guarantee of delivery.
- No claim is made here about live R1, bandit, or topology behavior; no Outcome-supported claim; no ADR status change; no promotion; no dependency or `package.json` edit; no git history rewrite.
