[Model: claude-fable-5-thinking-xhigh]

# Loop 4 · Round 8 — SOTA review at `b65ad06`

Reviewer ran independently on this VM (Node v22.14.0), on `agent/opt-continuous`, working tree clean at HEAD `b65ad06`. Every verdict below is against the actual diff `0c57fa2..c8d7d15` (the ten exclusive landings) plus the three parent commits after it, which touch only `.agent_workspace/PROGRESS.md` — verified per-commit, not taken from slot reports. No file outside `.agent_workspace/` was changed by this review; scratch outputs lived in `/tmp` (`/tmp/r8-gate.log`, `/tmp/r8-crash-probe.log`, `/tmp/routes-{base,head}.txt`).

## 1. Scoreboard

| Slot | Verdict | One-line basis |
|---|---|---|
| R8-1 | **ACCEPT** | `RUN_UNBLOCKED` shipped exactly as R7-3 designed and the parent signed off — every property in §4.1 verified in the diff; the only findings are two report-text nits (§6) that touch no code |
| R8-2 | **ACCEPT-WITH-NITS** | No `src/**`, flip-pin byte-untouched, design complete and correct; nit: the CLI-continuation pin's region regex now silently swallows R8-1's `unblockCommand` (§6) |
| R8-3 | **ACCEPT** | AST-level absence pin over both flowchart sources, with in-test mutation checks; scheduler sole-producer pin byte-identical |
| R8-4 | **ACCEPT** | Design-only as signed off; all census claims — including the fourth precondition — re-verified in source by this review (§4.3) |
| R8-5 | **ACCEPT** | Docs-only plus the one authorized comment-only `supervisor.ts` edit; no ADR touched, ADR-006 Proposed; census honestly timestamped — staleness at HEAD flagged in §4.4, not held against the slot |
| R8-6 | **ACCEPT** | Option (b) recorded in-source at `catalog-observed.ts`; five routes character-exact vs baseline (diffed, not eyeballed); real `adapt auto` producer test; no fake catalog producer; `main.ts` untouched by this slot |
| R8-7 | **ACCEPT** | `crash-terminal.ts` diff-empty; both decisions recorded in source with behaviour pins; `failureReason` cleanup is byte-neutral on the recorded payload |
| R8-8 | **ACCEPT** | Freeze declared and enforced: exact-key pins on both branches, non-Event pin against `EVENT_TYPES` + `validateEvent`, `--json` purity untouched, no `src/**` edit |
| R8-9 | **ACCEPT** | `loadProjectBandit` gone from `src/**`; namespace absence pin landed; isolation pin and its widened sweep unchanged; `learnedState` untouched |
| R8-10 | **ACCEPT** | Additive-only reseed lands exactly the requested shape: successful bind, failed `TASK_GRAPH_ACCEPTED` append, one guarded `RUN_FAILED`, `afterTerminal === ["EPISODE_CLOSED"]` |

9 ACCEPT, 1 ACCEPT-WITH-NITS, 0 ROLLBACK. Zero parent fix-joints; nothing left red at HEAD.

## 2. Independent verification (this VM)

- **`pnpm gate` GREEN, exit 0: 1845 tests / 1844 pass / 0 fail / 1 skipped** — matches the parent's recorded numbers exactly. The one skip is the `PI_SMOKE` real-provider gate (`PiAgentExecutor completes a run against a real provider # SKIP`); no new named skip (target 10 satisfied).
- **`node scripts/crash-probe.mjs` → `ok: true`, 9 cases × 3 iterations**, case set unchanged from Round 7 — matches.
- **The +41 over Round 7's 1804/1803/1 closes per-slot.** Static test-registration deltas per changed test file, baseline vs HEAD: R8-1 +23 (blocked-next +3, replay +5, event-row-fuzz +1, `unblock.test.ts` +6, `unblock-flow.test.ts` +8) · R8-2 +3 · R8-3 +2 · R8-4 +5 · R8-5 0 · R8-6 +1 (net: one test rewritten onto the real producer, one added) · R8-7 +4 · R8-8 +1 · R8-9 +1 (absence pin; migrations net zero) · R8-10 +1. Sum: exactly 41.
- **Commit hygiene:** each of the ten landings touches only its `OWNERSHIP.md` files plus its report — verified per-commit with `git show --stat`. `cdeeb15`/`6c97fa0`/`b65ad06` touch only `PROGRESS.md`.

