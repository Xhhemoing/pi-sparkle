# Kernel Reuse: Building Secondary Features on the Slim Pi Kernel

Status: current as of 2026-08-24 (branch `cursor/pi-kernel-reuse-e1e3`).
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

The merge gate for this rule is mechanical:

```
rg -n "@earendil-works" src/ --glob '!src/pi-adapter/**'   # must be empty
```

## What is wired today (verified 2026-08-24)

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
| `steerText`, `followUpText`, `reset`, `sessionId` on the facade | **exposed, not product-wired** | `SparkleKernel` only; no caller outside `src/pi-adapter/**` | `rg -n "steerText|followUpText" src/` shows kernel + index exports only |

The last row is the standing gap: the kernel can steer a live agent, but no
run-level channel reaches it. `RunningRun` (returned by
`src/run/coordinator.ts`) exposes only `cancel`, and the `pi-sparkle inject`
CLI writes flowchart policy facts (`fact | override | skip` via
`src/run/injection.ts`), which is a different mechanism with a different
purpose. Wiring inject→steer is the next sanctioned extension; see the worked
example below and P0 in the audit.

## Semantics extenders must respect

These are properties of the current adapter, not suggestions.

- **Retry resets the agent.** `runWithRetry` builds a fresh `Agent` per
  attempt. Queued steering/follow-up messages and `sessionId` do not survive a
  retried attempt, and only the last attempt's events form the invocation
  record. A steering feature must tolerate a retry restarting from the
  original prompt — either re-arm queued messages after retry or document the
  drop.
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

### Worked example: the pending inject→steer wiring

The kernel side is done: `SparkleKernel.steerText(text)` queues a user message
into the live agent's steering queue, and `followUpText` queues one for after
the agent would otherwise stop. What is missing is everything above the
facade, in order:

1. A contract decision: how a running run receives steering text. The natural
   seams are a handle on `RunningRun` (alongside `cancel`) or a channel on
   `AgentExecutionRequest`; either way the shape belongs to
   `src/execution/contract.ts`, not to the adapter.
2. Executor plumbing from that channel to the per-attempt kernel, including
   the retry decision (queued steering is dropped by a retry today — re-arm
   or document).
3. A CLI/product entry point. Reusing `pi-sparkle inject` requires
   distinguishing flowchart policy injection from live-agent steering; a
   separate verb keeps the two auditable.
4. Tests at both layers plus an event-log record of the steer (text is
   user-authored, so persisting it is a policy question to answer explicitly —
   the flowchart injection path records actor and payload; steering should
   record no less).

## Verification gates

```
rg -n "@earendil-works" src/ --glob '!src/pi-adapter/**'    # ADR-001: must be empty
node scripts/kernel-reuse-probe.mjs                          # live-yield + facade export gates
pnpm exec tsx --test test/unit/pi-adapter/kernel.test.ts \
  test/unit/pi-adapter/translate-thinking.test.ts \
  test/integration/pi-adapter/live-stream.test.ts            # facade, redaction, live stream
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
