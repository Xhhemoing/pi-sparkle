# File ownership — Loop 4 Round 8 (`agent/opt-continuous`)

Parent owns `.agent_workspace/PROGRESS.md`. Subagents never git commit. **Stay on branch `agent/opt-continuous`. Do not `git checkout` another branch.**

Lists are binding. **Hard contention resolved at dispatch:** R8-1 owns `replay.ts` + `flowchart-run.ts` + `events.ts` + `gate-apply.ts` + `main.ts` + `flowchart-supervisor.ts`. R8-2 (durable contract) is **design + pins only this half** — no `src/**` — because those files belong to R8-1. Brief's R8-3 (BLOCKED `next:` on resume/answer) is **folded into R8-1**. Brief skipped R8-8; this table's R8-8 is the INSPECT_SUMMARY freeze leftover, not `cappedByHardFail`.

Injection brief: `.agent_workspace/ROUND7-BRIEF.md`. Review: `.agent_workspace/loop4-r7-review.md`. R7-3 design: `.agent_workspace/loop4-r7-t3.md`.

Dispatch ids: R8-1 `bc-04e9b0fd-7eac-5257-99ec-80f014de2983`; R8-2 `bc-e54c339d-20d2-599e-89ca-e9e129dcecad`; R8-3 `bc-6f365607-85cc-5b6f-94bc-ccb7a9424536`; R8-4 `bc-4f1f0ff5-4040-5760-a667-45e9554bfa73`; R8-5 `bc-d3903dd3-62a2-5c09-9715-4288654bb589`; R8-6 `bc-0909b159-52b0-5839-ab9e-dc4aef25892e`; R8-7 `bc-5ac3620f-d1e6-552f-8d6f-2511b8b8c97a`; R8-8 `bc-faed627a-27aa-592a-abaf-747f13f608fc`; R8-9 `bc-fa848108-24c4-5b92-8430-a0dc6683f100`; R8-10 `bc-6d55b575-e843-5581-bac0-6370415d16ac`.

