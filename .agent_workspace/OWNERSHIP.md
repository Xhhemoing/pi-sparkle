# File ownership — Loop 4 Round 4 (`agent/opt-continuous`)

Parent owns `.agent_workspace/PROGRESS.md`. Subagents never git commit. **Stay on branch `agent/opt-continuous`. Do not `git checkout` another branch.**

Lists are binding. Region-shared files: edit only the named region.

| Slot | Model | Owns |
|---|---|---|
| R4-1 | opus | `src/run/event-store.ts`, `src/run/checkpoint-store.ts`, `src/run/pause-controller.ts`, `src/track/loop.ts`, `src/privacy/deletion.ts`, `test/unit/privacy/deletion.test.ts`, `test/integration/cli/delete.test.ts`, plus those writers' unit tests. If `writeFeedbackTombstones` exists (R4-7), swap the tombstone write to it. |
| R4-2 | opus | `src/run/coordinator.ts`; `src/run/flowchart-run.ts` **only** `createClusterHost` option objects + outcome/summary plumbing; `src/cli/main.ts` **only** run-summary/warning output (not `resumeCommand`); `test/integration/cluster/`; m2.5 additions if needed |
| R4-3 | opus | `src/run/supervisor.ts`, `src/run/scheduler.ts`, `test/unit/run/scheduler.test.ts`, `test/integration/m2/` |
| R4-4 | opus | `src/run/flowchart-run.ts` **only** `recordCrashTerminal`/teardown; `src/run/child-coordinator.ts`; `test/unit/run/flowchart-run-abort.test.ts`; `test/integration/m2.5/children-flowchart.test.ts` |
| R4-5 | gpt-sol | `src/cli/doctor.ts`, `test/unit/cli/doctor.test.ts`. Do **not** edit `file-lock.ts` or `main.ts`. |
| R4-6 | opus | `src/cli/main.ts` **only** `resumeCommand`; `test/unit/cli/invocation-sink-wiring.test.ts`; a behavioral resume test. Keep the no-unhooked-`createExecutor` pin green. |
| R4-7 | gpt-sol | `src/feedback/store.ts`, `test/unit/feedback/store.test.ts`, `test/unit/persist/row-fuzz.test.ts`, `scripts/crash-probe.mjs` (sole owner this round). Export `writeFeedbackTombstones` for R4-1. |
| R4-8 | gpt-sol | `docs/**` only. Sync with R4-1/R4-2/R4-6 if already landed; otherwise disclose in-flight. |
| R4-9 | opus | `src/routing/catalog-observed.ts`, `src/preferences/store.ts`, `test/unit/routing/` observed-catalog tests, `test/unit/preferences/` |
| R4-10 | gpt-sol | `test/integration/pi-adapter/` (new fixture + tests), `test/helpers/`. **No src/**. If protocol needs adapter src, stop and report. |

Frozen: jsonl signatures; `writeFileAtomic`; `withExclusiveFileLock` + `LOCK_TIMEOUT_CODE`; `episodeLockPath`; `runCommand` sink; R3-1 `isInvocation` never-throws; `RunRecordsSurvivedError` code; `deadLetterReport`/`onDeadLetter` shapes; `planRound` 4-arg pin. No live R1 / Outcome-supported / ADR-006 Accepted / auto-promote / `package.json`.

Every slot: scoped eslint + whole-tree `tsc --noEmit`. No full gate. Census before trusting the brief.
