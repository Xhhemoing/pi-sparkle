# File ownership — Loop 4 Round 2 (`agent/opt-continuous`)

Parent owns `.agent_workspace/PROGRESS.md`. Subagents never git commit.

Lists are binding and pairwise disjoint. Importing another slot's module is allowed; editing it is not.

| Slot | Model | Owns (create/edit) |
|---|---|---|
| R2-1 | opus | `src/run/flowchart-run.ts`, `test/integration/m2.5/flowchart-run.test.ts`, `test/integration/m2.5/children-flowchart.test.ts`, new unit test under `test/unit/run/` |
| R2-2 | gpt-sol | `src/persist/file-lock.ts`, `src/telemetry/invocation-log.ts` (classifier only), `test/unit/persist/file-lock.test.ts`, `test/unit/telemetry/invocation-log.test.ts` (classifier tests), `scripts/bench-runtime.mjs` |
| R2-3 | opus | `src/privacy/deletion.ts`, `test/unit/privacy/deletion.test.ts` |
| R2-4 | opus | `src/learning/auto-loop.ts`, `src/feedback/store.ts` (additive), `test/unit/learning/**`, `test/unit/feedback/store.test.ts` |
| R2-5 | opus | `src/run/child-coordinator.ts`, `src/protocol/v1.ts` (docs/fix-only), their unit tests (`test/unit/run/child-coordinator*.ts`, `test/unit/protocol/v1.test.ts`, `test/unit/protocol/fuzz.test.ts` must stay green) |
| R2-6 | gpt-sol | `scripts/crash-probe.mjs`, `test/integration/persist/crash-recovery.test.ts` |
| R2-7 | gpt-sol | new `test/unit/persist/row-fuzz.test.ts`; fix-only `src/episode/events.ts`, `src/run/pause-controller.ts`. Do **not** edit `src/feedback/store.ts` or `src/telemetry/invocation-log.ts` (R2-4 / R2-2); report colliding defects to parent. |
| R2-8 | opus | `src/cluster/mailbox.ts`, `test/unit/cluster/**` |
| R2-9 | opus | `src/run/scheduler.ts`, `test/unit/run/scheduler.test.ts` |
| R2-10 | gpt-sol | `docs/data-dictionary.md`, other `docs/*.md` strictly as needed for lock/temp/limit honesty |

Frozen: `appendJsonlLine` / `readJsonlObjects` signatures; `writeFileAtomic` contract; `episodeLockPath` symmetry; `runCommand` invocation-sink wiring. Only R2-2 may edit `withExclusiveFileLock`. No `package.json` / live R1 / Outcome-supported / ADR-006 Accepted / auto-promote.

Every slot: scoped eslint on owned files **and** whole-tree `tsc --noEmit` before reporting. Do not run full `pnpm test` / `pnpm gate`.
