# Loop 4 — continuous SOTA optimization (`agent/opt-continuous`)

- **Branch:** `agent/opt-continuous`
- **Parent:** Cursor Grok 4.6 orchestrator (20+ round × 10-agent loop)
- **Base:** `main` @ `2a921ee` (PR #6 Loop 2 merged)
- **Started:** 2026-08-24
- **Quality bar:** measurable ≥5% for perf; defensive tests on every landing; no cosmetic refactors
- **Forbidden:** live R1/bandit/topology, Outcome-supported, ADR-006 Accepted, P0 sign-off, auto-promote, silent cross-family model fallback

## Protocol

Each round: fable audit → 10 concurrent landings (opus-fast + gpt-sol) → parent `pnpm gate` + benches → fable review → commit/push/PR. Subagents do **not** git commit. Saturation: if a module gains <2% for 2 consecutive rounds, move to I/O, races, protocol, or disaster recovery.

## Seed residuals (not yet on main)

Loop 3 draft (`agent/sota-opt-loop3-7e63`) claimed but has not landed: INSPECT_SUMMARY freeze; feedback append/rewrite lock; invocation lock-timeout retry; adaptation-plane import closure. Treat as open until present on this branch. Do not claim Loop 3 files if that PR lands first — rebase and retarget.

## Round 1 — in flight

Fable audit landed: `.agent_workspace/loop4-r1-fable.md` + `loop4-r1-tasks.md`. T1–T10 dispatched (6 opus-fast + 4 gpt-sol). Exclusive ownership in `OWNERSHIP.md`.

| Slot | Agent | Model |
|---|---|---|
| T1 | bc-1dd89357-b04d-5d7f-a849-37c2be55eb9f | opus-fast |
| T2 | bc-2a25b067-1389-58ae-a1e2-f9b0c8d0861f | opus-fast |
| T3 | bc-bd35c3f0-45e3-50e1-84f7-dc0f6072cedf | opus-fast |
| T4 | bc-39199fe8-0b42-51fa-a291-3dd6d602bfbc | opus-fast |
| T5 | bc-6637a686-1796-50e1-856a-3919d246be91 | opus-fast |
| T6 | bc-5a5390cc-42fe-5b80-99c2-f5d90bf5bf3d | opus-fast |
| T7 | bc-6dc4f05c-9629-5df2-96ef-7fe793150b2d | gpt-sol |
| T8 | bc-b9ea274b-2222-584d-a2c6-d2eb5a6a7432 | gpt-sol |
| T9 | bc-85399aab-2a9e-5502-b83e-cb2f61f8e765 | gpt-sol |
| T10 | bc-6d529890-48af-5198-b9c8-95366843ef2f | gpt-sol |

**Parent baseline (this VM, Node v22.14.0, engines want >=22.19.0):** `scripts/bench-runtime.mjs` → jsonlAppend 69.320ms/1000, jsonlRead 0.600ms/1000, lockSerial 195.377ms, lockContended 205.303ms. Perf landings must beat this by ≥5% or roll back. Fable re-measured jsonlAppend 68.264ms; T7 must record its own same-VM baseline before optimizing. Two host-dependent doctor test failures are T9's to hermeticize.

## Round 1 landings (parent gate GREEN after review)

**Parent verification (Node v22.14.0):** `pnpm gate` exit 0. Tests **1508 / 1507 pass / 0 fail / 1 skip**. Reviewer independently re-verified T7 (−31.5% / −28.6%) and crash-probe `ok: true`. 7 ACCEPT, 3 ACCEPT-WITH-NITS (T2/T8/T9), 0 ROLLBACK. Doctor host-Node baseline retired.

| Slot | Result |
|---|---|
| T1 | Feedback `records.jsonl.lock`; cascade fail-closed on corrupt log |
| T2 | `createInvocationSink` lock-timeout retry; flowchart `onInvocation` wired |
| T3 | Shared `writeFileAtomic` unique temps; checkpoint+pause torn-write closed |
| T4 | `validateEpisodeEvent`; settle under `episodes/<id>.lock` |
| T5 | Pre-aborted execute short-circuit; no provider call after cancel |
| T6 | Durable cancel set; `maxWallTimeMs` enforced |
| T7 | jsonlAppend −36%, fsync −34% (same-VM bench); signatures frozen |
| T8 | Seeded protocol fuzz; `assertAtMostOneTerminal` no TypeError escape |
| T9 | Doctor `nodeVersion` inject; adaptation-plane transitive value-import closure |
| T10 | SIGKILL crash probe: jsonl tail, checkpoint old-then-next, no-steal lock |

Saturated after Round 1: `persist/jsonl`, `protocol/v1` parse.

## Round 2 landings (parent gate GREEN)

**Parent verification (Node v22.14.0):** `pnpm gate` exit 0. Tests **1550 / 1548 pass / 0 fail / 2 skip**. Fable: 8 ACCEPT, 2 ACCEPT-WITH-NITS (R2-4, R2-10), 0 ROLLBACK. Lock perf independently re-verified (−14.4% / −12.0%). Crash-probe 6×3 `ok: true`.

| Slot | Result |
|---|---|
| R2-1 | Flowchart `RunAbortScope` fires abort into executors and children |
| R2-2 | Typed `LOCK_TIMEOUT`; lock serial/contended ~−12.5% |
| R2-3 | `delete --episode` acquires episode lock before unlink |
| R2-4 | `appendFeedbackWithRetry`; auto-adapt warns on lock drop, does not fail |
| R2-5 | Incremental terminal check; `maxCostUsd` disclosed unenforced |
| R2-6 | Crash probe: cascade, settle-lock, `writeFileAtomic` |
| R2-7 | Persistence-row fuzzer; invocation TypeError documented unowned |
| R2-8 | Sender-only role-cast requeues dead-lettered after bound |
| R2-9 | Dropped dead `expired()`; kept `restore()` for resume |
| R2-10 | Dictionary: unique temps, lock inventory, wall vs cost honesty |

Saturated after Round 2: lock acquisition perf, mailbox starvation semantics.

## Round 3 landings (parent gate GREEN)

**Parent verification (Node v22.14.0):** `pnpm gate` exit 0. Tests **1604 / 1603 pass / 0 fail / 1 skip** (PI_SMOKE only). Fable: 8 ACCEPT, 2 ACCEPT-WITH-NITS (R3-7, R3-10), 0 ROLLBACK. Crash-probe 8×3 `ok: true`.

| Slot | Result |
|---|---|
| R3-1 | Invocation decoders fail closed; `isInvocation` never throws |
| R3-2 | Atomic feedback/invocation rewrites; crash-probe 8×3 |
| R3-3 | `delete --run` verifies removal (`RunRecordsSurvivedError`) |
| R3-4 | Event log `DomainValidationError` + row fuzz |
| R3-5 | Escaping errors append `RUN_FAILED` |
| R3-6 | Doctor stale-lock inventory (no steal) |
| R3-7 | Host `deadLetterReport` / `onDeadLetter` (CLI embedders not yet wired) |
| R3-8 | Dropped `applySkipped` and unread `_leaseDurationMs` |
| R3-9 | Resume `createExecutor` shares invocation sink |
| R3-10 | Docs: no checkpoint leases; episode lock honesty |

## Round 4 landings (parent gate GREEN; fable 8 ACCEPT / 2 nits / 0 rollback)

**Parent verification (Node v22.14.0):** `pnpm gate` exit 0. Tests **1680 / 1679 pass / 0 fail / 1 skip** (`PI_SMOKE` only). Crash-probe 8×3 `ok: true`. Per-step run-lock on append/checkpoint rolled back (+22.5% / +17.5% e2e vs 5% bar).

| Slot | Result |
|---|---|
| R4-1 | `runtime/runs/<id>.lock`; delete verifies again after release; hot-path writers unlocked |
| R4-2 | Undelivered cluster mail on outcome + one CLI stderr line (pending + dead letters) |
| R4-3 | Supervised `RUN_FAILED` on escape; both retries through `applyRetry` |
| R4-4 | Flush resumable flowchart checkpoint on crash; in-flight-only terminal unchanged |
| R4-5 | Doctor per-lock remediation + PLANNING/RUNNING inventory (no steal) |
| R4-6 | Resume `--primary-model`/`--thinking` + rebuild disclosure; config not persisted |
| R4-7 | Atomic `tombstones.json`; malformed JSON is `DomainValidationError`; fuzz fail-closed |
| R4-8 | Docs truth-up for R3 (in-flight R4-1/2/6 timestamp-disclosed) |
| R4-9 | Atomic catalog-observed + preferences; additive `writeFileAtomicSync` |
| R4-10 | Offline pi loopback run/resume/calibration fixture |

Fable review: 8 ACCEPT, 2 ACCEPT-WITH-NITS (R4-8 stale snapshots; R4-10 empty-stderr joint). 0 ROLLBACK. Brief: `.agent_workspace/ROUND4-BRIEF.md`.

## Round 5 landings (parent gate GREEN; fable 8 ACCEPT / 2 nits / 0 rollback)

**Parent verification (Node v22.14.0):** `pnpm gate` exit 0. Tests **1725 / 1724 pass / 0 fail / 1 skip** (`PI_SMOKE` only). Crash-probe 8×3 `ok: true`. Lifecycle lock +0.148 ms/run (inside 5% bar).

| Slot | Result |
|---|---|
| R5-1 | CLI-reachable lifecycles hold `runLockPath`; delete waits; pause-on-live times out |
| R5-2 | Shared `crash-terminal.ts`; supervised crash settles episode + FAILED checkpoint |
| R5-3 | Bandit store atomic; torn read `BANDIT_STATE_UNREADABLE` |
| R5-4 | Providers/credentials/adaptation registry through `writeFileAtomic` |
| R5-5 | Resume-time adoption declined; unaccepted-result window pinned as accepted cost |
| R5-6 | Role-holder requeue count; `dead-lettered=` reachable in production-shaped runs |
| R5-7 | Docs truth-up (R5-6 reachability landed after; may be stale) |
| R5-8 | Loopback wire witness for resume model/thinking |
| R5-9 | `LOCK_TIMEOUT` / `RUN_RECORDS_SURVIVED` `next:` routes to doctor |
| R5-10 | Unused episode replay deleted; checkpoint parse typed |

Parent joints: loopback supervised resume clears abandoned lock (`a770a24`).

Fable review: 8 ACCEPT, 2 ACCEPT-WITH-NITS (R5-2 supervised lock-before-preflight; R5-7 stale snapshots). 0 ROLLBACK. Brief: `.agent_workspace/ROUND5-BRIEF.md`.

## Round 6 — landings (parent gate GREEN)

Parent verification (Node v22.14.0): `pnpm gate` exit 0. Tests **1769 / 1768 pass / 0 fail / 1 skip** (`PI_SMOKE` only). Crash-probe `ok: true`, **9 cases × 3**. Sole owners held. ADR-006 stays Proposed.

10 slots from `.agent_workspace/ROUND5-BRIEF.md`. Stay on `agent/opt-continuous`.

Parent sign-off: R6-1 option (a) — loop respects the gate (BLOCKED stays BLOCKED).

| Slot | Agent | Focus |
|---|---|---|
| R6-1 | bc-ffac634f-11f6-5b8c-903d-74689e0a7a40 | gate BLOCKED vs loop FAILED |
| R6-2 | bc-c9fcea17-8a38-5ac8-8289-81f82cf53d3d | resume rebuilds children without criteria (invest.) |
| R6-3 | bc-169e516d-6a23-5fab-913c-bdb663ffc190 | track-loop lock + supervised pre-flight |
| R6-4 | bc-90bf9ac5-8915-59c0-b337-8a948d327a84 | doctor learned/derived state inventory |
| R6-5 | bc-85d0aaa9-49e8-501b-a23b-f2e142c8a1c4 | route three codes; bounded delete wait |
| R6-6 | bc-58f2ba17-2b13-5a5c-800f-9a0f7dc571f4 | cascade wire witness + process-death helper |
| R6-7 | bc-5b3b394e-6541-531e-b2e2-36c37315bfc0 | docs truth-up |
| R6-8 | bc-e2934355-33b8-5e45-b123-7de4e94cf0ef | SIGKILL run-lock crash-probe |
| R6-9 | bc-fe0b8831-a06e-599c-8a78-1ae7b8fdc3e0 | exported-unused census |
| R6-10 | bc-5d84790a-665a-5485-870f-e9cd99df2e8e | flowchart dead-letter pin + requeue countdown |

Landed: all ten slots + parent joints. Fable **7 ACCEPT, 3 ACCEPT-WITH-NITS, 0 ROLLBACK**.

## Round 7 — landings (parent gate GREEN; fable 9 ACCEPT / 1 nit / 0 rollback)

Parent verification (Node v22.14.0): `pnpm gate` exit 0. Tests **1804 / 1803 pass / 0 fail / 1 skip** (`PI_SMOKE` only). Crash-probe `ok: true`, **9 cases × 3**. ADR-006 stays Proposed.

Fable review (`.agent_workspace/loop4-r7-review.md` at `bdc4cb9`): **9 ACCEPT, 1 ACCEPT-WITH-NITS (R7-6), 0 ROLLBACK**. Independent gate matched. Zero parent fix-joints. Brief: `.agent_workspace/ROUND7-BRIEF.md`.

| Slot | Agent | Focus |
|---|---|---|
| R7-1 | bc-fd5480c5-7ecd-5c11-925a-d9c7ddac8f99 | reconstruct child specs from the parent log |
| R7-2 | bc-4fcfcfbb-158b-5c72-a828-cdd0bf5e54d0 | criteria are prompt-guidance (option b) |
| R7-3 | bc-95c21c01-92e7-5262-a6d8-f51d862da704 | BLOCKED unblock design (no src) |
| R7-4 | bc-1d383424-003c-5403-8981-d7e8fd40c768 | parent-plane crash terminal |
| R7-5 | bc-7e2f994b-d4fb-58e1-a435-6172aff4bc0e | BLOCKED `next:` |
| R7-6 | bc-a9ad6ea7-f226-5884-9c00-fc96f67fb59b | docs truth-up |
| R7-7 | bc-57f5db89-4e89-55a4-b1a5-0e94c9cbcd0d | drop unused trackingAssessment |
| R7-8 | bc-70a8c878-c620-5046-b2ef-4f43160c1de4 | keyed doctor readers |
| R7-9 | bc-fb413605-1f00-5c45-8d8b-0cd905834e00 | reject empty task graphs |
| R7-10 | bc-ba95ad7e-7665-5ecd-963d-98f38dc68121 | real-command bandit/catalog routes |

Landed: R7-10 STOP (catalog has no CLI producer); R7-6 Round 6 docs truth-up (ADR-006 stays Proposed; nit: in-flight disclosure undercounted siblings); R7-7 deleted unused `settleSupervisedOutcome`; R7-9 empty graphs fail in pre-flight; R7-3 absorbing-BLOCKED pins + Round 8 `RUN_UNBLOCKED` design (no schema); R7-8 keyed `loadProjectBanditByKey` + pure preference reader; R7-2 option (b) recorded in-source (criteria are prompt-guidance); R7-5 BLOCKED `next:` on `run`; R7-1 reconstruct child specs from the parent log; R7-4 parent-plane crash refuses over a replayed terminal.

## Round 8 — landings (parent gate GREEN; fable 9 ACCEPT / 1 nit / 0 rollback)

Parent verification (Node v22.14.0): `pnpm gate` exit 0. Tests **1845 / 1844 pass / 0 fail / 1 skip** (`PI_SMOKE` only). Crash-probe `ok: true`, **9 cases × 3**. ADR-006 stays Proposed.

Fable review (`.agent_workspace/loop4-r8-review.md` at `b65ad06`): **9 ACCEPT, 1 ACCEPT-WITH-NITS (R8-2), 0 ROLLBACK**. Independent gate matched. Zero parent fix-joints. Brief: `.agent_workspace/ROUND8-BRIEF.md`.

10 slots from `.agent_workspace/ROUND7-BRIEF.md`. Stay on `agent/opt-continuous`. Parent sign-off: R8-1 **YES** `RUN_UNBLOCKED` schema; R8-2 no schema this half; R8-4 design-only; R8-6 option (b); R8-7 do not amend crash-terminal rethrow; R8-9 delete `loadProjectBandit`. Brief R8-3 folded into R8-1 (same `main.ts`). Durable contract implementation deferred until after R8-1 (file contention on `replay.ts` / `flowchart-run.ts`). ADR-006 stays Proposed.

| Slot | Agent | Focus |
|---|---|---|
| R8-1 | bc-04e9b0fd-7eac-5257-99ec-80f014de2983 | ship `RUN_UNBLOCKED` + folded resume/answer BLOCKED `next:` |
| R8-2 | bc-e54c339d-20d2-599e-89ca-e9e129dcecad | durable-contract design + absence pins (no src) |
| R8-3 | bc-6f365607-85cc-5b6f-94bc-ccb7a9424536 | flowchart `applyRetry` absence pin (no src) |
| R8-4 | bc-4f1f0ff5-4040-5760-a667-45e9554bfa73 | option (a) design-only |
| R8-5 | bc-d3903dd3-62a2-5c09-9715-4288654bb589 | Round 7 docs truth-up |
| R8-6 | bc-0909b159-52b0-5839-ab9e-dc4aef25892e | catalog route posture (b) + bandit producer pin |
| R8-7 | bc-5ac3620f-d1e6-552f-8d6f-2511b8b8c97a | parent-plane crash residuals (no crash-terminal edit) |
| R8-8 | bc-faed627a-27aa-592a-abaf-747f13f608fc | freeze `INSPECT_SUMMARY` additive |
| R8-9 | bc-fa848108-24c4-5b92-8430-a0dc6683f100 | delete unused `loadProjectBandit` |
| R8-10 | bc-6d55b575-e843-5581-bac0-6370415d16ac | re-seed bound-episode pre-rounds settle |

Landed: R8-1 `RUN_UNBLOCKED` + locked `unblock` + honesty repair on BLOCKED `next:`; R8-2 contract-absence pins (schema deferred; nit: resumeCommand region regex swallows unblockCommand); R8-3 flowchart `applyRetry` absence pin; R8-4 option-(a) design (no live verdict producer — four preconditions); R8-5 Round 7 docs (ADR-006 Proposed); R8-6 catalog posture (b) + bandit `adapt auto` pin; R8-7 WAITING_FOR_USER crash / cancel-request decisions; R8-8 `INSPECT_SUMMARY` frozen-additive; R8-9 deleted `loadProjectBandit`; R8-10 bound-episode pre-rounds settle reseed.

## Round 9 — landings (parent gate GREEN; fable 9 ACCEPT / 1 nit / 0 rollback)

Parent verification (Node v22.14.0): `pnpm gate` exit 0. Tests **1880 / 1879 pass / 0 fail / 1 skip** (`PI_SMOKE` only). Crash-probe `ok: true`, **10 cases × 3** (R9-5 added `unblock-append-before-checkpoint-sigkill`). ADR-006 stays Proposed. Zero parent fix-joints.

Fable review (`.agent_workspace/loop4-r9-review.md` at `8e933a7`): **9 ACCEPT, 1 ACCEPT-WITH-NITS (R9-4), 0 ROLLBACK**. Independent gate matched. Zero parent fix-joints. Brief: `.agent_workspace/ROUND9-BRIEF.md`.

10 slots from `.agent_workspace/ROUND8-BRIEF.md`. Stay on `agent/opt-continuous`. Parent sign-off: R9-1 **YES** durable `contract` on the flowchart checkpoint; R9-2 **YES** `report_task_result` tool (no protocol schema); R9-3 design-only; R9-6 in-source gate-reconstruction posture (no new consumer). R9-3 did not co-schedule src with R9-1.

| Slot | Agent | Focus |
|---|---|---|
| R9-1 | bc-d41cfdf0-7c32-5e6d-af12-8f2cefdb8a40 | durable run contract on resume |
| R9-2 | bc-764849e3-e92b-50d3-8bfd-d54192981ec5 | Pi executor verdict producer |
| R9-3 | bc-9e1dfd8f-5dc6-59f5-b393-21e2519eba9b | executed-descendant discard design |
| R9-4 | bc-5fe54953-33ef-5e3e-9f08-a66f55080c5d | Round 8 docs truth-up |
| R9-5 | bc-bdc88c7c-e40c-5daf-b259-94f27c9a13ed | unblock crash-probe case |
| R9-6 | bc-072db4be-339b-56d0-8b92-78cae7897a76 | gate-reconstruction posture |
| R9-7 | bc-64d2a703-3819-5377-a20c-f04dffa452f9 | freeze five `DOCTOR_ROUTED_NEXT` routes |
| R9-8 | bc-b4529b1e-ded7-5625-ac6b-b812409bcffc | freeze `childTasksFromLog` reconstruction |
| R9-9 | bc-f5f50053-06b0-52d5-9751-64ec03b655c6 | freeze isolation after `loadProjectBandit` delete |
| R9-10 | bc-ca262099-fbf9-5870-839e-a213db8117f4 | freeze `RUN_UNBLOCKED` payload keys |

Landed: R9-1 `aeb14dc` durable `contract?` on `FlowchartCheckpointState` (CLI flip-pin; unblock carries contract); R9-2 `dff71f1` `sparkle_report_task_result` + pin 2 re-derived (PASSED opens / FAILED hard-blocks for `--executor pi`); R9-3 `97e475e` fail-closed pin + design `RUN_UNBLOCKED_WITH_DISCARD` (no payload field); R9-4 `af9f993` Round 8 docs (ADR-006 Proposed; ADR `0005` body still names deleted `loadProjectBandit` — flag-only; nit: nine-case probe line); R9-5 `25a57d9` 10th probe case; R9-6 `4d21a96` `runStatus` is a ledger not a control input (zero `src` readers); R9-7 `73363a2` character-exact `DOCTOR_ROUTED_NEXT` freeze; R9-8 `1b5ed59` `childTasksFromLog` resume call-site + FAIL-unreachable tripwire; R9-9 `8f45505` `loadProjectBandit` gone / `selectArm` shadow-only; R9-10 `5970a2f` `RUN_UNBLOCKED` payload three keys type-frozen.

## Round 10 — landings (parent gate GREEN; fable 10 ACCEPT / 0 nits / 0 rollback)

Parent verification (Node v22.14.0): `pnpm gate` exit 0. Tests **1915 / 1914 pass / 0 fail / 1 skip** (`PI_SMOKE` only). Crash-probe `ok: true`, **10 cases × 3** (discard-window probe deferred). ADR-006 stays Proposed. Zero parent fix-joints.

Fable review (`.agent_workspace/loop4-r10-review.md` at `6c60ba6`): **10 ACCEPT, 0 ACCEPT-WITH-NITS, 0 ROLLBACK**. Independent gate matched. Zero parent fix-joints. Brief: `.agent_workspace/ROUND10-BRIEF.md`.

10 slots from `.agent_workspace/ROUND9-BRIEF.md`. Stay on `agent/opt-continuous`. Parent sign-off: R10-1 **YES** `RUN_UNBLOCKED_WITH_DISCARD`; R10-2 option (a) **deferred**; R10-5 comment-only `independentEvidence` posture; R10-6 probe **deferred**.

| Slot | Agent | Focus |
|---|---|---|
| R10-1 | bc-8d7c884e-6da9-545d-871b-605a7f741b50 | ship `RUN_UNBLOCKED_WITH_DISCARD` |
| R10-2 | bc-64c0af54-0446-5ec0-a3ea-b4171207450f | freeze option-(a) unimplemented |
| R10-3 | bc-bdae1351-6b79-56c4-8400-04696de7ffd2 | Round 9 docs truth-up |
| R10-4 | bc-1f578743-69b2-59bb-a5e7-90b537a57860 | CLI `--track` contract retention + writer census |
| R10-5 | bc-98bf40a8-1a82-5b06-b361-192f22bb7378 | `independentEvidence` + `applyChildThreeLine` posture |
| R10-6 | bc-2cb4c60a-9d36-5365-9d14-e5f5dff2c916 | freeze verdict-producer rules (probe deferred) |
| R10-7 | bc-f0ce5a46-674b-5598-b95a-485c83f8056c | freeze never-synthesize-from-episode |
| R10-8 | bc-c2395186-968e-5e87-be28-66f89f4d0b55 | keep `applyRetry` AST pin over discard path |
| R10-9 | bc-33009d74-85e5-5914-8616-76c9d244c74c | keep `runStatus` ledger no-reader pin |
| R10-10 | bc-179325e9-b579-5eaa-9d28-17af209d4a6f | freeze `TERMINAL_REPLAY_STATUSES` (new event is not a status) |

Landed: R10-1 `54cf5e5` `RUN_UNBLOCKED_WITH_DISCARD` + `unblock --discard-executed` (charged estimates fail-closed vs `MODEL_ROUTED`; fourth checkpoint writer carries `contract`); R10-2 `a57fd7d` option (a) unimplemented freeze; R10-3 `66edccb` Round 9 docs; R10-4 `2e22453` writer-census pin (pure-CLI `--track`→pause STOP: tracked run has no pause controller); R10-5 `9b9888a` `independentEvidence` self-report posture; R10-6 `05d146c` verdict-producer standing rules; R10-7 `366df19` never-synthesize-from-episode; R10-8 `2399346` `applyRetry` absence over discard identifiers; R10-9 `d4b52b1` matched discard ledger status; R10-10 `d4741e6` `TERMINAL_REPLAY_STATUSES` / `RUN_UNBLOCKED*` not a status.

## Round 11 — CLOSED

10 slots from `.agent_workspace/ROUND10-BRIEF.md`. Stay on `agent/opt-continuous`. Parent sign-off: R11-1 **YES** option (a); R11-3 **YES** tracked pause controller (no race; fold declined); R11-4 **YES** restore-path charge validation.

| Slot | Agent | Focus |
|---|---|---|
| R11-1 | bc-bac929b5-19fa-5a19-b5cf-fc7af45eed6e | implement option (a) |
| R11-2 | bc-3be62857-82a1-5523-9ef1-cae7b3339bb7 | discard crash-probe eleventh case |
| R11-3 | bc-52d9f74c-f0f1-593a-9372-24ee72f4f2fc | tracked-run pause controller |
| R11-4 | bc-e3adef72-a50c-5c80-b871-70aee430ac51 | restore-path discard audit validation |
| R11-5 | bc-7096a9fa-0d14-5551-98e7-a5af5ce05f22 | Round 10 docs truth-up |
| R11-6 | bc-8b43b955-c413-54c7-b9f1-094ec7a911de | keep live-isolation pins |
| R11-7 | bc-37fcffbf-7f45-5103-8de6-3a5d15860354 | keep INSPECT_SUMMARY + BLOCKED prefix |
| R11-8 | bc-6b194f70-5131-591a-bc46-c2bc3793cb50 | keep `applyRetry` AST pin |
| R11-9 | bc-9b740fbd-b914-5ee5-8aed-9ce8e9c09f14 | keep `TERMINAL_REPLAY_STATUSES` freeze |
| R11-10 | bc-63703673-58ec-55f2-b9ad-9595d7b2e887 | keep never-synthesize-from-episode |

Landed: R11-1 `6096da6` option (a) per-criterion gating; R11-2 `db38b21` 11th crash-probe case; R11-3 `ac3faa3` tracked-run pause controller; R11-4 `9663294` restore-path discard charge audit; R11-5 `9efc715` Round 10 docs; R11-6 report-only (existing live-isolation pins covered R11-1's import); R11-7 `3bbb8dc` INSPECT_SUMMARY / BLOCKED prefix freeze; R11-8 `39c97c3` restore-audit under `applyRetry` absence pin; R11-9 `330466a` option (a) cannot add a fourth `RunStatus`; R11-10 `f99a0c8` never-synthesize covers `taskCriteria`. Parent joint `6926592` spent R9-1 reserved pin in `resume.test.ts`; parent docs `df2c395` truth-up coverage-gate row.

**Parent gate GREEN** at `2767321`: **1938 tests / 1937 pass / 0 fail / 1 skipped** (`PI_SMOKE` only). Crash-probe **11 cases × 3**, `ok: true`. Fable SOTA review: **10 ACCEPT, 0 nits, 0 ROLLBACK** at `.agent_workspace/loop4-r11-review.md`. Two parent joints (`6926592`, `df2c395`) and one 20-second red-tree window at `6096da6`, counted. Residual closed into Round 12: `taskCriteria` writer + early run-id (same slot — `flowchart-run.ts` contention).

## Round 12 — in flight

10 slots from `.agent_workspace/ROUND11-BRIEF.md` (four real candidates; R12-1 absorbs brief R12-1+R12-2 because they share `flowchart-run.ts`). Stay on `agent/opt-continuous`. Parent sign-off: R12-1 **YES** `taskCriteria` writer+reader (semantic approved); R12-1 **YES** early run-id disclosure in the same diff (stop-and-report that half if disproportionate).

| Slot | Agent | Focus |
|---|---|---|
| R12-1 | bc-212fd2df-0600-53f2-bd66-5121bdc1bf2d | `taskCriteria` writer+reader + early run-id |
| R12-2 | bc-75d55f82-927e-5aea-8272-e6c69eee2bc4 | keep `independentEvidence` one-void pin |
| R12-3 | bc-bc71ea8f-6c61-554a-9d34-1540610648f3 | criteria-gate production-reachability |
| R12-4 | bc-5a2f7f6b-48ee-5c7f-898b-b68a823994e0 | Round 11 docs truth-up |
| R12-5 | bc-f245e65f-6620-5996-a508-b328dd155738 | keep `applyRetry` absence + restore audit |
| R12-6 | bc-14b01583-7004-55a5-b392-cece0307e44c | keep never-synthesize-from-episode |
| R12-7 | bc-47ac0ed7-a754-5634-9e52-1e93958bcd56 | keep routes / INSPECT_SUMMARY / BLOCKED prefix |
| R12-8 | bc-d5d9b6aa-16af-5c77-9448-99f89b0f40a8 | keep live-isolation pins |
| R12-9 | bc-b03d3f9a-d0aa-5194-85c0-15cfef2a6d07 | keep `TERMINAL_REPLAY_STATUSES` freeze |
| R12-10 | bc-0551ba4d-479f-5f00-9bb5-6d9e2e29a23b | keep writer-carriage `contract` property |

Landed: R12-2 `95a2b25` `flowchart-run` cannot read `independentEvidence`; R12-6 report-only episode never-synthesize already covers `taskCriteria`; R12-7 report-only routes / inspect / BLOCKED prefix; R12-9 `b65a8b1` exact `RunStatus` vocabulary.

---

# Loop 2 — SOTA follow-on (2026-08-24)

- **Branch:** `agent/sota-opt-next-7e63`
- **Parent:** Cursor Grok 4.6 orchestrator
- **Base:** `main` @ `b371e12` (PR #3 merged)
- **Previous loop:** archived below; reports in `docs/reports/2026-08-24-sota-r3-*.md`

## Remaining gaps this loop will close (from R3 P1/P2)

1. `inspect --json` does not surface aggregated `requiredEvidence` from `STALL_DETECTED` / `RUN_BLOCKED` (only raw events).
2. Invocation append (`src/cli/main.ts` `appendFile` to `invocations.jsonl`) is unlocked vs delete rewrite lock — delete-vs-live-appender race.
3. Plane-boundary allowlist comment claims type-only `eval-routing → model-router` loads nothing supervisor-side; value chain via `routing/assign.ts` does.
4. Plain `--children` starts `skipContract: true` — document honestly (do not silently invent a contract).
5. Tests/probes for the above; no Outcome-supported; no live R1.

## Loop 2 Round 1 ownership

| Slot | Owns |
|---|---|
| fable-1 | `.agent_workspace/loop2-r1-fable1.md`, `docs/reports/2026-08-24-sota-loop2-architecture.md`, `README.md` skipContract/inspect honesty, `docs/status-matrix.md` |
| fable-2 | `.agent_workspace/loop2-r1-fable2.md`, `docs/reports/2026-08-24-sota-loop2-isolation.md`, `docs/data-dictionary.md` |
| opus-1 | `src/run/inspection.ts`, `test/unit/run/inspection.test.ts`, `src/cli/main.ts` **only** `inspectCommand` (additive `requiredEvidence` on inspect; do not change event NDJSON into a breaking single object — last-line `INSPECT_SUMMARY` or `--json` summary object documented in tests) |
| opus-2 | NEW `src/telemetry/invocation-log.ts` (locked append+path helper), `src/privacy/deletion.ts` (use the helper’s lock), `src/cli/main.ts` **only** the `onInvocation` append (replace unlocked `appendFile`), tests under `test/unit/telemetry/` and deletion tests |
| gpt-sol-1 | `test/unit/privacy/plane-boundary.test.ts` (fix overbroad comment; add transitive value-import assertion for eval-routing→assign→model-router; no FS leak still allowed) |
| gpt-sol-2 | NEW tests: skipContract honesty (`test/unit/run/` or CLI children), inspect summary if landed; `.agent_workspace/loop2-r1-gptsol2.md`; `scripts/` probe for locked invocation append if helper exists |

**Forbidden:** live R1/bandit/topology, Outcome-supported, ADR-006 Accepted, P0 sign-off, auto-promote, `package.json` deps bump.

Subagents do not git commit. Parent commits after each round.

## Loop 2 Round 1 结论简报

**Parent verification (2026-08-24, Node v22.22.2):** `pnpm typecheck` / `lint` / `test` / `build` green. Tests **1434 pass / 0 fail / 1 skip** (loop 1 close on main: 1408). Security probe **14/14**.

| Slot | Landed |
|---|---|
| fable-1 | Loop2 architecture report; README skipContract + inspect `--summary-json`; matrix rows |
| fable-2 | Isolation report; dictionary lock/boundary honesty |
| opus-1 | `RunInspection.requiredEvidence`; prose inspect; `--summary-json` (`INSPECT_SUMMARY`); `--json` event stream unchanged |
| opus-2 | `src/telemetry/invocation-log.ts` locked append; delete rewrite shares lock; CLI onInvocation uses it |
| gpt-sol-1 | Plane-boundary comment + transitive eval-routing→assign→model-router + no-fs pin |
| gpt-sol-2 | `--children` skipContract vs `--track` contract honesty test |

This user request asked for **one** optimization round (6 concurrent agents). Loop 2 Round 1 closes the four carried P1/P2 items that are code-closable. Policy gates (P0, F-PROD, ADR-006, Outcome-supported) stay open.

_Pending._


---

# Loop 1 archive — pi-sparkle SOTA persistent optimization — orchestrator log

- **Branch:** `agent/sota-persistent-opt-7e63`
- **SOP alias:** `agent/sota-persistent-opt`
- **Started:** 2026-08-24
- **Parent:** Cursor Grok 4.6 orchestrator (3-round × 6-agent loop)
- **Goal:** Polish every plane of pi-sparkle to SOTA quality without claiming Outcome-supported, F-PROD, or live R1/bandit/topology. Never auto-promote. Keep ADR-004/005/006 honesty.


## Loop protocol

Each round dispatches **6 concurrent subagents** with exclusive file ownership:

| Slot | Model slug | Role |
|---|---|---|
| fable-1 | `claude-fable-5-thinking-xhigh` | Global architecture / SOTA audit |
| fable-2 | `claude-fable-5-thinking-xhigh` | Isolation, privacy-claim, ADR honesty review |
| opus-1 | `claude-opus-5-thinking-high-fast` | Core implementation A |
| opus-2 | `claude-opus-5-thinking-high-fast` | Core implementation B |
| gpt-sol-1 | `gpt-5.6-sol-xhigh-fast` | Benchmarks / persist stress |
| gpt-sol-2 | `gpt-5.6-sol-xhigh-fast` | Boundary probes / package hygiene |

Subagents **do not git commit**. Parent commits, pushes, and updates the PR after each round.

## Known baseline (main @ `4a59949`)

Evidence from `docs/reports/2026-08-22-weak-areas-data-collection.md` and `docs/status-matrix.md`:

1. `redactPII` labels only — email/IP/phone/card/path/secret *values* survive (`src/feedback/redaction.ts`).
2. No 429 Retry-After / backoff at the Pi executor (`src/pi-adapter/`).
3. Error invocations can record `tokensIn: 0` despite “unavailable is undefined, never zero”.
4. Doctor output is prose-only — no frozen `--json` contract.
5. Legacy flat state-root paths are invisible (fail-closed) with no migrate command or doctor warning.
6. Published build inherits `sourceMap`/`declarationMap` from root tsconfig (pack bloat).
7. Retention unbounded; doctor Node engine is `>=22.19.0` while some environments run 22.14.0.
8. Real-provider coverage of `--children` / `--track` still thin. Checkpoint F-PROD stays open.

## Round 1 — initial build & baseline (in flight)

Exclusive ownership (do not touch another slot’s files):

| Slot | Owns |
|---|---|
| fable-1 | `.agent_workspace/round1-fable1.md`, `docs/reports/2026-08-24-sota-architecture-audit.md`; may honesty-patch `docs/status-matrix.md`, `CONTRIBUTING.md` |
| fable-2 | `.agent_workspace/round1-fable2.md`, `docs/reports/2026-08-24-sota-isolation-privacy.md`; may honesty-patch `docs/data-dictionary.md`, `docs/decisions/*.md` |
| opus-1 | `src/feedback/redaction.ts`, `test/unit/feedback/**`, `test/unit/privacy/redaction.test.ts`, `test/integration/m3/redaction.test.ts`, `src/cli/doctor.ts`, `src/cli/doctor-overlay.ts`, `test/unit/cli/doctor*.ts` |
| opus-2 | `src/pi-adapter/**`, `test/unit/pi-adapter/**`, `test/integration/pi-adapter/**`, `src/telemetry/**`, `test/unit/telemetry/**`, new `src/cli/migrate-legacy.ts` + its tests; **minimal** `src/cli/main.ts` switch/USAGE for `migrate-legacy` only |
| gpt-sol-1 | `scripts/bench-runtime.mjs`, `test/unit/persist/**`, `src/persist/**` (bugfix only), `.agent_workspace/round1-gptsol1.md` |
| gpt-sol-2 | `tsconfig.build.json` (strip maps), `scripts/security-probe.mjs`, `test/unit/domain/**` extra edges, `test/unit/graph/**` extra edges, `.agent_workspace/round1-gptsol2.md` |

**Forbidden to all Round 1 agents:** `README.md`, `package.json`, `pnpm-lock.yaml`, `.github/**`, live R1/bandit/topology on the execution path, Outcome-supported claims.

## Round 1 结论简报

**Parent verification (2026-08-24, Node v22.22.2):** `pnpm typecheck` / `lint` / `test` / `build` green. Tests **1282 pass / 0 fail / 1 skip**. `dist/` map files **0**. `security-probe` **14 passed, 0 open**. Bench `scripts/bench-runtime.mjs` ok (jsonlAppend ~85ms/1000, lock contended ~245ms).

### 已实现功能

| Slot | Model | Landed |
|---|---|---|
| fable-1 | `claude-fable-5-thinking-xhigh` | Architecture audit; `--children` is flowchart (matrix honesty); coverage-gate wiring precision; isolation-enforcement precision; CONTRIBUTING `preferences/` + `pnpm gate` |
| fable-2 | `claude-fable-5-thinking-xhigh` | Isolation/privacy audit; ADR-004 follow-up contradiction fixed; ADR-005 enforcement note; dictionary delete-cascade holes disclosed |
| opus-1 | `claude-opus-5-thinking-high-fast` | Real PII/secret/path redaction + ReDoS hardening; `doctor --json` frozen contract; informational `legacy-layout` check |
| opus-2 | `claude-opus-5-thinking-high-fast` | 429/5xx retry with Retry-After/`remedy_hint`; usage `undefined` on failed calls; `costEligibleInvocations`; `migrate-legacy` dry-run/`--apply` |
| gpt-sol-1 | `gpt-5.6-sol-xhigh-fast` | JSONL+lock benches; lock fd leak on metadata write; exclusive-lock tests; stale locks remain timeout-only (PID-reuse conservative) |
| gpt-sol-2 | `gpt-5.6-sol-xhigh-fast` | Build maps stripped; security-probe expanded (Bearer/PEM/UNC); domain/graph edge tests |

Parent post-collect honesty: USAGE lists `doctor --json`; status-matrix doctor row records the frozen JSON contract; fake-executor row mentions `migrate-legacy`.

### 遗留缺陷

1. `live-isolation.test.ts` is source-text over ten files — cannot see transitive `bandit.ts` (post-run write) or `topology.ts` (parked import).
2. Episode-delete cascade strips `body` not `summary`; `delete --run` does not rewrite global `invocations.jsonl`; episode `.lock` survives.
3. `calibrateCatalogFromState` still averages failed calls into per-token cost (helper exists, not wired).
4. README / `m0-m2-architecture.md` still say `--children` is not the flowchart engine; seven CLI commands missing from README table.
5. `pnpm test -- <dir>` throws `ERR_UNSUPPORTED_DIR_IMPORT` (tsx + package script).
6. Orphan barrel `src/supervisor/flowchart.ts` (zero importers).
7. `redacted: true` means “pass ran”, not “content removed”; decision classes not persisted.
8. Prompt-injection class still unused (deliberate; false-positive risk).
9. Node engines `>=22.19.0` vs some hosts on 22.14.0 (doctor fails closed — correct).

### 性能瓶颈

- JSONL append ~0.08ms/line locally; lock serial ~0.25ms/acquire. Not a CI gate.
- Redaction ReDoS closed (~5ms at 32K vs seconds before). Size cap still after scan-of-redacted text (good).
- Retry sleeps up to 8s backoff, refuses Retry-After > 30s (by design).
- No stale-lock steal (PID reuse). Abandoned lock = timeout + manual cleanup.

### 下轮攻坚重点 (Round 2)

1. Transitive live-isolation test + plane-boundary prefix gap (`supervisor/`, `cli/`).
2. Privacy cascade: strip `summary`, filter-rewrite invocations on `delete --run`, drop episode lock; align `record-classes`.
3. Wire `costEligibleInvocations` into cost-calibration.
4. README + architecture spec honesty; `adapt promote` USAGE form; doctor/migrate in command table.
5. Test-runner directory glob; `bandit-store` units; evidence-invariant + checkpoint crash tests.
6. Delete or justify orphan `flowchart.ts` barrel; fix `r0.ts` “not imported live” header.

## Round 2 结论简报

**Parent verification (2026-08-24, Node v22.22.2):** `pnpm typecheck` / `lint` / `test` / `build` green. Tests **1314 pass / 0 fail / 1 skip** (was 1282). Directory form `pnpm test -- test/unit/persist` works (13/13). Security probe **14/14**.

### 演进对比 (Round 1 → Round 2)

| Area | Round 1 | Round 2 |
|---|---|---|
| Isolation test | 10-file source grep | Transitive closure from 4 live entries; pinned allowlist (bandit writer, parked topology) |
| Plane-boundary | Missing supervisor/cli prefixes | Prefixes added; type-only `eval-routing` allowlisted |
| Delete cascade | body-only; invocations leak; episode lock survives | Strips body+summary; filter-rewrites invocations.jsonl; invalidates catalog-observed; removes .lock |
| Cost calibration | Helper unwired | `isCostEligible` gated; unattributed/not-ok excluded |
| Docs | Matrix honesty | README `--children` truth; 22-row command table; doctor --json / migrate-legacy |
| Tests | persist lock + redaction | bandit-store units; evidence-invariant; checkpoint crash windows |
| Runner | `tsx --test` dir-import bug | `scripts/run-tests.mjs` expands directories |
| USAGE | `adapt promote` bare | Parent: full required flags |

`src/supervisor/flowchart.ts` is **not** an orphan — `flowchart-supervisor.ts` imports `./flowchart.js`. Do not delete.

### 潜在边界风险

1. Episode objective text can still survive in attached runs' `events.jsonl` (`EPISODE_OPENED` copy) after `delete --episode`.
2. No preference cascade on episode delete.
3. `redacted: true` still means “pass ran”; decision classes not persisted on `FeedbackRecord`.
4. `SPARKLE_AUTO_ADAPT=0` still writes `bandit.json` before the kill-switch return (collects *and* updates the learner).
5. Closure walker is regex-based (fails closed on comment false-positives; misses computed dynamic imports — none in src/).
6. Delete-vs-live-appender race on shared `invocations.jsonl` (documented).
7. Unbounded retention of invocations/episodes.

### SOTA 验收差距 (Round 3)

1. Persist optional `redactionClasses` (or split scanned/transformed) so on-disk records are honest.
2. Kill-switch: skip `updateProjectBandit` when `SPARKLE_AUTO_ADAPT=0` (collect-only).
3. Episode-delete: scrub or disclose remaining run-log copies; preference cascade or explicit non-goal.
4. README `adapt promote` row + delete-cascade “summary too”; CONTRIBUTING test-runner.
5. `auth-session` / `cluster-tools` direct units; retention probe.
6. Final cross-audit: no Outcome-supported, no live R1, ADR-006 Proposed, P0 sign-off open.

## Round 3 结论简报

**Parent verification (2026-08-24, Node v22.22.2):** `pnpm typecheck` / `lint` / `test` / `build` green. Tests **1363 pass / 0 fail / 1 skip** (R2: 1314). Security probe **14/14**. Retention probe `{ ok: true, unbounded: true, files: 33, bytes: 25856 }`. Directory tests 13/13.

### 最终冲刺落地

| Slot | Model | Landed |
|---|---|---|
| fable-1 | `claude-fable-5-thinking-xhigh` | SOTA acceptance report; README `adapt promote` + delete honesty; CONTRIBUTING test runner; matrix rows for cascade/calibration/retention |
| fable-2 | `claude-fable-5-thinking-xhigh` | Isolation certification; dictionary residual-text + kill-switch + redactionClasses tri-state; ADR-006 stays Proposed |
| opus-1 | `claude-opus-5-thinking-high-fast` | Persist `redactionClasses` (fail-closed unknown; old rows valid); auth-session units + lazy readline hardening |
| opus-2 | `claude-opus-5-thinking-high-fast` | Kill-switch collect-only (no bandit write); episode-delete residual run listing (no event-log rewrite); preference cascade explicit non-goal |
| gpt-sol-1 | `gpt-5.6-sol-xhigh-fast` | cluster-tools units; `scripts/retention-probe.mjs` |
| gpt-sol-2 | `gpt-5.6-sol-xhigh-fast` | Help/USAGE promote flags assertion; evidence-invariant comment |

Parent ratifies the one-line `src/cli/main.ts` residual-text print (required by `DeletionResult`). Round 2 residual items 1–4 and 3.1–3.5 above are closed or explicitly disclosed.

### SOTA 收敛（developer preview 标准）

Accepted for preview: fail-closed persistence, transitive live-isolation, documentation-exact privacy deletes, honest telemetry/calibration, proposal-first adaptation, dispatcher-matching docs. **Not** Outcome-supported. **Not** F-PROD. Live R1/bandit/topology stay off the execution path.

### 仍为策略/人工门（不在本 loop 关闭）

- P0 privacy independent-reviewer sign-off
- Checkpoint F-PROD / sealed holdout
- ADR-006 Proposed (no Pi extension import)
- Unbounded retention (Q3 accepted; probe only)
- Plane-boundary comment vs value-import of model-router through eval-routing (no FS leak)
- Real-provider `--children`/`--track` coverage still smoke-only

## Post-loop merge with `origin/main` (2026-08-24)

`main` moved from `4a59949` to `2155743` (Pi 0.84.3 pin, `pi-compat` CLI, `run --thinking`, doctor `pi-packages`/`pi-compat` checks). This branch absorbed that work with conflict resolution:

- Keep directory-expanding `scripts/run-tests.mjs` **and** `pi-compat` / `pi:latest` / `pi:probe` scripts
- Doctor JSON contract + `legacy-layout` **and** `pi-packages` / `pi-compat` checks
- `--thinking` on `run` **and** `migrate-legacy` / residual-delete disclosure
- Adapter exports both `SparkleThinkingLevel` and retry types
