MODEL_SLUG: claude-opus-5-thinking-high-fast

# Round 1 — R1-opus-A

## Delivered

### `src/pi-adapter/kernel.ts` (new) — `SparkleKernel`

A sparkle-owned facade over the Pi `Agent`. Nothing on its public surface names
Pi's `Agent` or `AgentEvent`:

- The agent is accepted **structurally** as `SparkleKernelAgent` (`sessionId`,
  `state.{isStreaming,errorMessage}`, `subscribe`, `prompt`, `abort`,
  `waitForIdle`, `reset`, `steer`, `followUp`). `new Agent(...)` satisfies it
  without the Pi type appearing in an exported signature, and a stub satisfies
  it without a provider, so the facade is testable on its own.
- Events come back as `SparkleKernelEvent` (`{ readonly type: string }`) —
  opaque, routable by `type`, translated only inside the adapter.
- Construction: `new SparkleKernel(agent, options?)` /
  `SparkleKernel.fromAgent(agent, options?)` for an existing agent, and
  `SparkleKernel.fromFactory(create, options?)` (factory runs immediately) for
  the path the executor uses.
- Methods: `prompt(text)`, `abort()`, `waitForIdle()`, `reset()`,
  `steerText(text)`, `followUpText(text)`, `subscribe(listener)`, plus
  `sessionId` getter/setter and `errorMessage` / `isStreaming` getters.
  `steerText` / `followUpText` build `{ role: "user", content, timestamp }`,
  matching the shape Pi's own `prompt` normalizes text into.
- `subscribe` deliberately takes a **synchronous** listener and discards its
  result. Pi awaits listener promises as part of run settlement, so an async
  listener that waited on a consumer would deadlock `waitForIdle`. The doc
  comment points at `AsyncEventQueue` as the hand-off.
- `AsyncEventQueue<T>`: unbounded, single-consumer bridge from a push listener
  to `for await`. Unbounded on purpose — a listener that blocked on a slow
  consumer would stall the run it is reporting on. Buffered values are drained
  after `close()`; pushes after `close()` are dropped.

### `src/pi-adapter/pi-executor.ts` — live yield

`runAttempt` and `runWithRetry` are now async generators, and `execute` pulls
them with `yield*`, so the generator return value carries the run summary while
the events flow straight through to the consumer:

- `runAttempt` subscribes, starts `prompt()` + `waitForIdle()` **without
  awaiting them**, and drains an `AsyncEventQueue` that the subscription feeds.
  Each translated event is yielded as the agent emits it. The run promise
  closes the queue in its `finally`, which is the only thing that ends the
  stream; `await running` then happens before the attempt summary is returned,
  so `waitForIdle` is still on the critical path.
- Abort still maps to the agent: `signal` → `kernel.abort()`. Added case — if
  the consumer abandons the iterator mid-run, the `finally` unsubscribes and
  aborts rather than leaving the agent streaming into a queue nobody reads.
- `AttemptRun.events` is now exactly what was yielded (accumulated in the drain
  loop, not in the listener), so the invocation record can never diverge from
  the observed stream.
- `translatePiEvent`'s switch is untouched — imported and called, not rewritten
  (R1-opus-B owns it). The discriminators in this file (`message_update`,
  `tool_execution_start/end`, `turn_end`) match installed 0.84.3 and typecheck.

### `src/pi-adapter/index.ts`

Exports `SparkleKernel`, `AsyncEventQueue`, and the facade types
(`SparkleKernelAgent`, `SparkleKernelAgentFactory`, `SparkleKernelEvent`,
`SparkleKernelOptions`, `SparkleKernelUserMessage`).

## Retry trade-off (deliberate, please review)

Retry semantics used to be "only the last attempt's events are surfaced",
which was free while everything was buffered. It is not free once events are
live: a consumer that already saw a partial stream cannot unsee it. The split
now is:

- **Streamed to the consumer:** every attempt's events, in the order they
  actually happened.
- **Recorded in the `ModelInvocation`:** the last attempt's events only —
  response hash and usage still describe the call the run ended on.

In practice the failed attempts in the retry tests emit nothing before the
provider error, so the existing assertion (`textOf(events) === "recovered after
backoff"`) still holds; the divergence only appears if a stream fails partway
through and is then retried.

## Verification

- `pnpm exec tsx --test test/integration/pi-adapter/faux-smoke.test.ts test/unit/pi-adapter/translate-usage.test.ts` — **PASS** (4/4).
- `pnpm exec tsx --test test/{unit,integration}/pi-adapter/*.test.ts` — **PASS** (78 pass, 1 skipped: the network provider smoke test).
- `test/integration/pi-adapter/live-stream.test.ts` (R1-gpt-A's, written independently) — **PASS**: a `TEXT_DELTA` reaches the consumer while a scripted tool is still blocked mid-run, and its 500 ms anti-deadlock fallback is never reached. That is the round's target-1 evidence, from a test I did not write.
- `pnpm test` (full suite) — **PASS** (1413 pass, 1 skipped, 0 fail), including the retry, coordinator, and invocation-recording suites.
- `pnpm typecheck` — **PASS**; `pnpm exec eslint src/pi-adapter` — **PASS**.
- `test/unit/pi-adapter/kernel.test.ts` (R1-gpt-B's, landed after the facade) — **PASS** (3/3), driving `SparkleKernel` through a structural stub with no Pi `Agent` involved, which is the "testable on its own" claim above holding up against someone else's test.
- Facade smoke-checked against a real `Agent` on the faux provider (throwaway
  script, deleted): `sessionId` round-trips, `followUpText` produced a genuine
  second `turn_start`/`turn_end` pair through the queue, `reset` and
  `errorMessage` behave.

## Notes for the next round

- The kernel exposes `steer`/`followUp`/`reset`/`sessionId` but nothing calls
  them yet outside tests. Sparkle `inject` writing policy facts instead of
  steering a live agent is the obvious next consumer.
- `continue()` and `thinkingBudgets` are still unwrapped; both fit the facade
  without changing its shape.
- No commit created. `src/execution/` and `.agents/skills/**` untouched.