## 3. Freeze check

All verified against the actual range diff, not report claims:

- **Allowed-to-change set honoured:** `events.ts`, `replay.ts`, `gate-apply.ts`, `flowchart-run.ts`, `main.ts` (plus `flowchart-supervisor.ts`) changed only inside R8-1's signed-off schema work. **No undisclosed extras:** `package.json`, `pnpm-lock.yaml`, `src/persist/**`, `src/run/crash-terminal.ts`, `src/run/scheduler.ts`, and `scripts/**` all diff-empty across the round.
- jsonl signatures / `writeFileAtomic` / no new private tmp+rename: the round's entire `src/**` diff adds **zero** raw fs write primitives (`writeFile`/`rename`/`appendFile`/`createWriteStream` grep over added lines: empty); the unblock producer writes only through `EventStore.append` and `CheckpointStore.write`.
- append + checkpoint still take no run lock; `withRunLifecycleLock` acquired once, non-reentrantly, by `unblockFlowchartRun` — the correct class of operation for it (serializes against resume/delete).
- `recordCrashTerminal` rethrow contract intact (file byte-identical; now cited by name from `coordinator.ts`).
- Reconstruction contract: `childTasksFromLog` untouched (no hunk in the range names it); no-contract flip-pin present at HEAD (`resume.test.ts:524`) and absent from the round diff.
- Criteria-are-guidance record: `src/tracking/**` diff-empty; `coverageOutcome` range still NOT_APPLICABLE/PASS/UNOBSERVED; R6-2 tripwire present at `flowchart-run-abort.test.ts:1239` and green in the gate.
- Empty-graph pre-flight: `graph/validate.ts` diff-empty.
- Five `DOCTOR_ROUTED_NEXT` routes: extracted at baseline and HEAD and **diffed character-exact** — identical; `CATALOG_OBSERVED_CORRUPT` still in the map.
- Loopback supervised-resume pin: `test/integration/cli/loopback-cli-resume.test.ts` **byte-identical** (empty diff).
- `applyRetry` sole scheduler producer: `src/run/scheduler.ts`, `test/unit/run/scheduler.test.ts`, and `test/integration/m2/scheduler.test.ts` all byte-identical; R8-3's new AST pin additionally holds both flowchart sources.
- No live R1/bandit/topology: `routing/` diff is the four-line posture comment only; `live-isolation.test.ts` unchanged and green in the gate; `selectArm`'s only `src` caller remains `routing/shadow.ts` (shadow plane). ADR-006 Proposed (`docs/decisions/0006…md:3-5`); `docs/decisions/` diff-empty for the entire round. No Outcome-supported claims added (`docs/status-matrix.md` still records "Nothing in this repo is Outcome-supported").

## 4. Requested target verifications

### 4.1 R8-1 — every requested property, against the diff

