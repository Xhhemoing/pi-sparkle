# Round 1 kernel-reuse brief (inject into every Round 2 agent)

Parent, 2026-08-24. Branch `cursor/pi-kernel-reuse-e1e3`. PR https://github.com/Xhhemoing/pi-sparkle/pull/5

## Landed (do not redo)

- **Live yield:** `PiAgentExecutor` drains an async queue from `SparkleKernel.subscribe`; first `TEXT_DELTA` can arrive before idle. Consumer drop aborts the agent.
- **`SparkleKernel`** (`src/pi-adapter/kernel.ts`): `prompt`, `abort`, `waitForIdle`, `reset`, `steerText`, `followUpText`, `sessionId`, opaque events. No Pi types on the public surface. Retry uses a **fresh Agent** → steering queues do **not** survive retry.
- **`THINKING_DELTA { bytes }`** only; CoT string must never leave `translatePiEvent`. Coordinators log `thinking delta (N bytes)`.
- Probe `scripts/kernel-reuse-probe.mjs`; tests: `kernel.test.ts`, `translate-thinking.test.ts`, `live-stream.test.ts`.
- Docs/overlay: `docs/kernel-reuse.md`, audit, `.agents/skills/pi-sparkle/references/kernel-reuse.md`.

## Do not regress

- ADR-001 / ADR-006. Sync subscribe listeners only (async listener + consumer wait deadlocks idle).
- Hash-only telemetry: thinking bytes must not enter `responseText`.
- No `pi-coding-agent`. No inbound extension.

## Round 2 targets (P0 → P1)

1. **inject→steer (P0):** `steerText` is facade-only. Add `AgentExecutor.steerText?(text)` (Pi implements; fake no-op or explicit error), `RunningRun.steer(text)` while `execute` is in flight. Distinguish flowchart `inject` (policy facts) from live steer. Steering does not survive retry. Persist steer **text** in the event log with actor (not CoT). Tests: steer during a blocked-tool faux run.
2. **`shouldStopAfterTurn` (P1):** domain `maxCostUsd` is validated but the live loop does not stop. Map accumulated invocation cost → kernel/agent stop-after-turn **inside the adapter**, no Pi types leaking. If pricing catalog missing, fail closed to “no stop” + log, do not invent prices.
3. Spec `docs/specs/m0-m2-architecture.md` ExecutionEvent union: add `THINKING_DELTA` (and keep honest about `MESSAGE`).
4. Overlay: `steerText` is **exposed**; live product wiring is Round 2 — update grep-before-claim after opus-A lands.

No git commit. Parent commits.
