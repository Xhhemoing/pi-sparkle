MODEL_SLUG: claude-opus-5-thinking-high-fast

# Round 2 — R2-opus-A: inject→steer (P0)

Live steering is wired end to end: `RunningRun.steer(text)` → optional
`AgentExecutor.steerText?(text)` → the `SparkleKernel` for the attempt in
flight → Pi's steering queue, with a `STEER_INJECTED` event carrying the actor
and the text. Verified against a real Pi `Agent` on the faux provider: the
steered text arrives as a second `role: "user"` turn in the *next* provider
call, after the blocking tool's result.

## Delivered

### `src/execution/contract.ts`

```ts
steerText?(text: string): void;
```

Optional, because not every executor drives a steerable loop. The doc comment
states the three things a caller has to know: it is live steering and **not**
the flowchart `inject` verb; absence means "unsupported", which callers must
turn into a refusal rather than a silent drop; and implementations reject blank
text and reject the call when nothing is in flight, with
`DomainValidationError`.

(`AgentExecutionRequest.maxCostUsd` in the same file is R2-opus-B's; the two
edits do not touch each other.)

### `src/pi-adapter/pi-executor.ts` — the live kernel

`PiAgentExecutor` now keeps `liveKernels: Map<AgentInstanceId, SparkleKernel>`.
`runAttempt` registers the attempt's kernel right after building it and removes
it in the same `finally` that unsubscribes and handles consumer walk-away
(guarded by identity, so a retry's registration is never deleted by the
previous attempt's teardown).

`steerText(text)` refuses in three cases instead of guessing:

- blank/whitespace-only text;
- **no** attempt in flight;
- **more than one** attempt in flight.

The third one is not defensive padding. One `PiAgentExecutor` instance serves
every child task a parent run leases (`ChildCoordinator` holds a single
`executor`), so "steer the live agent" is genuinely ambiguous under
concurrency, and broadcasting one operator's correction into every concurrent
agent's conversation is not what was asked for. The single-agent `startRun`
path — the one this round targets — is unaffected.

**Retry:** steering does not survive it, and this is documented on the method
rather than papered over. `runAttempt` builds a fresh `Agent` per attempt, so a
queued message that has not been drained when an attempt fails dies with that
attempt's state. Nothing re-arms it.

### `src/run/events.ts` + `src/run/replay.ts` — `STEER_INJECTED`

A new event type rather than a reused `AGENT_EVENT` kind, because the two are
different claims: `AGENT_EVENT` summarizes what the agent did, and this records
what a human told it to do. Reusing the kind would have forced the text through
`AgentEventPayload.summary`, which is the same field that carries
`thinking delta (N bytes)` — exactly the field that must never hold text.

```ts
export interface SteerInjectedPayload {
  text: string;
  agentInstanceId?: AgentInstanceId;   // present when one agent was the target
}
```

The steering principal is the event's own `actor` field, not a payload
duplicate; `validateEvent` already rejects a blank actor, so an anonymous steer
is not a representable event. Payload validation fails closed on empty or
whitespace-only `text`, on a malformed `agentInstanceId`, and on **any** extra
key — that last one is what keeps a future caller from smuggling a reasoning
blob in beside the text. `replayRun` treats it as a non-state-changing event: a
steer changes what the agent does, not what the run's status is.

### `src/run/coordinator.ts` — `RunningRun.steer`

```ts
steer(text: string, options?: { actor?: string }): Promise<void>;   // actor defaults to "user"
```

Backed by a small `SteerChannel` that both `startRun` and `startParentRun`
construct. Two design points worth reviewing:

1. **Validation and delivery are synchronous; only the log write is a
   promise.** A blank steer, a closed window, and an executor without
   `steerText` all `throw` rather than returning a rejected promise, so a
   caller who ignores the return value still cannot miss a refusal. The
   returned promise resolves when the event is on disk. This also matches the
   shape R2-gpt-A's placeholder assumed (`assert.throws(() => running.steer("   "), /non-empty/)`).
2. **Delivery happens before logging.** An event describing a steer the agent
   never received would be a false record of what the run was told, so the
   executor call comes first and a throw from it means no event. The inverse
   failure (delivered but the write fails) surfaces on the returned promise.

The window is open only while the executor is being drained (`open()` before
the `for await`, `close()` in its `finally`), and the run awaits every accepted
write via `settled()` before it reads its own event log back — so a steer that
nobody awaited still lands before `RUN_COMPLETED`/`RUN_CANCEL_REQUESTED`, and a
failed write cannot corrupt the run's own replay.

`startParentRun` gets the same handle, with no `agentInstanceId` in the payload
since a parent run has no agent of its own; the executor's ambiguity rule is
what decides whether the steer has an unambiguous target.

### `src/testing/fake-executor.ts`

Both options from the brief, one each, so both are tested:

- `FakeExecutor` **does not implement** `steerText`. Steering a run backed by it
  is an explicit `DomainValidationError`, not a no-op that looks like success.
- `GatedExecutor` implements it, recording accepted text in `steers` and
  refusing when not in flight. `execute` now wraps its body in a generator that
  tracks the in-flight window.

## Verification

- `test/integration/pi-adapter/steer-blocked-tool.test.ts` (new) — the round's
  target evidence. A custom tool holds the turn open; `steerText` is called
  while it blocks; the faux provider's second response is a factory that
  captures the context. Asserts the next provider call sees **exactly two** user
  turns — the original prompt, then the steer — so the steer is a new turn
  appended after the tool result, not an edit of the prompt. Also asserts
  `steerText` throws before `execute`, throws on whitespace, throws after
  `execute` returns, and throws with `/2 agent runs are in flight/` when two
  concurrent runs share the executor. **PASS (2/2).**
- `test/integration/m0/steer.test.ts` (new) — 5 cases: delivery + actor + text
  + `agentInstanceId` in the log and the run still cancels/replays/checkpoints
  normally; an unawaited steer still lands before the terminal event; blank
  text and a blank actor are refused synchronously and never reach the
  executor; an executor without `steerText` is refused; steering before and
  after the execution window is refused. **PASS (5/5).**
- `test/unit/run/events.test.ts` — added `STEER_INJECTED` validation: text kept
  verbatim, blank text rejected, bad `agentInstanceId` rejected, unknown
  payload key rejected, empty actor rejected. **PASS (6/6).**
- `pnpm typecheck` — PASS. `pnpm exec eslint src test` — PASS.
- `pnpm test` — **PASS: 1441 pass, 0 fail, 2 skipped** (the network provider
  smoke test and R2-gpt-A's placeholder, see below). This run included
  R2-opus-B's cost-gate files, which were present in the tree.
- `node scripts/kernel-reuse-probe.mjs` — all three gates PASS, including
  R2-gpt-B's new `executor-steer` gate, which was written independently and
  matches this implementation without adjustment.
- Facade behavior confirmed against a real `Agent` with a throwaway probe
  (deleted): the steer lands as `{ role: "user", content: "…" }` immediately
  after the `toolResult` message in the second provider call.

## For the parent

1. **`docs/kernel-reuse.md` is now stale.** R2-fable-A's Round 2 section says
   the wiring "has **not landed**" and instructs readers not to flip the table
   row, citing `rg -n "RunningRun.steer" src/run/coordinator.ts` returning
   nothing. That grep now hits. Their file, their lane — but it needs a pass
   before merge. The overlay (`.agents/skills/pi-sparkle/references/kernel-reuse.md`,
   R2-fable-B) is already correct and even cites `test/integration/m0/steer.test.ts`
   by name.
2. **A stale skip.** `test/unit/pi-adapter/steer-inflight.test.ts` (R2-gpt-A)
   holds `test.skip("RunningRun.steer forwards in-flight text and rejects empty
   text")` with the comment "Enable when `RunningRun.steer` lands". It has
   landed, and the implementation satisfies both assertions they sketched. I
   left their file untouched; it should be enabled or removed.
3. **Cost stop pre-empts a pending steer.** In Pi's loop
   (`agent-loop.js`), `shouldStopAfterTurn` is consulted *before*
   `getSteeringMessages`, so if R2-opus-B's cost gate stops a turn, any steer
   queued during that turn is never drained. That is defensible — the budget is
   a hard limit — but it is an interaction between the two Round 2 workstreams
   that nobody has written down, and a user whose steer silently evaporates at
   the budget ceiling deserves better than silence. Worth a Round 3 line, at
   minimum in the docs.
4. **No CLI verb.** The in-process API is the whole scope this round, as
   briefed. When a verb is added it must be separate from `inject`: `inject`
   writes typed policy facts the supervisor reads, `steer` writes a
   conversational turn the model reads, and the two now produce different event
   types precisely so an audit can tell which one changed a run.
5. `SparkleKernelUserMessage.content` is a bare string, while Pi's own `prompt`
   normalizes to `[{ type: "text", text }]`. Both are legal
   (`UserMessage.content: string | (TextContent | ImageContent)[]`) and the
   faux path works, so this is a note, not a defect.

No commit created. `shouldStopAfterTurn` untouched (opus-B's). Subscribe
listeners are still synchronous. Skills and `docs/specs/**` untouched.
