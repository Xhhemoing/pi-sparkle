# Kernel Reuse — Extender Checklist

Read this before building any secondary feature (supervision view, steering
UI, live token consumer, cluster orchestration) on the slim Pi kernel
(`@earendil-works/pi-agent-core` + `@earendil-works/pi-ai` behind
`src/pi-adapter/`). The skill documents the contract; the implementation
lives in `src/` and is owned there. ADR-001 (Pi imports confined to
`src/pi-adapter/**`) and ADR-006 (no inbound extension) stay in force, and
the runtime never takes a dependency on `pi-coding-agent`.

## Checklist

1. **Implement on `SparkleKernel`, not on Pi's `Agent`.** The facade is the
   only supported extension surface: `prompt`, `abort`, `steerText`,
   `followUpText`, `reset`, `waitForIdle`, optional `sessionId` — Sparkle
   types only, plain strings in. Never construct an `Agent`, import
   `AgentEvent`, or touch steering queues directly from feature code; if
   the facade is missing a capability, extend the facade inside
   `src/pi-adapter/` rather than reaching around it. Gate before merging:

   ```
   rg -n "@earendil-works" src/ --glob '!src/pi-adapter/**'
   ```

   must return nothing.

2. **Verify wiring before claiming it.** The kernel exposing a capability
   is not the same as the adapter wiring it. Example, verified 2026-08-24:
   0.84.3's `Agent` ships `steer(message)` / `followUp(message)` with queue
   modes (see `node_modules/@earendil-works/pi-agent-core/dist/agent.d.ts`),
   yet `rg -n "steer|followUp|SparkleKernel" src/` returned zero matches —
   the facade was a Round-1 target, not a landed fact. Never write "steer
   is wired" (or any capability claim) in a report, SKILL section, or doc
   until a grep of `src/` shows the call site and a test exercises it.
   Absence of a grep hit fails the claim closed.

3. **Consume live events; never depend on buffered replay.** The historical
   executor buffered `subscribe` events and yielded them only after
   `waitForIdle` resolved, so supervisors saw no live tokens. Extenders
   must consume the live-yield path: a `for await` over `execute()` (or
   the facade's stream) receives `TEXT_DELTA` *before* idle resolves.
   Acceptance probe: first `TEXT_DELTA` observed while the run is still
   active, not in a post-idle flush. Abort must still map to
   `agent.abort()` inside the adapter — cancellation is not an event you
   replay later.

4. **Never persist thinking text.** `thinking_delta` payloads are chain-of-
   thought. If your feature surfaces them, emit metadata only — e.g.
   `{ type: "THINKING_DELTA", bytes }` — and never write the raw delta to
   the event log, run JSONL, invocation records, reports, or fixtures.
   This mirrors the existing invocation-telemetry rule (response bodies are
   hashed, never retained). Gate: grep persisted artifacts for thinking
   text before shipping; a length/byte count is the most any durable
   record may carry.

5. **Pin stays 0.84.3.** Kernel-reuse work rides the pinned
   `@earendil-works/pi-agent-core` / `pi-ai` at `0.84.3`; do not bump pins
   as part of a feature branch. Read `package.json` or run
   `pi-sparkle pi-compat` for the live pin — never trust prose, including
   this file. A version bump is its own task and runs the full
   `references/pi-version-adapt.md` checklist first.

6. **Respect retry and queue semantics.** The executor retries transient
   provider failures with a *fresh* `Agent` per attempt, so queued steering
   and follow-up messages do not survive a retry, and only the last
   attempt's events surface. Features that steer mid-run must tolerate a
   retried attempt starting from the original prompt. `sessionId` is
   optional on the facade; treat it as advisory continuity, not a
   durability guarantee.

## Anti-patterns

- Importing Pi types into feature code "just for the event union" — that
  is an ADR-001 breach even with zero runtime calls.
- Registering an extension command or session listener to observe the
  kernel — ADR-006 keeps this package a diagnostic overlay.
- Logging raw `thinking_delta` text "temporarily for debugging" — debug
  output becomes fixtures becomes persisted CoT. Bytes only, from the
  first commit.
- Reporting a kernel capability as available in Sparkle because the Pi
  changelog mentions it (see item 2: grep `src/`, then claim).

## Verification before reporting

```
rg -n "@earendil-works" src/ --glob '!src/pi-adapter/**'   # must be empty
rg -n "SparkleKernel|steerText|followUpText" src/           # claim gate
rg -n "0\.84\.3" package.json                               # pin unchanged
```

Plus the relevant unit/integration tests for the facade and live stream
when they exist. Report `wired | not wired | unknown` per capability —
offline or missing evidence means `unknown`, never a guess.