| Slot | Model | Owns |
|---|---|---|
| R8-1 | opus | `src/run/events.ts`, `src/run/replay.ts`, `src/run/gate-apply.ts`, `src/run/flowchart-run.ts`, `src/supervisor/flowchart-supervisor.ts`, `src/cli/main.ts` (all sole); `test/unit/run/replay.test.ts`; `test/unit/run/event-row-fuzz.test.ts`; `test/integration/cli/blocked-next.test.ts` (the note-line pin); additive integration tests. Ship `RUN_UNBLOCKED`. Fold brief R8-3: flowchart `resume`/`answer` BLOCKED reports. Leave the supervised-resume loopback byte-pin **untouched**. |
| R8-2 | gpt-sol | Additive pins in `test/integration/m2.5/resume.test.ts` only. **No `src/**`.** Design durable `contract` for the half after R8-1. Do not flip the no-contract pin. |
| R8-4 | opus | Report + additive pins in `test/unit/tracking/` at most. **No `src/**`, no `protocol/v1` edit.** Option (a) design-first. |
| R8-5 | gpt-sol | `docs/**` only. Timestamp-census the working tree for in-flight Round 8 edits. **Do not touch any ADR status line.** Optionally the one `src/run/supervisor.ts` comment (stale empty-list seed) with disclosure — that file is otherwise unowned this round. |
| R8-6 | gpt-sol | `src/routing/catalog-observed.ts` (posture comment only), `test/integration/cli/command-error-doctor.test.ts`. **No `src/cli/main.ts`.** Parent sign-off: option **(b)**. |
| R8-7 | opus | `src/run/coordinator.ts` (sole), additive `test/unit/run/`. **Do not edit `src/run/crash-terminal.ts`.** |
| R8-8 | opus | `src/run/inspection.ts` (comment/docstring only if needed), `test/unit/run/inspection.test.ts`. Freeze `INSPECT_SUMMARY` as additive. **No `src/cli/main.ts`.** |
| R8-9 | gpt-sol | `src/learning/bandit-store.ts` (sole), `test/unit/learning/`. Census-and-delete root-keyed `loadProjectBandit` with an absence pin. Do not weaken the isolation pin. |
| R8-10 | gpt-sol | Additive only in `test/integration/m2/supervisor-crash.test.ts`. Re-seed the bound-episode pre-rounds settle. **No `src/**`** unless the seed is unreachable — then stop and report. |
| R8-3 | gpt-sol | New `test/unit/run/flowchart-applyretry-absence.test.ts` (or additive in `test/unit/run/scheduler.test.ts` if that is the existing sole-producer pin's file). Negative pin: flowchart unblock path must not import/call `applyRetry`. **No `src/**`.** R8-1 must keep this pin green. |

**Parent sign-off**
- **R8-1: YES — new persisted schema** `RUN_UNBLOCKED { blockedEventId, reason, retryNodeId? }` exactly as `.agent_workspace/loop4-r7-t3.md`. Dedicated locked `unblock` command, not a fourth injection kind. Replace (do not weaken) the vocabulary-absence tripwire. `applyRetry` stays the sole scheduler BLOCKED→READY producer. Fold brief R8-3 into this slot (flowchart resume/answer `formatBlockedRunReport`; update the `note:` now that unblock exists). **Do not amend** `loopback-cli-resume.test.ts`'s supervised BLOCKED stderr byte-pin.
- **R8-2: NO persisted schema this half** (`replay.ts` / `flowchart-run.ts` belong to R8-1). Design + current-absence pins only.
- **R8-4: DESIGN ONLY.** Do not sign off the protocol field, the gate mechanism, or the never-ran-node posture this round. Deliver the three shapes for a later sign-off.
- **R8-6: option (b)** — the catalog route is defense-in-depth for a future producer. Record that posture in-source at `catalog-observed.ts` (not `main.ts`). Land the already-reproduced **bandit** `adapt auto` producer test. Do not drop `CATALOG_OBSERVED_CORRUPT` from `DOCTOR_ROUTED_NEXT` (frozen five-route map). Drop the now-unnecessary `configurePreferencePersistence(undefined)` `finally` repair while in the test file.
- **R8-7:** do **not** amend `crash-terminal.ts`'s rethrow contract. Parent-plane `waiting` flag + terminal-keyed refusal is the owned decision (a crash over WAITING_FOR_USER still records `RUN_FAILED`). `RUN_CANCEL_REQUESTED` stays unguarded (operator fact, both planes). Record both in-source. Fold the `failureReason` write-only residue at `coordinator.ts:608`.
- **R8-8:** freeze current `INSPECT_SUMMARY` shape (`type` / `runId` / `status` / `requiredEvidence`, no `id`, not an Event) as **additive** like doctor `--json`. Strengthen the existing `deepEqual` pin; extra keys must fail.
- **R8-9:** delete `loadProjectBandit`. Adaptation can use `loadProjectBanditByKey` + `stableProjectKey`. Absence pin. Isolation pin stays on `loadProjectBanditByKey`.

Frozen: reconstruction contract + FAIL-unreachable tripwire + no-contract flip-pin; criteria-are-guidance record + 270-cell sweep + sole-production-path census; absorbing BLOCKED until R8-1 replaces the tripwire; parent-plane `recordTerminal`; BLOCKED operator block (R8-1 owns the note); empty-graph pre-flight; narrowed doctor exception (`loadProjectBanditByKey`); `settleSupervisedOutcome` absence; one-definition-of-terminal; `recordCrashTerminal` caller-always-rethrows; `applyRetry` sole scheduler producer; jsonl; `writeFileAtomic`(+Sync); no new private tmp+rename; `withRunLifecycleLock`; append/checkpoint unlocked; ClusterMailReport + line; resume disclosures (supervised loopback byte-pin); five `DOCTOR_ROUTED_NEXT` routes character-exact; `--lock-wait-ms`; `process-death.ts`; R6-9 absence pins; no live R1 / Outcome-supported / ADR-006 Accepted / auto-promote / `package.json`.

Every slot: census first; scoped eslint + whole-tree `tsc --noEmit`; 3× timing-sensitive tests; report `.agent_workspace/loop4-r8-tN.md`. Census your consumers. Run `live-isolation.test.ts` if you add an import inside the live closure. No full gate. No scratch files at report time. Docs slots census the *working tree* for in-flight sibling edits.