- **Payload:** `RunUnblockedPayload { blockedEventId: EventId; reason: string; retryNodeId?: string }`, exact-keyed validation naming unknown keys individually, refusing invalid/missing `blockedEventId`, blank `reason`, present-but-empty/non-string `retryNodeId`. No evidence field. Matches `loop4-r7-t3.md` as written.
- **Dedicated locked command, not injection:** `unblockCommand` in USAGE/dispatch/prose; `unblockFlowchartRun` wraps `withRunLifecycleLock`; the three-reason justification is in-source at both the CLI and the producer.
- **Latch clear:** a matched unblock sets `sawTerminal = false` and drops status back onto the pre-terminal ladder (`sawCancel`/`unmatchedPause`/`sawWaiting`/`sawStarted` re-derive PAUSED/CANCELLED/WAITING_FOR_USER/RUNNING — pinned in `an unblocked run re-derives its status rather than asserting RUNNING`), so `replayedTerminalStatus` is `undefined` and **every existing recorder opens with zero per-writer edits** — confirmed: no recorder function is touched anywhere in the range diff.
- **`TERMINAL_REPLAY_STATUSES` unchanged** (set literal untouched; only its docstring grew) and `RUN_UNBLOCKED` is not a status.
- **Stale/wrong-terminal/unmatched stay latched** with the three distinct anomalies, terminal untouched — in `replayRun` and pinned across three new tests including the after-COMPLETED/after-FAILED/never-blocked triple and the spent-authorization repeat.
- **Both block shapes:** headline gate-block test on the R6-1 seed (verification-failed clustered child → `ANALYSIS_QUEUED` → FAILED node → `--retry-node` mandatory and exact-matched via `resolveRetryTarget`/`gateBlockedFailedNode`); stall shape (no failed node → no target demanded, ledger latch `isBlocked`/`consecutiveStalls`/`requiredEvidence` cleared for **both** shapes in `reopenAfterUnblock`).
- **Append-before-checkpoint:** transform → append → checkpoint, each ordering reason in-source; four producer refusals leave the log untouched (pinned: `unblockEvents(...).length === 1` after four rejections).
- **Event-first crash recovery idempotent vs `lastEventId`:** `unappliedUnblock` compares the clearing unblock's log position with `eventIndex(events, checkpoint.lastEventId)`; `restoreCheckpointedSupervisor` is shared by `resumeLockedFlowchartRun` **and** `restoreFlowchartSession` (pause/inject), so the crash window cannot be checkpointed back out. Both directions pinned: pre-unblock checkpoint restored then recovered once; already-reopened checkpoint not re-applied.
- **Distinct reopen, no `applyRetry`:** `FlowchartSupervisorImpl.reopenAfterUnblock` / `reopenBlockedFlowchartSnapshot`; runs through a restored supervisor (restore validation + waiter invariant + propagation fixpoint); appends no `TASK_STATUS_CHANGED` (pinned in the headline test); R8-3's AST pin green; `scheduler.ts` and both scheduler test files byte-identical.
- **`currentGateStatus`:** matched unblock reads as RUNNING, stale/unmatched leaves BLOCKED — same block-id rule as replay; observed end-to-end by the re-block cycle test (`from: "RUNNING"` on the second transition).
- **Tripwire replaced, not weakened:** the `EVENT_TYPES.includes("RUN_UNBLOCKED") === false` assertion is gone; the surrounding operator/scheduler-signals test is kept and renamed; the assertion survives **inverted** (presence pinned); five new replay tests cover matched / status re-derivation / stale+repeated / wrong-terminal / two full BLOCKED→RUNNING cycles with per-block authorizations.
- **`event-row-fuzz`:** exact-keyed seed inserted at the `EVENT_TYPES` position (the suite pins `Object.keys(EVENT_SEEDS)` against `EVENT_TYPES`), plus seven named payload refusals and the valid stall-shape omission.
- **Note repaired:** `formatBlockedRunReport` no longer contains either retired clause; four routed lines `deepEqual`-pinned verbatim, retired claims pinned absent by string.
- **Flowchart `resume`/`answer` wired:** `reportBlockedRun` at both sites; a four-site source pin over every `return flowchartExitCode(outcome.status)` with a mutation check; supervised branch untouched with the reason in-source.
- **`loopback-cli-resume.test.ts` byte-identical; no `contract` on `FlowchartCheckpointState`** (grep of `replay.ts` at HEAD: zero matches).
- **Integration:** the R6-1 seed runs BLOCKED → `unblock --retry-node` → resume → node re-executes exactly once → COMPLETED; one log, `["RUN_BLOCKED", "RUN_COMPLETED"]` in order, `anomalies: []`; executor `taskIds` `[]` after unblock and `[NODE]` after resume — authorize/execute separation asserted directly.
- **Fail-closed rewind of executed descendants** throws naming the node, is pinned against a production-shaped snapshot, and is **disclosed** as report §11.1 — a residual with a prescribed future contract, not a silent widening.

### 4.2 R8-2

