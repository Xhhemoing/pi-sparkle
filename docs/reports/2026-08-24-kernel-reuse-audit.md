# Kernel-reuse audit: unused Pi `Agent` APIs vs pi-sparkle (2026-08-24)

Auditor: R1-fable-A (`claude-fable-5-thinking-xhigh`), branch
`cursor/pi-kernel-reuse-e1e3`. Method: every claim comes from this tree —
the installed `@earendil-works/pi-agent-core@0.84.3` type declarations
(`dist/agent.d.ts`, `dist/types.d.ts`), source reads and greps of `src/`,
and commands run on this branch today. No usage metrics are cited because
none were collected. ADR-001 and ADR-006 are treated as in force;
`@earendil-works/pi-coding-agent` and inbound extensions are out of scope.

## 1. Current state — what landed in Round 1 (evidence, not plan)

These were open gaps in the round brief and are now **wired in the working
tree** (uncommitted; parent commits after the round). Recorded here as
current state:

| Capability | Evidence |
|---|---|
| Live yield: `execute()` yields translated events as the agent emits them, via `AsyncEventQueue` bridging `kernel.subscribe` to `for await`; `waitForIdle` closes the queue | `src/pi-adapter/pi-executor.ts` (`runAttempt`); `test/integration/pi-adapter/live-stream.test.ts` asserts first `TEXT_DELTA` arrives while a scripted tool is still blocked |
| `SparkleKernel` facade: `prompt`, `abort`, `waitForIdle`, `reset`, `steerText`, `followUpText`, `sessionId`, `errorMessage`, `isStreaming` — no Pi type on the public surface (structural `SparkleKernelAgent` slice) | `src/pi-adapter/kernel.ts`; exported from `src/pi-adapter/index.ts`; `test/unit/pi-adapter/kernel.test.ts` |
| `thinking_delta` → `{ type: "THINKING_DELTA", bytes }` — raw chain-of-thought never crosses the adapter | `translatePiEvent` in `src/pi-adapter/pi-executor.ts`; `src/execution/contract.ts`; persisted as byte-count summaries in `src/run/coordinator.ts` and `src/run/child-coordinator.ts`; `test/unit/pi-adapter/translate-thinking.test.ts` asserts the raw string does not serialize out |
| Source gates | `scripts/kernel-reuse-probe.mjs` (live-yield + `steerText` export checks) |

Verification run today on this tree:

- `node scripts/kernel-reuse-probe.mjs` — PASS, exit 0 (both checks).
- `pnpm exec tsx --test test/unit/pi-adapter/kernel.test.ts
  test/unit/pi-adapter/translate-thinking.test.ts
  test/integration/pi-adapter/live-stream.test.ts` — 5 pass, 0 fail.

## 2. Consumed `Agent` surface today

From `src/pi-adapter/pi-executor.ts` and `src/pi-adapter/kernel.ts`:

- **Constructor:** `initialState` (`systemPrompt`, `model`, `thinkingLevel`,
  `tools` — including cluster tools `sparkle_send` / `sparkle_inbox` /
  `sparkle_spawn_subagent`) and `streamFn` (closure over
  `models.streamSimple` with an optional static `apiKey` override).
- **Methods, product-wired:** `subscribe`, `prompt(string)`, `abort`,
  `waitForIdle` (all via the facade), `state.errorMessage`,
  `state.isStreaming`.
- **Methods, facade-exposed but not product-wired:** `steer`, `followUp`
  (as `steerText`/`followUpText`), `reset`, `sessionId`. Grep evidence:
  `rg -n "steerText|followUpText" src/` matches only `kernel.ts` and the
  `index.ts` export; the executor calls `SparkleKernel.fromFactory(...)`
  without options, so `sessionId` is never set on a real run.
- **Events consumed by `translatePiEvent`:** `message_update`
  (`text_delta`, `thinking_delta` arms), `tool_execution_start`,
  `tool_execution_end`, `turn_end` (usage extraction). Everything else
  falls through to `undefined`.

