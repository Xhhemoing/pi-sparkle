# Round 2 kernel-reuse brief (inject into every Round 3 agent)

Parent, 2026-08-24. Branch `cursor/pi-kernel-reuse-e1e3`. PR https://github.com/Xhhemoing/pi-sparkle/pull/5

## Landed

- **Live steer:** `RunningRun.steer(text, { actor })` → `AgentExecutor.steerText?` → live `SparkleKernel`. Empty text fails closed. Multi-agent same executor refuses to guess. `STEER_INJECTED` logs actor+text (not CoT). Retry = new Agent, queues dropped. FakeExecutor has no `steerText` (explicit unsupported). Tests: `test/integration/m0/steer.test.ts`, `steer-blocked-tool.test.ts`.
- **Cost gate (adapter):** `src/pi-adapter/cost-gate.ts` + `shouldStopAfterTurn` when `maxCostUsd` **and** catalog prices exist. Unknown/zero catalog → unpriced, **no invented USD**, cap not claimed. **Coordinator does not yet pass `maxCostUsd` on `AgentExecutionRequest`** — live runs still uncapped until Round 3 wires `run.limits.maxCostUsd`.
- Spec union includes `THINKING_DELTA`; kernel-reuse docs updated after mid-round steer landing.
- Overlay: per-layer claim rule; THINKING_DELTA bytes-only treated as landed.

## Do not regress

ADR-001/006; sync subscribe listeners; thinking text never in logs; steer text **is** loggable.

## Known collisions

- Pi consults `shouldStopAfterTurn` **before** draining steering; a cost stop can drop an in-flight steer. Document or reorder if safe without Pi forks.
- `test/unit/pi-adapter/steer-inflight.test.ts` still `test.skip` for RunningRun.steer — enable or delete skip.
- `rg RunningRun.steer src/run/coordinator.ts` misses multiline interface; do not use that grep as the only gate.

## Round 3 targets

1. Pass `maxCostUsd` from `Run.limits` into `PiAgentExecutor.execute` (parent + child builders).
2. Unskip/fix steer-inflight test; optional CLI `steer` only if it is a thin wrapper on a live handle (do not fake a daemon).
3. Document cost-stop vs steer ordering.
4. Overlay import-specifier ADR-001 grep (not raw `@earendil-works` substring on `pi-compat/check.ts` strings).
5. `pnpm gate` green.

No git commit. Parent commits.
