# Kernel Reuse: Building Secondary Features on the Slim Pi Kernel

Status: current as of 2026-08-26 (including `4412fac` and `57ade59`).
Companion audit: `docs/reports/2026-08-24-kernel-reuse-audit.md` (which Pi
`Agent` capabilities are unused and in what order to adopt them). Diagnostic
overlay for agents: `.agents/skills/pi-sparkle/references/kernel-reuse.md`.

## The rule

Secondary features — supervision views, steering surfaces, budget gates,
live-token consumers, cluster orchestration, telemetry sinks — are built on
exactly two surfaces, both owned by pi-sparkle:

1. **`AgentExecutor` / `ExecutionEvent`** (`src/execution/contract.ts`) — the
   run-facing contract. Coordinators, supervisors, and the CLI consume agent
   runs only through `execute(request, signal): AsyncIterable<ExecutionEvent>`.
2. **`SparkleKernel`** (`src/pi-adapter/kernel.ts`) — the in-adapter facade
   over Pi's `Agent` for capabilities beyond "run one prompt": steering,
   follow-ups, reset, idle-waiting, session identity. Its public surface names
   no Pi type; events come back as opaque `SparkleKernelEvent`s that only the
   adapter translates.

No feature code imports `@earendil-works/pi-agent-core` or
`@earendil-works/pi-ai` — those imports are confined to `src/pi-adapter/**`
(ADR-001). The runtime never depends on `@earendil-works/pi-coding-agent`,
and no inbound Pi extension exists until ADR-006 is Accepted. If the facade
is missing a capability you need, extend the facade inside `src/pi-adapter/`;
do not reach around it.

The merge gate for this rule is mechanical and matches **import specifiers**,
not raw string mentions — `src/pi-compat/check.ts` legitimately names the Pi
packages as data for version checks, and `test/unit/pi-boundary.test.ts`
encodes the same import-only rule as `hasPiPackageImport`:

```
rg -n "(from|import\(|require\()\s*[\"']@earendil-works" src/ --glob '!src/pi-adapter/**'
# must be empty (corrected 2026-08-24: the earlier raw-substring form of this
# gate now false-positives on the data mentions in src/pi-compat/check.ts)
```

## What is wired today (verified 2026-08-26)

Every row below was verified on this branch by reading the source and running
the listed check. "Wired" means a product path calls it, not merely that the
kernel exposes it.

| Capability | Status | Where | Verified by |
|---|---|---|---|
| Live event yield: `TEXT_DELTA` reaches `for await` consumers before the run settles | wired | `PiAgentExecutor.runAttempt` bridges `kernel.subscribe` into an `AsyncEventQueue` and yields as events arrive; `waitForIdle` closes the queue | `test/integration/pi-adapter/live-stream.test.ts`; `node scripts/kernel-reuse-probe.mjs` |
| `THINKING_DELTA` as bytes only — no chain-of-thought text past the adapter | wired | `translatePiEvent` (`src/pi-adapter/pi-executor.ts`) emits `{ type: "THINKING_DELTA", bytes }`; persisted as a summary string by `src/run/coordinator.ts` and `src/run/child-coordinator.ts` | `test/unit/pi-adapter/translate-thinking.test.ts` |
| Abort maps to `agent.abort()`; a consumer that stops draining also aborts the run | wired | `runAttempt` abort listener + walk-away guard | `test/unit/pi-adapter/executor-retry.test.ts` |
| Bounded provider retry with a fresh `Agent` per attempt | wired | `runWithRetry` + `src/pi-adapter/provider-retry.ts` | `test/unit/pi-adapter/executor-retry.test.ts`, `provider-retry.test.ts` |
| `prompt`, `abort`, `waitForIdle` via the facade | wired | executor drives `SparkleKernel.fromFactory(...)` | `test/unit/pi-adapter/kernel.test.ts` |
| Live steering: `RunningRun.steer(text, { actor? })` → `AgentExecutor.steerText?` → facade `steerText` | wired | `src/execution/contract.ts` exposes optional `steerText(text, agentInstanceId?)`; `startRun` passes its root agent id, so `PiAgentExecutor` delivers only to that live kernel and refuses a miss instead of falling back to a sibling (`57ade59`). Parent runs have no single agent and retain the untargeted sole-live-or-refuse rule. Text accepted during an attempt is retained for that execution and queued into a fresh retry kernel after its first turn (`4412fac`); each acceptance is persisted once as `STEER_INJECTED` with actor and target when known | `test/integration/pi-adapter/steer-blocked-tool.test.ts`, `steer-retry.test.ts`, `steer-target.test.ts`; `test/integration/m0/steer.test.ts`; `test/unit/pi-adapter/steer-inflight.test.ts` |
| Spend ceiling: `RunLimits.maxCostUsd` → `AgentExecutionRequest.maxCostUsd` → `CostGate` as the loop's stop-after-turn hook | wired (landed mid-Round-3 2026-08-24) | `startRun` forwards `run.limits.maxCostUsd` on the root request and `startParentRun` hands it to `ChildCoordinator`, whose `costCapFor` gives each child the tighter of the per-task and run-level caps (`src/run/coordinator.ts`, `src/run/child-coordinator.ts`; the supervisor loop forwards the same limit). `PiAgentExecutor.buildCostGate` arms the gate only when a cap **and** catalog prices both exist; an unpriced or invalid cap is reported through `onCostGate` and then ignored — never priced by guesswork (`src/pi-adapter/cost-gate.ts`). A stop is also re-checked between retry attempts so a failing task cannot buy attempts past its budget | `test/unit/pi-adapter/cost-gate.test.ts`, `cost-gate-ledger.test.ts`, `test/integration/pi-adapter/cost-stop.test.ts` (gate math + stop); `test/integration/m0/coordinator.test.ts`, `test/integration/m1/child-coordinator.test.ts` (forwarding, set and unset) |
| `followUpText`, `reset`, `sessionId` on the facade | **exposed, not product-wired** | `SparkleKernel` only; no caller outside `src/pi-adapter/**` | `rg -n "followUpText" src/` shows `kernel.ts` only |

