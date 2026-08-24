# Orchestrator — Pi slim-kernel reuse & effectiveness

**Goal:** On the slim Pi kernel (`@earendil-works/pi-agent-core` + `pi-ai` behind `src/pi-adapter/`), reuse unused Agent capabilities for secondary development and improve runtime effectiveness. Do **not** take a dependency on `pi-coding-agent`. ADR-001 / ADR-006 stay in force.

**Branch:** `cursor/pi-kernel-reuse-e1e3` (from `origin/main` @ persistent-opt merge). Cloud naming; maps user SOP `agent/<task>`.

**Kernel facts (0.84.3 `Agent`):** `subscribe`, `prompt`, `continue`, `abort`, `reset`, `waitForIdle`, `steer`, `followUp`, steering/follow-up queues, `sessionId`, `thinkingBudgets`, `toolExecution`. Events: `agent_start`/`agent_end`, `turn_start`/`turn_end`, `message_*`, `tool_execution_*`. Stream deltas include `text_delta` and `thinking_delta`.

**Current gaps (evidence):**
- `PiAgentExecutor.execute` **buffers** `subscribe` events and yields them only after `waitForIdle` — supervisors see no live tokens.
- `translatePiEvent` ignores `thinking_delta` and most lifecycle events.
- `steer` / `followUp` / `continue` / `sessionId` / `thinkingBudgets` are unused.
- Sparkle `inject` writes flowchart policy facts; it does **not** steer a live Pi Agent.
- Cluster tools wrap spawn/send/inbox; the kernel itself is not a reusable secondary-dev facade.

## Shared invariants

- Pi imports only in `src/pi-adapter/**`.
- No inbound Pi extension. No PowerShell tool. No coding-agent package.
- Do not git commit. Parent commits after the round.
- First line of every report: actual `MODEL_SLUG: …`.

## File ownership — Round 1 (exclusive)

| Agent | Model | Writes | Must not touch |
|---|---|---|---|
| R1-fable-A | `claude-fable-5-thinking-xhigh` | `docs/kernel-reuse.md`, `docs/reports/2026-08-24-kernel-reuse-audit.md`, `.agent_workspace/round1-fable-a.md` | `src/` |
| R1-fable-B | `claude-fable-5-thinking-xhigh` | `.agents/skills/pi-sparkle/**` (add `references/kernel-reuse.md`, SKILL table row), `.agent_workspace/round1-fable-b.md` | `src/`, `docs/` |
| R1-opus-A | `claude-opus-5-thinking-high-fast` | `src/pi-adapter/kernel.ts` (new facade), `src/pi-adapter/index.ts`, `src/pi-adapter/pi-executor.ts` **execute() live-yield only** (keep `translatePiEvent` body), `.agent_workspace/round1-opus-a.md` | `src/execution/`, skills |
| R1-opus-B | `claude-opus-5-thinking-high-fast` | `translatePiEvent` in `pi-executor.ts` **only the switch**, `src/execution/contract.ts` add `THINKING_DELTA`, `src/run/coordinator.ts` / `src/run/events.ts` to persist thinking deltas like text (length only, no CoT body in events if policy forbids — hash or omit text if redaction requires), `src/run/child-coordinator.ts` if it switches on event type, `.agent_workspace/round1-opus-b.md` | `src/pi-adapter/kernel.ts`, skills |
| R1-gpt-A | `gpt-5.6-sol-xhigh-fast` | `scripts/kernel-reuse-probe.mjs`, `test/integration/pi-adapter/live-stream.test.ts`, `.agent_workspace/round1-gpt-a.md` | `src/cli/main.ts` |
| R1-gpt-B | `gpt-5.6-sol-xhigh-fast` | `test/unit/pi-adapter/kernel.test.ts`, `test/unit/pi-adapter/translate-thinking.test.ts`, `.agent_workspace/round1-gpt-b.md` | `src/cli/main.ts` |

If `kernel.ts` is missing when gpt-B tests, skip kernel tests and still add thinking-delta translation tests against `translatePiEvent`.