No `src/**` (commit touches only `resume.test.ts` + report). The flip-pin `a resume that is handed no contract assesses its children against none` is **unflipped and byte-untouched** (present at `resume.test.ts:524`; zero hits in the file's diff). The three absence pins are honest at HEAD: `FlowchartCheckpointState`/validator/`persistCheckpoint`/`restoreFlowchartSession`/`checkpoint-store.ts` contain no `contract`; `episode-bind` projects `acceptance: contract.acceptanceCriteria` and neither `contract:` nor `constraints:`; `flowchartContinuation` accepts `checkpoint?: RunCheckpoint` and projects no contract, and `resumeCommand` feeds it the checkpoint. The next-half design (§3 of the report) is complete and correct — writer, restorer, CLI projection, precedence rule, never-synthesize rule, and a test census including the `row-fuzz` seed gap. Ready now that R8-1 has released `replay.ts`/`flowchart-run.ts`. Nit in §6.

### 4.3 R8-4 — fourth precondition verified in source, not from the report

No `src/**`; `coverageOutcome` FAIL-free; R6-2 tripwire present and green. The claimed fourth precondition **holds, re-verified independently**: (1) `assessChildObservation` (`from-child.ts`) returns `{ apply: false }` unless `verification.kind` is `PASSED` or `FAILED`; (2) the complete `src/**` census of `verification: { kind: … }` producers is exactly three — `cli/main.ts` `ChildFakeExecutor` (PASSED), `testing/fake-executor.ts` (PASSED), `pi-adapter/pi-executor.ts` (UNOBSERVED) — plus one comment in `flowchart-run.ts`; (3) `translatePiEvent` maps pi's stream to TEXT_DELTA / TOOL_STARTED / TOOL_FINISHED / turn-end only and never to `MESSAGE`, so `finish` always synthesizes `verification: { kind: "UNOBSERVED" }`, which (1) refuses. The tracking gate therefore has exactly two production-reachable states: not running (`--executor pi`) or always-opening (`--executor fake`). Pin 2 locks this; pin 3's 54-of-270 counterfactual and pins 1/4/5 are landed and green.

### 4.4 R8-5 — ADR census and the staleness flag

ADR-006 Proposed everywhere; **no ADR file was opened at all** (`docs/decisions/` range diff empty), so no status line moved. The `supervisor.ts` edit is comment-only (docstring rewrite of the retired empty-list seed; verified in the diff — no code line changes). The docs correctly record `loadProjectBanditByKey` in the R1 matrix row and the post-unblock operator surface. **Stale at HEAD, flagged not fixed (Round 9 docs slot):** (a) `docs/status-matrix.md:66` still says "R8-9's **in-flight working-tree edit** removes the unused root-keyed `loadProjectBandit`" — that landing is committed at `ba0b2ce`, so the in-flight framing is stale; (b) the three 21:50 UTC sync notes say R8-1's replay/BLOCKED-output pins "were still being rewritten" — honest as dated censuses, but superseded: those pins landed in `05051ac`; (c) `docs/decisions/0005…md:110` still names the now-deleted `loadProjectBandit` (ADR body — R8-5 flagged it correctly and left it; it stays flag-only).

### 4.5 R8-6

Option (b) posture recorded in-source beside `CatalogObservedCorruptError` in `catalog-observed.ts` (not `main.ts`). Catalog route not dropped; the five-entry `DOCTOR_ROUTED_NEXT` map extracted at baseline and HEAD diffs **character-exact**. `main.ts` is untouched by commit `ffc0728`. The bandit test is the **real producer**: real `main(["adapt","auto",…])` over a model-attributed Pi subagent run with `SPARKLE_AUTO_ADAPT=1` and truncated bytes at `projectBanditPath(stateRoot, stableProjectKey(projectRoot))`; pins exit 1, `command: "adapt"`, `stage: "validation"`, the complete routed `next:` string verbatim, the damaged path in the message, and doctor's `learnedState` entry (kind/stateClass/projectKey/status/remediation). No catalog producer was faked. The obsolete `configurePreferencePersistence(undefined)` `finally` repair and its import are gone, per sign-off.

### 4.6 R8-7

`crash-terminal.ts` diff-empty (verified in the range sweep). The refusal stays terminal-keyed — decision recorded as the `## Terminal-keyed, and that is the decision` section on `recordTerminal`, with the cost stated (a crash over WAITING_FOR_USER records `RUN_FAILED`; an out-of-band `USER_ANSWER` can no longer clear the buried wait) and both widenings named and refused. `writeCancel` stays unguarded with the operator-fact rationale, corrected cross-plane evidence (supervised `recordCancel`, not the nonexistent flowchart producer), and R4-3 cited from the other side. `recordTerminal` remains the only parent-plane terminal writer — and test 4 now makes the ordinary bypass mechanical instead of review-only. The `failureReason` cleanup is a branch-local `const` with byte-identical payload strings on both arms.

### 4.7 R8-8

`INSPECT_SUMMARY` frozen additive: `SUMMARY_CONTRACT_KEYS = ["type","runId","status","requiredEvidence"]` with `Object.keys` pins on **both** the stalled and clean branches plus full `deepEqual`s; the new non-Event test pins `EVENT_TYPES` non-membership **and** `validateEvent` refusal of a well-formed row typed `INSPECT_SUMMARY`; the `--json` purity pin's assertions are unchanged; no `main.ts` or any `src/**` edit (commit touches `inspection.test.ts` + report only).

### 4.8 R8-9

`loadProjectBandit` deleted; zero occurrences in `src/**`; the keyed reader's docstring no longer names the retired alias. Namespace absence pin landed (`"loadProjectBandit" in banditStore === false`). `live-isolation.test.ts` untouched: line 260 still requires `loadProjectBanditByKey` in doctor, line 266's sweep still covers `loadProjectBandit(?:ByKey)?`. `selectArm`'s only `src` caller remains `routing/shadow.ts` (shadow plane, held out of the live closure by the isolation pin). `doctor.ts` untouched, so `learnedState` JSON unchanged by construction.

### 4.9–4.11 Freeze / skips / R8-3+R8-10

Covered in §3 (freeze), §2 (skip count stays 1, `PI_SMOKE` only). R8-3: the pin parses both flowchart sources with the TypeScript AST, rejecting `applyRetry` identifiers/string-literals and static/dynamic/namespace `scheduler.js` imports; its second test mutation-proves both rejection arms against synthetic regressions — credible, and green at HEAD **with the reopen present in both scanned files**. R8-10: the additive seed arms a nine-id budget so the bind succeeds and the `TASK_GRAPH_ACCEPTED` id throws; the test asserts `RUN_ATTACHED` present, `TASK_GRAPH_ACCEPTED` absent, exactly one `RUN_FAILED`, **`afterTerminal(read.events) === ["EPISODE_CLOSED"]`**, replay/episode/checkpoint all FAILED, zero anomalies. R7-9's failed-bind seed and its assertions are untouched.

## 5. Per-slot notes

- **R8-1** (opus): The cleanest large landing this loop has produced — ~2,090 lines, every design decision traceable to R7-3's document or an in-source justification, and the two deviations from the design's prose (`retryNodeId` optional-by-necessity; the gate-change proof via the re-block cycle) are both censused, explained, and the better call. The `applyChildThreeLine` runStatus observation (report §11.3) is a genuinely useful finding for whoever touches the gate next.
- **R8-2** (gpt-sol): Disciplined half-slot under contention; the design section is implementation-grade, including the `row-fuzz` seed gap nobody asked it to find.
- **R8-3** (gpt-sol): Right-sized. The AST approach is strictly stronger than the grep the brief would have tolerated.
- **R8-4** (opus): The census upgraded the round's understanding of option (a) from "three changes" to "four preconditions", and the 54-of-270 measurement converts a folklore argument into a number with a pin under it. The straw-man guard on pin 3 (asserting the direct `evaluateGates` call reproduces `runTrackingTurn` first) is the kind of rigor worth naming.
- **R8-5** (gpt-sol): Executed the R7-6 lesson (working-tree census with timestamps, three passes). The staleness in §4.4 is the unavoidable cost of docs racing a spine slot, and the dated notes make it recoverable rather than misleading.
- **R8-6** (gpt-sol): The rewrite of the pref-list test into the real `adapt auto` producer (rather than adding a parallel test) kept the file lean; env restore is correct.
- **R8-7** (opus): Correcting R7-4's cross-plane wording instead of quoting it is exactly the evidence discipline this loop wants; test 4 converts a review-only obligation into a mechanical one.
- **R8-8** (opus): The freeze lives in the right place given the producer is inline in R8-1's sole file; the declined `inspection.ts` comment is the right call and the disclosure says why.
- **R8-9** (gpt-sol): Small, complete, absence-pinned; kept `banditPath` live for the writer rather than over-deleting.
- **R8-10** (gpt-sol): The armable-budget generator matches the established pattern; the disarm-after-throw detail is what lets the guarded terminal write its own ids.

**Nits (the ACCEPT-WITH-NITS basis and two report-text corrections):**
1. **R8-2 (code nit):** the third absence pin captures `resumeCommand` with `/async function resumeCommand[\s\S]*?^}\n\nconst PREFERENCE_SCOPES/m` — R8-1 landed `unblockCommand` between the two anchors, so the captured region (and its `doesNotMatch(/\bcontract\b/)`) now silently includes `unblockCommand`'s body. Harmless today and green, but a future comment in `unblockCommand` containing the word "contract" would turn a pin named for `resumeCommand` red for the wrong reason. The durable-contract slot replaces these pins in the same diff anyway — fix the boundary then.
2. **R8-1 (report nit):** §10 cites `src/graph/scheduler.ts`; the scheduler lives at `src/run/scheduler.ts`. The actual file is byte-identical, so the claim's substance holds.
3. **R8-1 (report nit):** "my 24" — static registration delta across its five test files is +23. The tree-level accounting closes at exactly +41 regardless.

## 6. New findings for Round 9

1. **The durable run contract is unblocked** (R8-2's design, files released by R8-1) — the round's natural P1. One schema sign-off; R8-4 §5.3 wants per-task acceptance criteria to ride the same checkpoint seam, so the sign-off should decide whether to reserve room for both.
2. **Executor verdict producer (R8-4 precondition 0):** no shipped executor can emit the verdict the gate admits on. A `report_task_result` tool on `PiAgentExecutor` (the `PiExecutorOptions.tools` + `createClusterTools` precedent) is the smallest change that makes the already-signed-off `deterministic-fail` gate real for `--executor pi`. No protocol schema change — the existing `TASK_RESULT` carries it. R8-4 pin 2 is a replace-in-same-diff obligation for this slot.
3. **Executed-descendant discard (R8-1 §11.1, disclosed residual):** a gate block whose failure fanned into completed downstream work is still unfixable by `unblock` alone; needs its own authorization contract (explicit discard flag with its own audit record). Contends with candidate 1 on `flowchart-run.ts`/`main.ts` — design-only if co-scheduled.
4. **Docs staleness at HEAD** (§4.4): `status-matrix.md:66` in-flight framing; the three sync notes' "pins were still being rewritten"; plus R8-8's suggested producer-side one-liner at the `INSPECT_SUMMARY` literal in `main.ts` (unowned, one comment).
5. **Gate reconstruction is nearly write-only on the flowchart plane** (R8-1 §11.3): `applyChildThreeLine`'s `runStatus` is discarded there; the `from` field of the next transition is the only observable, exercised by exactly one test. A posture comment or a consumer is a decision, not a refactor.
6. **The unblock crash window is not in the standing probe:** the append-before-checkpoint window is covered by integration tests using checkpoint-rollback simulation, but `scripts/crash-probe.mjs`'s nine SIGKILL cases predate it. A tenth case (kill between append and checkpoint write, then resume) would put the recovery under the same real-process discipline as the other windows — the owner also updates `crash-recovery.test.ts`'s reduced-probe name-list pin in the same slot, with disclosure.
7. **R8-2's pin-boundary nit** (§5 nit 1) — folds into candidate 1, same file, same diff.

## 7. Handoff

- Gate GREEN at `b65ad06`: 1845/1844/0/1 (`PI_SMOKE` only), crash-probe 9×3 `ok: true` — both re-verified independently on this VM and matching the parent's record. The +41 closes per-slot (§2).
- The Round 9 injection brief is at `.agent_workspace/ROUND8-BRIEF.md`: ranked mutually exclusive candidates from the verified findings above, the grown frozen-contract list (`RUN_UNBLOCKED` semantics, the INSPECT_SUMMARY freeze, the `loadProjectBandit` absence, the catalog posture, the parent-plane residual decisions), and the standing prohibitions (ADR-006 Proposed, no live R1, no Outcome-supported claims).
- Nothing is left red, nothing needs a parent fix-joint. The one nit worth an owner is R8-2's region regex, and its owner is the durable-contract slot by construction.
