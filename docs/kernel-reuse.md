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

The merge gate for this rule is mechanical and matches **import specifiers**,
not raw string mentions — `src/pi-compat/check.ts` legitimately names the Pi
packages as data for version checks, and `test/unit/pi-boundary.test.ts`
encodes the same import-only rule as `hasPiPackageImport`:

```
rg -n "(from|import\(|require\()\s*[\"']@earendil-works" src/ --glob '!src/pi-adapter/**'
# must be empty (corrected 2026-08-24: the earlier raw-substring form of this
# gate now false-positives on the data mentions in src/pi-compat/check.ts)
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
| Live steering: `RunningRun.steer(text, { actor? })` → `AgentExecutor.steerText?` → facade `steerText` | wired (landed mid-round 2026-08-24) | `src/execution/contract.ts` (optional `steerText?` — absence means "steering unsupported", callers fail rather than drop); `SteerChannel` in `src/run/coordinator.ts`, returned by both `startRun` and `startParentRun`; `PiAgentExecutor.steerText` targets the single in-flight kernel and refuses when zero or several runs are live; each accepted steer persists as a `STEER_INJECTED` event carrying the text with the steering principal as event actor | `test/integration/pi-adapter/steer-blocked-tool.test.ts` (steer during a blocked tool reaches the next model call), `test/integration/m0/steer.test.ts` (actor + text in the event log; write settles before the run does), `test/unit/pi-adapter/steer-inflight.test.ts` |
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

- `AgentExecutor.steerText?(text)` on the contract; `RunningRun.steer(text,
  { actor? })` wired through a `SteerChannel` that is open only while
  execution is in flight, delivers to the executor before logging, and
  blocks run settlement on the event-log write.
- Steer text persists with its actor as `STEER_INJECTED`
  (`src/run/events.ts`, replay-aware via `src/run/replay.ts`) — it is
  user-authored input, not chain-of-thought, so persisting it verbatim is
  the policy, unlike `THINKING_DELTA`.
- Retry semantics unchanged: queued steering still does not survive the
  fresh-`Agent` retry; a steer accepted before a retried attempt is
  documented as dropped, not silently re-armed.
- Test evidence: 8 passing steer tests across facade, executor, and
  coordinator layers (suites listed in the table above).

Gate correction: the claim gate circulated for this round,
`rg -n "RunningRun.steer" src/run/coordinator.ts`, does **not** hit even
now, because `steer` is a member inside the multi-line `interface
RunningRun` block. Working single-line forms are `rg -n "steer\(text"
src/run/coordinator.ts` (interface + channel) and `rg -n "steer:"
src/run/coordinator.ts` (both returned handles); the multiline form
`rg -n -U "interface RunningRun \{[\s\S]*?steer\(" src/run/coordinator.ts`
hits at the interface declaration.

Still open after P0: a CLI verb for live steer; `followUpText` / `reset` /
`sessionId` remain facade-only; and the pre-landing placeholder
`test.skip("RunningRun.steer forwards in-flight text…")` in
`test/unit/pi-adapter/steer-inflight.test.ts` is now stale — its coverage
lives in `test/integration/m0/steer.test.ts` and the skip should be removed.

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

### Worked example: the inject→steer wiring (landed 2026-08-24)

This section was written while the wiring was pending; it now doubles as the
worked example *with the answers filled in* — each planned step maps to where
it actually landed:

1. **Contract decision** — the steer channel became a handle on `RunningRun`
   (alongside `cancel`), backed by an optional `AgentExecutor.steerText?` in
   `src/execution/contract.ts`. Optionality is load-bearing: an executor
   without `steerText` means "steering unsupported", and the coordinator
   throws rather than accepting text it would drop.
2. **Executor plumbing** — `PiAgentExecutor.steerText` forwards to the
   per-attempt kernel and refuses to guess when zero or more than one run is
   in flight. The retry decision went to document-and-drop: queued steering
   does not survive the fresh-`Agent` retry.
3. **Product separation** — live steer stayed a separate channel from the
   flowchart `inject` verb, logged as a distinct event type
   (`STEER_INJECTED` vs. the injection events), so audits can tell which one
   changed a run. A CLI steer verb has not been added yet.
4. **Tests and persistence** — steer text is persisted with its actor
   (`src/run/events.ts`; the steering principal is the event's `actor`), the
   run does not settle until accepted steers are written, and tests cover
   facade (`steer-inflight.test.ts`), executor under a blocked tool
   (`steer-blocked-tool.test.ts`), and coordinator + event log
   (`test/integration/m0/steer.test.ts`).

## Verification gates

```
rg -n "(from|import\(|require\()\s*[\"']@earendil-works" src/ --glob '!src/pi-adapter/**'
                                                             # ADR-001: must be empty (import form; see "The rule")
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