## 3. Unused API inventory and adoption order

Grep note: searching `src/` for every identifier below returns only
false-positive substrings (`hashInvocationResponse`, `onQuestion`,
`injectionPayloadError`) — none of these Pi APIs has a real call site
outside this audit.

### P0 — steering reachability (the Round-2 leftover, still unwired)

**APIs:** `steer`, `followUp` (kernel side done); supporting queue APIs
`hasQueuedMessages`, `clearSteeringQueue` / `clearFollowUpQueue` /
`clearAllQueues`, `steeringMode` / `followUpMode` (`"all"` vs
`"one-at-a-time"` drain).

**Gap, with evidence:** the kernel can steer a live agent but no product
path reaches it.

- `RunningRun` (returned by `startRun` in `src/run/coordinator.ts`) exposes
  `runId`, `done`, `cancel` — nothing else.
- `AgentExecutionRequest` (`src/execution/contract.ts`) has no channel for
  mid-run input.
- `pi-sparkle inject` (`src/cli/inject.ts` → `injectFlowchartRun` →
  `src/run/injection.ts`) validates `fact | override | skip` flowchart
  policy payloads. It writes policy facts for the flowchart supervisor; it
  does **not** steer a live Pi agent, and conflating the two would blur an
  audit boundary (policy injection is approval-gated via
  `requiresApproval`; steering is free-text into the model).

**What adoption needs:** a domain-contract decision (ADR-001 consequence
clause) on where the steer channel lives — a handle on `RunningRun` beside
`cancel`, or a request-scoped channel on `AgentExecutionRequest` — plus two
semantics decisions that are easy to get wrong later:

1. **Retry:** `runWithRetry` builds a fresh `Agent` per attempt, so queued
   steering does not survive a retried attempt. Re-arm or document-and-drop;
   pick one explicitly.
2. **Persistence:** steering text is user-authored input; the flowchart
   inject path records actor + payload in the event log, and steering
   should record no less (it is not chain-of-thought; the
   `THINKING_DELTA` redaction rule does not apply to it, but that call
   belongs in the decision, not in an implementation default).

`steeringMode`/`followUpMode` defaults (`"all"`) are acceptable for a first
wiring; expose them only when a consumer exists.

### P1 — enforcement hooks the domain already has data for

1. **`shouldStopAfterTurn`** — graceful stop after the current turn.
   pi-sparkle validates cost ceilings (`RunLimits.maxCostUsd` in
   `src/domain/limits.ts`, `ChildRunLimits.maxCostUsd` in
   `src/protocol/v1.ts`) and enforces them only in shadow experiments
   (`src/experiments/shadow.ts`); the live loop has none —
   `src/run/child-coordinator.ts` contains zero cost references, and the
   only budget-adjacent live control is wall-time. Usage already flows per
   turn (`TURN_FINISHED.usage`), so a turn-boundary budget gate is the
   natural first enforcement point. Adapter shape: an executor option
   (e.g. a sparkle-owned `onTurnBudget` callback fed from translated
   usage), not a Pi type leak; no `ExecutionEvent` change required.
2. **`beforeToolCall`** — policy gate before a tool executes, with
   `{ block, reason, terminate }` semantics. Today every tool handed to
   the `Agent` is unconditionally executable; pi-sparkle has approval
   machinery elsewhere (`requiresApproval` on injections, `ApprovalReply`
   in the child coordinator) but nothing between the model's tool call and
   execution. This is also the honest implementation point for a
   tool-allowlist kill switch (ADR-006's spirit: installing things grants
   no tool rights). `afterToolCall` can wait until a concrete
   result-rewriting need appears.

### P2 — real value, adopt when a consumer exists

- **`continue()`** — resume from the current transcript. Pairs with
  checkpoints for crash/abort recovery, but pi-sparkle does not persist the
  Pi transcript today, so this needs a transcript-retention decision first.
- **`thinkingBudgets`** — per-level thinking token caps forwarded to the
  stream function; a cost-control refinement once P1's budget gate exists.
