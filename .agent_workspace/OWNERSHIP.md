# File ownership — Loop 4 (`agent/opt-continuous`)

Parent owns `.agent_workspace/PROGRESS.md`. Subagents never git commit.

## Round 1 — 10-slot exclusive ownership (from `.agent_workspace/loop4-r1-tasks.md`)

Lists are binding and pairwise disjoint. Importing another slot's module is allowed; editing it is not. `src/cli/main.ts` belongs to T2 **only inside `runCommand`'s two `createExecutor` call sites / hooks argument**; no other slot touches `main.ts`.

| Slot | Model | Owns (create/edit) |
|---|---|---|
| T1 | opus | `src/feedback/store.ts`, `src/privacy/deletion.ts`, `test/unit/feedback/store.test.ts`, `test/unit/privacy/deletion.test.ts` |
| T2 | opus | `src/telemetry/invocation-log.ts`, `src/cli/main.ts` (runCommand invocation-hook wiring only), `test/unit/telemetry/invocation-log.test.ts` |
| T3 | opus | `src/persist/atomic-file.ts` (new), `src/run/checkpoint-store.ts`, `src/run/pause-controller.ts`, `test/unit/persist/atomic-file.test.ts` (new), `test/unit/run/checkpoint-store.test.ts`, `test/unit/run/pause-controller.test.ts` |
| T4 | opus | `src/episode/store.ts`, `src/episode/events.ts`, `src/run/episode-bind.ts`, `src/run/episode-store.ts`, `test/unit/episode/**`, `test/unit/run/episode-bind.test.ts`, `test/unit/run/episode-store.test.ts` |
| T5 | opus | `src/pi-adapter/pi-executor.ts`, `test/unit/pi-adapter/executor-abort.test.ts` (new), `test/unit/pi-adapter/executor-retry.test.ts` |
| T6 | opus | `src/run/child-coordinator.ts`, `test/unit/run/child-coordinator-limits.test.ts` (new), `test/integration/m1/child-coordinator.test.ts` |
| T7 | gpt-sol | `src/persist/jsonl.ts` (signatures frozen), `scripts/bench-runtime.mjs`, `test/unit/persist/jsonl.test.ts` |
| T8 | gpt-sol | `src/protocol/v1.ts` (fix-only if fuzz finds a defect), `test/unit/protocol/fuzz.test.ts` (new), `test/unit/protocol/v1.test.ts` |
| T9 | gpt-sol | `src/cli/doctor.ts`, `test/unit/cli/doctor.test.ts`, `test/unit/cli/doctor-overlay.test.ts` (only if the seam requires), `test/unit/privacy/plane-boundary.test.ts` |
| T10 | gpt-sol | `scripts/crash-probe.mjs` (new), `test/integration/persist/crash-recovery.test.ts` (new) |

Shared freezes for the round: `appendJsonlLine` / `readJsonlObjects` exported signatures (T7 keeps them stable); `withExclusiveFileLock` untouched by all; no slot edits `package.json`, `pnpm-lock.yaml`, `README.md`, or `.github/**`.

Known baseline on this VM (Node 22.14.0): 2 pre-existing `test/unit/cli/doctor.test.ts` failures until T9 lands — only T9 may fix them.