Live steer is deliberately distinct from the `pi-sparkle inject` CLI verb:
`inject` writes flowchart policy facts (`fact | override | skip` via
`src/run/injection.ts`) for the supervisor to read, while `steer` adds a
conversational turn the model itself sees. They are logged as different event
types so an audit can tell which one changed a run. No CLI verb for live
steer exists yet; the product surface today is the `RunningRun` handle.

### Round 2 status (2026-08-24, R2-fable-A)

Round 2's P0 — the inject→steer product wiring — **landed in the working
tree mid-round** (uncommitted; parent commits). This subsection first went
out as "not landed" from a pre-landing verification pass; every claim below
was re-verified against the tree after the landing:

- `AgentExecutor.steerText?(text, agentInstanceId?)` on the contract;
  `RunningRun.steer(text, { actor? })` wired through a `SteerChannel` that is
  open only while execution is in flight, delivers to the executor before
  logging, and blocks run settlement on the event-log write.
- Steer text persists with its actor as `STEER_INJECTED`
  (`src/run/events.ts`, replay-aware via `src/run/replay.ts`) — it is
  user-authored input, not chain-of-thought, so persisting it verbatim is
  the policy, unlike `THINKING_DELTA`.
- Retry semantics were subsequently strengthened by `4412fac`: a steer
  accepted by the live kernel is retained at execution scope and re-delivered
  to each fresh retry kernel after that attempt's first turn. A request made
  during retry backoff is not accepted because no kernel exists for the
  target.
- Test evidence spans facade, executor, retry, targeting, and coordinator
  layers (suites listed in the table above).

Gate correction: the claim gate circulated for this round,
`rg -n "RunningRun.steer" src/run/coordinator.ts`, does **not** hit even
now, because `steer` is a member inside the multi-line `interface
RunningRun` block. Working single-line forms are `rg -n "steer\(text"
src/run/coordinator.ts` (interface + channel) and `rg -n "steer:"
src/run/coordinator.ts` (both returned handles); the multiline form
`rg -n -U "interface RunningRun \{[\s\S]*?steer\(" src/run/coordinator.ts`
hits at the interface declaration.

Still open after P0: a CLI verb for live steer; `followUpText` / `reset` /
`sessionId` remain facade-only.

### Round 3 status (2026-08-24, R3-fable-A)

Round 2 left two loose ends and one hazard; all three moved this round, again
mid-round in a shared tree (each claim below was re-verified after the
landing, not promised before it):