- **`toolExecution: "sequential"`** — deterministic tool ordering (default
  is `"parallel"`); useful for reproducible audits and golden tests.
- **`tool_execution_update` event** — live partial tool results for
  supervision surfaces; must be summarized like `TOOL_FINISHED` is
  (bounded summary, no raw content in the event log).
- **Lifecycle events `agent_start` / `agent_end` / `turn_start` /
  `message_start` / `message_end`** — richer run timeline (e.g.
  `TURN_STARTED` for stall detection against `maxConsecutiveStalls`).
  `agent_end.messages` is also the only place the full transcript surfaces;
  capturing it is a privacy/persistence decision, not a default.
- **`prompt(messages)` / `prompt(text, images)`** — structured and
  multimodal prompts; no current caller needs either.
- **`transformContext`** — context pruning for long runs; adopt with an
  eviction policy, not ad hoc.
- **`getApiKey`** — per-call key resolution (short-lived OAuth tokens). Low
  urgency: `createPiRuntime` builds `builtinModels({ credentials })`, so
  built-in providers already resolve keys per call through
  `FileCredentialStore`; the static `apiKey` executor option is an override
  for one provider. Adopt only if a provider's token expiry bites mid-run.
- **State introspection (`state.messages`, `state.streamingMessage`,
  `state.pendingToolCalls`, `signal`)** — enables a live dashboard;
  transcript exposure needs the same privacy decision as `agent_end`.

### Parked — do not adopt without an explicit decision

- **`onPayload` / `onResponse`** — raw provider request/response payloads.
  Directly conflicts with the telemetry rule that response bodies are
  hashed, never retained (`hashInvocationResponse`); adopting these for
  debugging would create a standing CoT/content leak. Park behind a
  decision with a redaction design.
- **`convertToLlm` + `CustomAgentMessages` module augmentation** — Pi's
  extension point for custom message types. pi-sparkle's protocol
  (`src/protocol/v1.ts`) owns message shapes; augmenting Pi's union would
  couple the domain message model to Pi typing through the back door.
- **`prepareNextTurn` / `prepareNextTurnWithContext`** — mid-run model or
  context swaps. ADR-001 explicitly keeps routing assumptions out of the
  adapter; a mid-run router needs its own decision first.
- **`transport`, `maxRetryDelayMs`** — Pi-internal transport selection and
  provider-requested retry-delay caps. pi-sparkle already classifies and
  retries provider failures itself (`src/pi-adapter/provider-retry.ts`);
  before touching either knob, investigate how Pi-internal retries and the
  executor's `runWithRetry` interact so a failure is not retried at two
  layers with multiplied cost.

## 4. Cross-cutting findings