## Round 1 targets

1. **Live yield:** `for await` consumers receive `TEXT_DELTA` before `waitForIdle` resolves (queue + subscribe). Abort still maps to `agent.abort()`.
2. **Facade:** `SparkleKernel` wrapping Agent: `prompt`, `abort`, `steerText`, `followUpText`, `reset`, `waitForIdle`, optional `sessionId`. Sparkle types only on the public surface.
3. **thinking_delta → THINKING_DELTA** (or omit payload and emit `{ type:"THINKING_DELTA", bytes:number }` to avoid persisting CoT — prefer **no raw thinking text** in the event log; length/bytes only).
4. Probe + tests. Docs/skill explain how to extend sparkle using the facade instead of importing Pi.

## Round log

### Round 1 — in progress

| ID | Focus | Task |
|---|---|---|
| R1-fable-A | kernel reuse audit + playbook | `bc-f4a10f69-f460-5fbe-8ca5-3db216cc1a67` |
| R1-fable-B | overlay extender checklist | `bc-8382087f-263f-58db-84e4-de0ca9aebd32` |
| R1-opus-A | SparkleKernel + live yield | `bc-8ddcca19-64d5-53d2-ba45-2df2d57dcd07` |
| R1-opus-B | thinking_delta mapping | `bc-dc5ea9f2-9a41-5a2a-b77d-ac0b75da407d` |
| R1-gpt-A | live-stream probe | `bc-947807f5-4030-59e9-9be3-9a81d79ba7be` |
| R1-gpt-B | kernel/thinking tests | `bc-39dbcf25-e3b4-5029-8356-2ada5f58b53c` |
### Round 1 — complete (2026-08-24)

All 6 delivered (fable-A retried after dispatch error `bc-3363607a-52c2-5177-8b2b-b4433e7be06a`). Live yield, SparkleKernel, bytes-only THINKING_DELTA, probe/tests/docs. Brief: `.agent_workspace/R1-KERNEL-BRIEF.md`.

P0 leftover: inject→steer still unwired. P1: shouldStopAfterTurn / maxCostUsd live enforcement. Spec union stale.

### Round 2 — complete

Live `RunningRun.steer` + adapter cost gate (cap not forwarded from coordinator yet). Brief: `.agent_workspace/R2-KERNEL-BRIEF.md`.

### Round 3 — in progress (SOTA close-out)

Read `.agent_workspace/R2-KERNEL-BRIEF.md`. No commit.

| Agent | Model | Owns | Must not touch |
|---|---|---|---|
| R3-fable-A | `claude-fable-5-thinking-xhigh` | docs: cost-stop vs steer order; coordinator maxCostUsd wiring called out; `.agent_workspace/round3-fable-a.md` | `src/` except you must not |
| R3-fable-B | `claude-fable-5-thinking-xhigh` | overlay ADR-001 import-specifier grep; per-layer claims after R3 wiring, `.agent_workspace/round3-fable-b.md` | `src/` |
| R3-opus-A | `claude-opus-5-thinking-high-fast` | pass `run.limits.maxCostUsd` into execute() parent+child, `.agent_workspace/round3-opus-a.md` | overlay |
| R3-opus-B | `claude-opus-5-thinking-high-fast` | unskip `steer-inflight.test.ts`; document or safely handle cost-stop dropping steer; `.agent_workspace/round3-opus-b.md` | `src/pi-adapter/cost-gate.ts` arithmetic |
| R3-gpt-A | `gpt-5.6-sol-xhigh-fast` | tests that coordinator forwards maxCostUsd; `.agent_workspace/round3-gpt-a.md` | `src/cli/main.ts` |
| R3-gpt-B | `gpt-5.6-sol-xhigh-fast` | run `pnpm gate` and fix test/lint in owned test files; `.agent_workspace/round3-gpt-b.md` | `src/pi-adapter/kernel.ts` API shape |

Read `.agent_workspace/R2-KERNEL-BRIEF.md`. No commit.