- **`maxCostUsd` now flows end to end.** Round 2 shipped the cost gate with
  the coordinator not yet forwarding the cap — live runs were uncapped. That
  gap closed mid-Round-3: both coordinator paths forward
  `run.limits.maxCostUsd` (see the table row above), and the forwarding is
  tested in both directions — a configured cap reaches the executor request,
  an omitted cap arrives as absent rather than as a default this layer
  invented.
  The claim gate is `rg -n "maxCostUsd" src/run/coordinator.ts` (two hits:
  the root request spread and the `ChildCoordinator` dep). This grep was
  empty at the start of Round 3 and non-empty an iteration later; as with
  the Round 2 steer landing, re-grep before repeating the claim.
- **The `steer-inflight` skip is gone.** The placeholder was replaced (not
  merely un-skipped) with kernel-backed tests that drive `RunningRun.steer`
  through a real `SparkleKernel` into an agent's steering queue, plus a
  refused-steer case proving delivery-before-logging from the failing side.
  `rg -n "test.skip" test/` returns nothing.
- **Cost stop vs. steer ordering is now documented** rather than reordered —
  see "A cost stop outranks a queued steer" under the semantics list below
  for the mechanism, the audit trail, and why the reorder was declined.

## Semantics extenders must respect

These are properties of the current adapter, not suggestions.

- **Retry replaces the agent, while accepted steers survive the execution.**
  `runWithRetry` builds a fresh `Agent` per attempt, so attempt-local queues
  and session identity still reset. `PiAgentExecutor` separately retains each
  steer accepted for that agent instance and queues it into a fresh retry
  kernel after the new attempt's first turn (`4412fac`). A targeted steer
  requested during backoff is refused because that instance has no live
  kernel; it is never redirected to a sibling (`57ade59`). Follow-up messages
  and `sessionId` have no equivalent replay contract.
- **A cost stop outranks a queued steer.** Pi's loop consults
  `shouldStopAfterTurn` immediately after a turn settles and exits the loop
  when it answers true; the steering queue is drained only after that check
  declines, and the follow-up queue only after the loop would otherwise end
  (verified in `@earendil-works/pi-agent-core` 0.84.3, `dist/agent-loop.js`:
  the stop check returns from the loop before the `getSteeringMessages`
  poll that follows it). So text accepted by `steerText` during the turn
  that crosses the cost ceiling stays in the discarded `Agent`'s queue and
  is never delivered. Know what the log means here: `STEER_INJECTED` records
  acceptance into the queue, not delivery to the model. A dropped steer is
  therefore not silent in the record — the `STEER_INJECTED` event and the
  cost gate's "stopped" outcome sit side by side, showing the operator
  steered and the ceiling answered first; nothing claims the model saw the
  text. Reordering the drain inside the loop would need a Pi fork, and the
  no-fork alternative — holding the stop open while a steer is queued —
  would buy that steer another priced turn past the cap, under-enforcing
  the budget exactly when someone intervenes, so the drop is documented
  rather than reordered. (A refinement that stays honest — `steerText`
  refusing once the gate's stop has latched, turning a late silent drop
  into a visible refusal — is a candidate for a future round, not landed.)
- **Subscribe listeners are synchronous fire-and-forget.** Pi awaits listener
  promises as part of run settlement, so an async listener that waits on a
  slow consumer deadlocks `waitForIdle`. `SparkleKernel.subscribe` therefore
  discards listener results; hand work to an `AsyncEventQueue` and consume it
  with `for await`.
- **Never persist thinking text.** The raw `thinking_delta` string is read
  exactly once, inside `translatePiEvent`, to measure its UTF-8 byte length.
  No event, log line, fixture, or report may carry the text itself. This
  mirrors the invocation-telemetry rule: response bodies are hashed, never
  retained.
- **Event payloads are sparkle-owned.** Adding a variant to `ExecutionEvent`
  or a field to `AgentExecutionRequest` is a domain-contract decision
  (ADR-001: Pi capabilities not represented by the adapter require an
  explicit decision before adoption). Do not smuggle a Pi shape through an
  `unknown` field.
- **Aborting is not an event.** Cancellation flows through the
  `AbortSignal` → `kernel.abort()` path; do not build features that infer
  cancellation from event absence.

## How to add a capability

1. **Check the audit first.** `docs/reports/2026-08-24-kernel-reuse-audit.md`
   inventories every unused `Agent` API with a priority and the contract
   decision it needs. If your capability is listed "do not adopt without
   decision", start with the decision, not the code.
