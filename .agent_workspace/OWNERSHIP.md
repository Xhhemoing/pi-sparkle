# File ownership — Loop 4 Round 5 (`agent/opt-continuous`)

Parent owns `.agent_workspace/PROGRESS.md`. Subagents never git commit. **Stay on branch `agent/opt-continuous`. Do not `git checkout` another branch.**

Lists are binding. Sole owners this round (no region-share): `flowchart-run.ts` = R5-1; `main.ts` = R5-9; `supervisor.ts` = R5-2.

Injection brief: `.agent_workspace/ROUND4-BRIEF.md`. Review: `.agent_workspace/loop4-r4-review.md`.

| Slot | Model | Owns |
|---|---|---|
| R5-1 | opus | `src/run/flowchart-run.ts` (sole), `src/run/coordinator.ts`, `test/unit/privacy/deletion.test.ts`, `test/integration/cli/delete.test.ts`, `test/unit/run/flowchart-run-abort.test.ts` (additions), plus a lifecycle-lock unit test. Do **not** lock `EventStore.append` / `CheckpointStore.write`. |
| R5-2 | opus | `src/run/supervisor.ts` (sole), `src/run/child-coordinator.ts`, new `src/run/crash-terminal.ts`, `test/integration/m2/` (supervisor-crash + resume), `test/integration/m2.5/children-flowchart.test.ts`. |
| R5-3 | opus | `src/learning/bandit-store.ts`, `test/unit/learning/` (bandit tests). No live-routing wiring. |
| R5-4 | gpt-sol | `src/config/providers-config.ts`, `src/pi-adapter/file-credential-store.ts`, `src/adaptation/promotion.ts`, their unit tests, `scripts/crash-probe.mjs` (sole owner). No `persist/` edits. |
| R5-5 | opus | `test/integration/m2.5/resume.test.ts`, additive pins in `test/unit/run/flowchart-run-abort.test.ts` only. **No `src/**`.** Investigation + report; prototype stays out of the tree. |
| R5-6 | opus | `src/cluster/mailbox.ts`, `src/cluster/host.ts` (docs), `test/unit/cluster/`, additive `test/integration/cluster/undelivered-mail.test.ts`. Parent sign-off: option **(b)** only. |
| R5-7 | gpt-sol | `docs/**` only. Timestamp-disclose in-flight R5-1/2/6; do not predict. |
| R5-8 | gpt-sol | `test/integration/pi-adapter/`, `test/helpers/`. **No `src/**`.** Own stderr-pin updates with disclosure. |
| R5-9 | opus | `src/cli/main.ts` (sole), `src/cli/errors.ts`, new `test/integration/cli/command-error-doctor.test.ts` (and pause-failure tests if needed). Do **not** edit `delete.test.ts` (R5-1). Keep sink-wiring + resume-disclosure pins green. |
| R5-10 | gpt-sol | `src/episode/replay.ts`, `src/run/checkpoint-store.ts` (**read method only** — write + run-lock decision pin frozen), `src/cli/flowchart-io.ts`, `test/unit/episode/replay.test.ts`, additive `test/unit/run/checkpoint-store.test.ts`. |

**Parent sign-offs**
- R5-1: SIGKILL leaving a no-steal run lock is accepted; doctor inventories it; delete waits (bounded) rather than refusing a live run. Keep double-verify + `RUN_RECORDS_SURVIVED`.
- R5-6: option (b) — requeue bound means “this mail survived N claim opportunities.” Keep `deadLetterReport()` / `onDeadLetter` shapes and the pinned undelivered-mail line format. Do **not** take stable per-task agent identity (c).

Frozen: jsonl; `writeFileAtomic` + `writeFileAtomicSync`; `withExclusiveFileLock` + `LOCK_TIMEOUT_CODE`; `runLockPath` no-steal; append/checkpoint stay unlocked unless a new same-VM bench reopens it; `recordCrashTerminal` in-flight-only; `applyRetry` sole BLOCKED→READY; ClusterMailReport + warning line; resume disclosure cases; tombstone/catalog/preference error codes; no live R1 / Outcome-supported / ADR-006 Accepted / auto-promote / `package.json`.

Every slot: census first; scoped eslint + whole-tree `tsc --noEmit`; 3× timing-sensitive tests; report `.agent_workspace/loop4-r5-tN.md`. No full gate. No scratch files at report time.
