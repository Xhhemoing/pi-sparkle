# File ownership — Loop 4 Round 3 (`agent/opt-continuous`)

Parent owns `.agent_workspace/PROGRESS.md`. Subagents never git commit.

Lists are binding and pairwise disjoint. Importing another slot's module is allowed; editing it is not.

| Slot | Model | Owns (create/edit) |
|---|---|---|
| R3-1 | opus | `src/telemetry/model-invocation.ts`, `test/unit/persist/row-fuzz.test.ts` (un-skip only), `test/unit/telemetry/model-invocation.test.ts`, `test/unit/routing/` cost-calibration tests as needed |
| R3-2 | gpt-sol | `src/feedback/store.ts`, `src/telemetry/invocation-log.ts`, `scripts/crash-probe.mjs`, `test/integration/persist/crash-recovery.test.ts`, `test/unit/feedback/store.test.ts`, `test/unit/telemetry/invocation-log.test.ts` |
| R3-3 | opus | `src/privacy/deletion.ts`, `test/unit/privacy/deletion.test.ts`, `test/integration/cli/delete.test.ts`. Do **not** edit `event-store.ts` (R3-4); report if a writer-side lock needs that file. |
| R3-4 | gpt-sol | `src/run/events.ts`, `src/run/event-store.ts`, new `test/unit/run/event-row-fuzz.test.ts`, `test/unit/run/events.test.ts` |
| R3-5 | opus | `src/run/flowchart-run.ts`, `src/run/child-coordinator.ts`, `test/unit/run/flowchart-run-abort.test.ts`, `test/integration/m2.5/children-flowchart.test.ts` |
| R3-6 | gpt-sol | `src/cli/doctor.ts`, `test/unit/cli/doctor.test.ts`. Do **not** edit `file-lock.ts` (re-frozen). |
| R3-7 | opus | `src/cluster/host.ts`, `test/unit/cluster/` (not `mailbox.ts`) |
| R3-8 | opus | `src/run/scheduler.ts`, `src/run/supervisor.ts`, `test/unit/run/scheduler.test.ts`, `test/integration/m2/scheduler.test.ts` |
| R3-9 | opus | `src/cli/main.ts` (resumeCommand two `createExecutor` sites + sink construction only), new `test/unit/cli/invocation-sink-wiring.test.ts` |
| R3-10 | gpt-sol | `docs/**`, `src/privacy/record-classes.ts` (comments only) |

Frozen: jsonl signatures; `writeFileAtomic`; `episodeLockPath`; `runCommand` sink wiring; `withExclusiveFileLock` + `LOCK_TIMEOUT_CODE`; R2-3/R2-4/R2-5/R2-8 landed surfaces. No `package.json` / live R1 / Outcome-supported / ADR-006 Accepted / auto-promote.

Every slot: scoped eslint + whole-tree `tsc --noEmit`. Do not run full `pnpm test` / `pnpm gate`. Unowned defects: named-skip + report, do not patch.