2. **Design the sparkle-owned shape.** Name the new method or event in
   pi-sparkle vocabulary (plain strings, domain types). If it changes
   `src/execution/contract.ts`, that edit is part of the same reviewed change,
   not a follow-up.
3. **Extend the facade inside `src/pi-adapter/`.** Add the method to
   `SparkleKernel` (and, if the structural slice grows, to
   `SparkleKernelAgent`). Pi types may appear in the implementation, never in
   an exported signature.
4. **Wire the product path** — coordinator, CLI, or supervisor — through the
   contract or the facade, and nothing else.
5. **Test both layers.** Unit-test the facade against a stub
   `SparkleKernelAgent` (no provider needed; see
   `test/unit/pi-adapter/kernel.test.ts`), and integration-test the executor
   path against the faux provider (see
   `test/integration/pi-adapter/live-stream.test.ts`).
6. **Run the gates** (below) before claiming the capability is wired. A
   capability claim without a `src/` call site and a test fails closed.

### Worked example: the inject→steer wiring (landed 2026-08-24)

This section was written while the wiring was pending; it now doubles as the
worked example *with the answers filled in* — each planned step maps to where
it actually landed:

1. **Contract decision** — the steer channel became a handle on `RunningRun`
   (alongside `cancel`), backed by an optional `AgentExecutor.steerText?` in
   `src/execution/contract.ts`. Optionality is load-bearing: an executor
   without `steerText` means "steering unsupported", and the coordinator
   throws rather than accepting text it would drop.
2. **Executor plumbing** — `PiAgentExecutor.steerText` accepts an optional
   agent-instance target. Root-run handles always provide it; a missing target
   refuses before logging and never falls back to a concurrent sibling
   (`57ade59`). Untargeted parent steering keeps the sole-live-or-refuse
   behavior. Accepted text is retained at execution scope and re-delivered
   after the first turn of every fresh retry attempt (`4412fac`).
3. **Product separation** — live steer stayed a separate channel from the
   flowchart `inject` verb, logged as a distinct event type
   (`STEER_INJECTED` vs. the injection events), so audits can tell which one
   changed a run. A CLI steer verb has not been added yet.
4. **Tests and persistence** — steer text is persisted with its actor
   (`src/run/events.ts`; the steering principal is the event's `actor`), the
   run does not settle until accepted steers are written, and tests cover
   facade (`steer-inflight.test.ts`), executor under a blocked tool
   (`steer-blocked-tool.test.ts`), retry replay (`steer-retry.test.ts`),
   exact-run targeting (`steer-target.test.ts`), and coordinator + event log
   (`test/integration/m0/steer.test.ts`).

## Verification gates

```
rg -n "(from|import\(|require\()\s*[\"']@earendil-works" src/ --glob '!src/pi-adapter/**'
                                                             # ADR-001: must be empty (import form; see "The rule")
node scripts/kernel-reuse-probe.mjs                          # live-yield + facade export gates
pnpm exec tsx --test test/unit/pi-adapter/kernel.test.ts \
  test/unit/pi-adapter/translate-thinking.test.ts \
  test/integration/pi-adapter/live-stream.test.ts \
  test/integration/pi-adapter/steer-retry.test.ts \
  test/integration/pi-adapter/steer-target.test.ts            # facade, redaction, live stream, steer retry/target
pnpm typecheck && pnpm test                                  # full gates before merge
```

Report capability status as `wired | not wired | unknown` — never a guess.

## Related documents

- `docs/reports/2026-08-24-kernel-reuse-audit.md` — unused `Agent` API
  inventory with P0–P2 adoption order.
- `docs/decisions/0001-pi-adapter-boundary.md` — the adapter boundary and the
  "explicit decision before adoption" rule this playbook operationalizes.
- `docs/decisions/0006-pi-extension-reverse-adapter.md` — why there is no
  inbound extension and skills stay diagnostic.
- `docs/how-to-adapt-to-pi.md` — version-bump playbook; kernel-reuse work
  rides the pinned version and never bumps it as a side effect.
- `.agents/skills/pi-sparkle/references/kernel-reuse.md` — the extender
  checklist agents load at run time; keep the two in agreement, with this file
  as the more detailed of the pair.