1. **Spec drift (needs an owner with spec write access; out of this
   round's write scope):** `docs/specs/m0-m2-architecture.md` reproduces
   the `ExecutionEvent` union (around lines 288–293) without
   `THINKING_DELTA` and without `MESSAGE`; the authoritative union in
   `src/execution/contract.ts` has both. Flagged by R1-opus-B's report as
   well.
2. **`sessionId` is advisory and currently unreachable:** the facade can
   set it, but the executor constructs kernels without options, and the
   fresh-Agent-per-retry design means any future adoption must copy the id
   across attempts deliberately.
3. **Retry × queues:** any P0 steering wiring inherits the
   fresh-Agent-per-attempt semantics; see P0.
4. **Do not extend by writing more executor.** The facade exists precisely
   so secondary features stop growing `PiAgentExecutor`; adoption items
   above should land as facade methods plus contract-level wiring, per
   `docs/kernel-reuse.md`.

## 5. Round 2 addendum (2026-08-24, R2-fable-A)

Re-verified on the same tree later the same day; every command below was run
for this addendum, not carried over. The tree mutated mid-round: a first
verification pass found P0 unwired (`RunningRun` exposed only `runId`,
`done`, `cancel`; `steerText` matched only `kernel.ts`), and the wiring
landed in the working tree while this addendum was being drafted. Item 1
records the post-landing state.

1. **P0 inject→steer landed (mid-round, uncommitted; parent commits).**
   Post-landing evidence:
   - `src/execution/contract.ts` gained optional
     `AgentExecutor.steerText?(text)` — absence means "steering
     unsupported"; the coordinator throws instead of dropping text.
   - `RunningRun` (`src/run/coordinator.ts`) gained
     `steer(text, { actor? })`, returned by both `startRun` and
     `startParentRun`, backed by a `SteerChannel` that is open only while
     execution is in flight, delivers to the executor before logging, and
     blocks run settlement on the event-log write.
   - Steer text persists with its actor as `STEER_INJECTED`
     (`src/run/events.ts`; replayed in `src/run/replay.ts`). The §3-P0
     persistence question was answered: verbatim text plus actor, distinct
     event type from flowchart injection.
   - Retry: document-and-drop — queued steering still does not survive the
     fresh-`Agent` retry (semantics unchanged from §3-P0 item 1).
   - Tests: `pnpm exec tsx --test` over `steer-inflight.test.ts`,
     `steer-blocked-tool.test.ts`, `test/integration/m0/steer.test.ts` —
     8 pass, 0 fail, 1 skip. The skip is a pre-landing placeholder
     (`test.skip("RunningRun.steer forwards in-flight text…")`) whose
     coverage now lives in `m0/steer.test.ts`; it should be removed.
   - **Gate correction:** the circulated claim gate
     `rg -n "RunningRun.steer" src/run/coordinator.ts` does not hit even
     post-landing, because `steer` is a member inside the multi-line
     interface block. Use `rg -n "steer\(text" src/run/coordinator.ts` or
     `rg -n -U "interface RunningRun \{[\s\S]*?steer\("
     src/run/coordinator.ts` (hits at the interface declaration).
   - Still open: a CLI verb for live steer (the product surface is the
     `RunningRun` handle); `followUpText` / `reset` / `sessionId` remain
     facade-only (`rg -n "followUpText" src/` → `kernel.ts` only).
   Correcting §2's phrasing while here: the `index.ts` export re-exports the
   `SparkleKernel` class, not the `steerText`/`followUpText` method names.
2. **§4.1 spec drift is resolved.** `docs/specs/m0-m2-architecture.md` now
   mirrors the contract union including `THINKING_DELTA { bytes }` and
   `MESSAGE`, with a pointer naming `src/execution/contract.ts` as
   authoritative (edited this round by R2-fable-A). Note the contract also
   gained `AgentExecutionRequest.maxCostUsd` mid-round (P1 work); the spec's
   request shape still drifts and needs a spec owner.
3. **The raw-substring boundary grep is stale.** As previously written in
   `docs/kernel-reuse.md`, `rg -n "@earendil-works" src/ --glob
   '!src/pi-adapter/**'` no longer returns empty: it hits
   `src/pi-compat/check.ts` lines 49, 50, 135, 136, 154, 155 — package names
   as *data* for version checks, not imports. The import-specifier form
   (`rg -n "(from|import\(|require\()\s*[\"']@earendil-works" src/ --glob
   '!src/pi-adapter/**'`) returns empty and matches the semantics of
   `hasPiPackageImport` in `test/unit/pi-boundary.test.ts`.
   `docs/kernel-reuse.md` is corrected; the overlay
   (`.agents/skills/pi-sparkle/references/kernel-reuse.md`) was updated by
   its owner mid-round for the steer landing but still carries the raw grep
   form in two places — flagged for its owner.
4. **Gates re-run for this addendum:** `node scripts/kernel-reuse-probe.mjs`
   PASS, exit 0 — the probe itself grew a third check mid-round
   (`executor-steer: PiAgentExecutor forwards steerText to a live kernel`)
   and all three pass; `pnpm exec tsx --test` over `kernel.test.ts`,
   `translate-thinking.test.ts`, `live-stream.test.ts` plus the three steer
   suites — 14 pass, 0 fail, 1 skip (the stale placeholder from item 1).
