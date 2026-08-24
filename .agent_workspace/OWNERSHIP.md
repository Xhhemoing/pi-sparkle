# File ownership — Loop 4 Round 9 (`agent/opt-continuous`)

Parent owns `.agent_workspace/PROGRESS.md`. Subagents never git commit. **Stay on branch `agent/opt-continuous`. Do not `git checkout` another branch.**

Lists are binding. **Hard contention:** R9-1 owns `replay.ts` + `flowchart-run.ts` + `main.ts` + `resume.test.ts`. R9-3 is **design-only** (same files). Do not co-schedule an executed-descendant implementation.

Injection brief: `.agent_workspace/ROUND8-BRIEF.md`. Review: `.agent_workspace/loop4-r8-review.md`. Contract design: `.agent_workspace/loop4-r8-t2.md`. Option-(a) design: `.agent_workspace/loop4-r8-t4.md`.

| Slot | Model | Owns |
|---|---|---|
| R9-1 | opus | `src/run/replay.ts`, `src/run/flowchart-run.ts`, `src/cli/main.ts` (all sole); `test/integration/m2.5/resume.test.ts`; `test/unit/supervisor/flowchart-snapshot.test.ts`; `test/unit/persist/row-fuzz.test.ts`; additive replay/checkpoint tests. Durable `contract` on the flowchart checkpoint. Fold: R8-2 region-regex nit; R8-8's producer-side `INSPECT_SUMMARY` one-liner at the `main.ts` literal. **Do not** add per-task criteria on the checkpoint. |
| R9-2 | opus | `src/pi-adapter/pi-executor.ts` (sole), `test/unit/pi-adapter/`, `test/unit/tracking/option-a-preconditions.test.ts` (**pin 2 only**). Executor verdict producer. **No `protocol/v1` schema.** |
| R9-3 | gpt-sol | Report + additive pins in `test/unit/supervisor/` at most. **No `src/**`.** Executed-descendant discard design. |
| R9-4 | gpt-sol | `docs/**` only. Timestamp-census the working tree. **Do not touch any ADR status line.** ADR body `0005` stays flag-only. |
| R9-5 | gpt-sol | `scripts/crash-probe.mjs`, `test/integration/m2/crash-recovery.test.ts` (the name-list pin only). Unblock append-before-checkpoint SIGKILL case. If the window cannot be hit from outside, stop and report. |
| R9-6 | opus | `src/run/gate-apply.ts` (sole), additive `test/unit/run/`. Parent sign-off: **record the posture in-source** — do not give `runStatus` a new consumer. |
| R9-7 | gpt-sol | New `test/unit/cli/doctor-routed-next-freeze.test.ts`. **No `src/**`.** Character-exact freeze of the five `DOCTOR_ROUTED_NEXT` routes + `GENERIC_FAILURE_NEXT` (R9-1 edits `main.ts` and must keep this green). |
| R9-8 | gpt-sol | Additive only in `test/unit/run/flowchart-run-abort.test.ts`. **No `src/**`.** Reconstruction-contract freeze: resume still uses `childTasksFromLog`; FAIL-unreachable tripwire still present. R9-1 must keep both green. |
| R9-9 | gpt-sol | Additive only in `test/unit/routing/live-isolation.test.ts`. **No `src/**`.** After R8-9: doctor still calls `loadProjectBanditByKey`; `selectArm` still has no live caller; `loadProjectBandit` stays absent from `src`. Do not weaken the signed-off `because`. |
| R9-10 | gpt-sol | New `test/unit/run/run-unblocked-schema-freeze.test.ts` (or additive in `test/unit/run/event-row-fuzz.test.ts` if tighter). **No `src/**`.** Freeze `RUN_UNBLOCKED` payload exact keys `{ blockedEventId, reason, retryNodeId? }` and `TERMINAL_REPLAY_STATUSES` membership. Do not add a field. |

**Parent sign-off**
- **R9-1: YES — persisted schema** `contract?: RequirementContract` on `FlowchartCheckpointState` (`schemaVersion: 1`; absence stays valid) as `.agent_workspace/loop4-r8-t2.md` designed. Validate via `validateRequirementContract`. Written at persist when `ctx.contract` is defined; restored by `restoreFlowchartSession`; CLI `flowchartContinuation` projects it; precedence `continuation.contract ?? checkpoint.flowchart.contract`. **Never synthesize from the episode.** Flip `a resume that is handed no contract assesses its children against none` **with disclosure** through the production CLI boundary (`constraint-retention: PASS`). Reserve a **comment** that per-task acceptance criteria may ride this seam later — do **not** implement that field (option (a) stays design-gated). Fix R8-2's `resumeCommand` region-regex boundary when replacing the absence pins. Add the `INSPECT_SUMMARY` freeze one-liner at the `main.ts` producer literal.
- **R9-2: YES — a `report_task_result` tool** on `PiAgentExecutor` through the existing per-request tool seam. Existing protocol `TASK_RESULT` carries `verification.kind` PASSED/FAILED + evidence ids. **No protocol schema change.** Replace R8-4 pin 2 in the same diff (re-derive the producer census, do not delete). Disclose which gate outcomes become reachable for `--executor pi`. Do not implement per-criterion `VerificationResult.criteria`.
- **R9-3: DESIGN ONLY.** `RUN_UNBLOCKED` payload is exact-key frozen — a new field is a future schema sign-off, not this round's src.
- **R9-6: record the posture in-source** at `applyChildThreeLine` / `currentGateStatus`: this is a consistency ledger for the transition record, deliberately not a control input on the flowchart plane. Do not silently grow the gate's authority.

Frozen: `RUN_UNBLOCKED` semantics + four-line BLOCKED operator block + R8-3 AST pin; `INSPECT_SUMMARY` additive freeze; `loadProjectBandit` absence; catalog posture (b); parent-plane residual decisions; reconstruction `childTasksFromLog` + FAIL-unreachable tripwire; criteria-are-guidance + 270-cell + sole-production-path; `recordCrashTerminal` rethrow; `applyRetry` sole scheduler producer; jsonl; `writeFileAtomic`(+Sync); no new private tmp+rename; `withRunLifecycleLock`; append/checkpoint unlocked; five `DOCTOR_ROUTED_NEXT` routes character-exact; loopback supervised resume stderr pin; empty-graph pre-flight; `settleSupervisedOutcome` absence; one-definition-of-terminal; no live R1 / Outcome-supported / ADR-006 Accepted / auto-promote / `package.json`.

Every slot: census first against the working tree; scoped eslint + whole-tree `tsc --noEmit`; 3× timing-sensitive tests; report `.agent_workspace/loop4-r9-tN.md`. Census consumers. Run `live-isolation.test.ts` if you add an import inside the live closure. No full gate. No scratch files. Docs slots census the working tree with timestamps.
