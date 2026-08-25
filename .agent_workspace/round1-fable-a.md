MODEL_SLUG: claude-fable-5-thinking-xhigh

# Round 1 report — R1-fable-A (kernel-reuse audit + playbook)

Retry after a failed dispatch; this file replaces the prior cycle's
0.84.3-adaptation report per this round's ownership table (same convention
R1-fable-B used).

## Delivered (exclusive write paths only; nothing committed)

1. **`docs/kernel-reuse.md`** — durable playbook: secondary features build on
   `AgentExecutor`/`ExecutionEvent` and `SparkleKernel` only, never Pi types
   (ADR-001/006, no `pi-coding-agent`). Contains the wired-today evidence
   table, the semantics extenders must respect (fresh-Agent-per-retry drops
   queues; sync-only subscribe listeners; bytes-only thinking; contract
   changes are domain decisions), a six-step "how to add a capability"
   procedure, a worked inject→steer example naming the exact missing pieces,
   and the verification gates.
2. **`docs/reports/2026-08-24-kernel-reuse-audit.md`** — evidence-based
   inventory of unused `Agent` 0.84.3 APIs vs sparkle, P0–P2 plus a parked
   list, each item naming the contract decision it needs.
3. This report.

## Peer work recorded as current evidence (not plan)

All three Round-1 targets landed in the working tree before my audit ran;
I verified them directly rather than restating the brief:

- **Live yield** — `runAttempt` bridges `kernel.subscribe` into
  `AsyncEventQueue` and yields pre-idle; `live-stream.test.ts` asserts first
  `TEXT_DELTA` while a scripted tool is still blocked.
- **`SparkleKernel`** — facade with `prompt`/`abort`/`waitForIdle`/`reset`/
  `steerText`/`followUpText`/`sessionId`, structural `SparkleKernelAgent`,
  no Pi type on the public surface; exported via `src/pi-adapter/index.ts`.
- **`THINKING_DELTA`** — bytes-only across contract, translator, both
  coordinators, and `src/run/events.ts`; `translate-thinking.test.ts`
  asserts the raw string does not serialize out.

Verification I ran today: `node scripts/kernel-reuse-probe.mjs` — PASS
(exit 0, both checks); `pnpm exec tsx --test` over `kernel.test.ts`,
`translate-thinking.test.ts`, `live-stream.test.ts` — 5 pass, 0 fail.

## Key audit findings

- **P0 (Round-2 leftover confirmed still unwired): inject→steer.**
  `steerText`/`followUpText` exist only in `kernel.ts` + the index export
  (grep-verified); `RunningRun` exposes only `cancel`;
  `AgentExecutionRequest` has no mid-run channel; `pi-sparkle inject` is
  flowchart policy facts (`fact|override|skip`), a different, approval-gated
  mechanism. Adoption needs a contract decision (where the channel lives)
  plus two explicit semantics calls: steering does not survive the
  fresh-Agent retry, and steering text persistence policy.
- **P1:** `shouldStopAfterTurn` (cost ceilings `maxCostUsd` are validated in
  `domain/limits.ts` + `protocol/v1.ts` and enforced only in shadow
  experiments — zero live-loop enforcement, child-coordinator has no cost
  references) and `beforeToolCall` (no gate between model tool call and
  execution; the honest site for a tool-allowlist kill switch).
- **P2:** `continue()` (needs transcript-retention decision),
  `thinkingBudgets`, `toolExecution: "sequential"`, `tool_execution_update`,
  lifecycle events (`turn_start` → stall detection), multimodal prompt,
  `transformContext`, `getApiKey` (low urgency — `builtinModels({credentials})`
  already resolves keys per call), state introspection.
- **Parked pending decisions:** `onPayload`/`onResponse` (conflicts with
  hash-only telemetry), `convertToLlm`/`CustomAgentMessages` (couples message
  model to Pi), `prepareNextTurn*` (routing must stay out of the adapter per
  ADR-001), `transport`/`maxRetryDelayMs` (double-retry interaction with
  `provider-retry.ts` — investigate first).

## Handoffs / risks

- **Spec drift:** `docs/specs/m0-m2-architecture.md` (~lines 288–293)
  reproduces `ExecutionEvent` without `THINKING_DELTA` and `MESSAGE`.
  `docs/specs/` is outside this round's write scope for me; needs an owner.
- **`sessionId` unreachable:** executor calls `SparkleKernel.fromFactory`
  without options; adoption must also copy the id across retry attempts.
- **Doc pair to keep in sync:** `docs/kernel-reuse.md` (detailed) and
  `.agents/skills/pi-sparkle/references/kernel-reuse.md` (agent checklist,
  R1-fable-B). Both currently agree; future facade growth should refresh
  both from the exported types, not from PROGRESS prose.

## Policy conformance

No `src/` edits (docs + report only). ADR-001/ADR-006 respected; no
coding-agent dependency or extension proposed. Evidence-based: every
wired/unwired claim is backed by a grep, source read, or command run today.
Did not commit (parent commits after the round).
