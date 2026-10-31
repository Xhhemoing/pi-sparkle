# Historical delivery summaries archived 2026-10-21

Moved from active task entries without changing historical assertions. Relative links were rebased. Unresolved obligations remain in the active checklist; archived unchecked snapshots do not create new actions or approvals.

## Source: tasks/plan.md

## Historical delivery record — SoL-Pi efficiency line (merged 2026-09-12/13)

Merged via PR #36 into remote main. Facts and per-slice scope (from the `grok/sol-efficiency` delivery):

- **PR-A harness-efficiency**: offline JSONL aggregator + thin CLI (`scripts/analyze-harness-efficiency.ts`). Does not touch the runtime CLI, ExecutionEvent, or observation store (PR-B).
- **PR-B observation store + offline projection**: the original PR-B delivery was a run-scoped content-addressed observation archive plus pure projection/recall; its original scope had no live Pi executor/CLI main wiring. Privacy class `run-observation` registered; `deleteRunRecords` cascade covers the archive via the run subtree rm. Native live wiring was delivered separately on 2026-09-20 and is recorded in the current Native Pi section above.
- **PS-HOTFIX provider failure attribution** (`ed9a6e9`): provider/env failures synthesize `verification: UNOBSERVED` + `failure.category: PROVIDER_ERROR` (FailureClass `provider`) so they never enter deterministic `taskSuccess` FAIL / model bandit poisoning. Real agent-reported FAILED-with-evidence remains model-attributable. NOTE: this repo's hotfix line (`5256339` on `cursor/ps-hotfix-provider-fail-attribution`) is an independent fix of the same issue; see the merge-commit reconciliation.
- **PS-P3 real closed loop** (`950b9ef`): isolated worktree + worktree-scoped coding tools + independent command check + run-scoped loop artifacts + acceptance that fails closed on self-report alone. Tool injection at `createConfiguredPiExecutor` / `PiAgentExecutor` `options.tools` (not prompt-only).
- **PS-P4 trusted experiments (F6 hard gate)** (`d84cfc0`): equivalent R0/R1 taskSpec compile, freeze, observation-ledger dedupe, independent oracle, evidence retention keep-raw. No F6 promotion.
- **PS-P5 efficiency** (`4804d4c`): incremental checkpoint replay, event aggregation, duty splits.

The original PR-A/B/HOTFIX/P3/P4/P5 scope and merge-hash record above are retained as dated historical evidence; later native live wiring is not retroactively attributed to PR-B.

Delivery evidence: [delivery status](../reports/2026-09-13-sol-efficiency-delivery-status.md). Independent Reviewer room PASS artifacts are not on the GitHub reviews API (see G0 report). Do not reimplement the merged chain. F6 seal/holdout, extension/live-adaptation and Outcome-supported remain separately gated.


## Delivery gate coordination — historical evidence (closed 2026-09-20)

**All three delivery PRs merged on 2026-09-20:** #42 (`b1f2ee8`; independent review by luna-fast found the RUN_CREATED payload identity P1, fixed in `928995d`, delta PASS), #43 (`7bdc591`; owner-completed human conflict review per the packet), #44 (`bb62d792`; native Pi integration, independent review PASS after process/hygiene fixes). Post-merge cleanup 2026-09-20: 18 merged local branches deleted (merge-base verified), 19 worktrees removed (r-fix dirty draft archived at `.agent_workspace/archived/r-fix-draft-5357163-2026-09-20.patch`), review worktrees disposed. **PR #45 (`fix/apply-head-drift-rollback`) merged 2026-09-20 as `abbf4461`** with owner authorization given in session; luna-fast review PASS and hosted CI green preceded the merge. Same-day remote cleanup: the 8 remaining merged remote branches (`cursor/*`, `grok/trusted-execution-g*`, `sota-persistent-opt-83a1`) deleted after merge-base verification — remote now has only `main`. Remaining open: SCM/xhh #36 evidence request (unresolved), F6 prerequisites (parked). This paragraph is historical evidence, not a current action.

Progress 2026-09-20: PR #42 independent review **executed** (owner-designated luna-fast): full review of `aeb4993` returned REQUEST CHANGES on exactly one P1 (RUN_CREATED payload identity gap in `assertRunPresent`); fix `928995d` implemented RED→GREEN, delta re-review **PASS** (evidence: [review record](../reports/2026-09-20-rr-review-luna.md)). Owner authorized push; remote PR #42 head was `928995d` before the recorded merge.

`TASK-20260918-delivery-gate-unblock`: [plan](../superpowers/plans/2026-09-18-delivery-gate-unblock.md), [evidence and requests](../reports/2026-09-18-delivery-gate-unblock.md). Its former open-PR, pre-merge, and pending-disposal wording is superseded by the dated merge record above; the linked evidence remains authoritative history. F6 preparation, custody, pricing, and seal remained separately gated. Three dirty temp trees were preserved pending PASS and approved disposal manifest; the later disposal record is retained and does not authorize new deletion.

### Superseded 2026-09-18 delivery snapshot

The original snapshot is retained as dated evidence; its open-PR, pending-disposal, and pre-merge wording was superseded by the 2026-09-20 merge record above:

- [x] Live #42/#43 head/CI checks, PR requests, F6 census, and temp-tree inventory recorded (2026-09-18; [delivery gate record](../reports/2026-09-18-delivery-gate-unblock.md)).
- [x] Independent PASS on #42 `928995d` (delta re-review) and #44 (PASS after hygiene fix); #43 human conflict review was then pending owner completion. Later evidence preserves the merge hashes `b1f2ee8`, `7bdc591`, and `bb62d792`.
- [ ] Custodian completes 100+15 materials off-repo; owner rules on public-draft contamination. Existing 115 drafts did not satisfy that gate.
- [ ] SCM verifies SM95 key metadata/separation, binds existing ESTIMATE prices, and seals only after preregistration and G3 runner/readiness gates. No experiment run was claimed.
- [ ] After review PASS, preserve dirty/ignored content and approve the exact three-temp-tree disposal manifest before cleanup; no deletion was authorized by this snapshot.

Current open items are SCM/xhh’s unresolved PR #36 evidence request, F6 custody/readiness/seal prerequisites, independent review re-dispatch for the 2026-09-20 registration/routing/projection slices, and the R10/R11 evaluator/apply boundary. No PR merge, disposal, outage resolution, experiment, or production authorization is performed or claimed by this documentation slice.

## Superseded historical record — Grok follow-up (2026-09-13–17)

The dated review-repair record is retained for provenance. Its pre-merge wording is superseded by the 2026-09-20 delivery records above: PR #42–#45 merged, associated disposal evidence was recorded, and those are not current pending actions. The historical author-run evidence remains author verification, not blanket acceptance or independent review. F6 remains separately gated; no provider/holdout/seal run is claimed on this line.

`TASK-20260913-grok-trusted-execution` / `TASK-20260913-grok-review-repair`: re-review 2026-09-14 returned REQUEST CHANGES on full local candidate `412230a`; all RR residuals (RR1/RR2/RR4) fixed 2026-09-16 and delivered as commit `aeb4993` (fast-forward onto PR #42, [review package](../reports/2026-09-16-rr-fix-review-package.md)). PR #42 head `aeb4993` carried the full candidate; hosted CI green (rerun 2026-09-17). Author-run same-head evidence (5 old + 3 new regressions, focused 61, gate 2771, probes) completed 2026-09-17 on a fresh checkout; independent review dispatch failed on provider quota (402) and remained with the owner / Grok bot per the turnkey protocol. This is historical author evidence, not independent acceptance; F6 stayed NOT READY and no provider/holdout/seal run is claimed.

The original G0–G3 scope is retained as historical evidence only: G0 reproducible workflow baseline/evidence reconciliation ([report](../reports/2026-09-13-grok-g0-baseline.md)); G1A independent acceptance binding command/argv and candidate content; G1B tool/artifact boundaries; G2 real adapter plus local HTTP loopback without live LLM/default CLI; and G3 report-only F6 readiness/pollution inventory ([report](../reports/2026-09-13-grok-g3-f6-readiness.md)), **NOT READY**, experiments not run. No new execution is authorized by this historical record.

## Source: tasks/todo.md

## SoL-Pi efficiency line — PR-A / PR-B / PS-HOTFIX / PS-P3 / PS-P4 / P5 (merged 2026-09-13)

Merged via PR #36; per-slice closeout facts are historical evidence in [tasks/plan.md](../../tasks/plan.md). The unresolved SCM/xhh evidence request and owner-authorization provenance remain open historical records; they do not reopen the merged delivery or authorize new work.

## Grok follow-up — superseded historical evidence (2026-09-13–17)

Original plan: [trusted execution](../superpowers/plans/2026-09-13-grok-trusted-execution.md); original [repair prompt](../superpowers/plans/2026-09-13-grok-review-repair-prompt.md). The G0–G3 checklist below is retained for provenance only; its pre-merge, pending-disposal, and pending-review wording is superseded by the dated 2026-09-20 delivery reconciliation above. Do not interpret it as current work or phase acceptance.

- [ ] G0 — reproducible workflow baseline + evidence reconciliation; report `docs/reports/2026-09-13-grok-g0-baseline.md`.
- [ ] G1A — independent acceptance binds command/argv + candidate content; focused RED/GREEN + `pnpm gate`.
- [ ] G1B — tool/artifact boundaries; gate/security/Pi probes.
- [ ] G2 — real adapter + local HTTP loopback after G1A/B; no live LLM / default CLI.
- [x] G3 — F6 readiness/pollution inventory (report-only); no seal/oracle. See [g3 report](../reports/2026-09-13-grok-g3-f6-readiness.md). **NOT READY**; experiments NOT RUN.
- [x] Earlier G0–G3 merge facts remain verified: PR #37–#41 MERGED, remote main `fe253301`; do not reimplement them (2026-09-13 evidence retained in prior report).
- [x] Original R1/R2/R3/R4 concrete regressions plus staged-delete control rerun unchanged on full candidate: 5 pass / 0 fail / 0 skip (2026-09-14). This closes those exact counterexamples, not all related boundary acceptance.
- [x] Focused 57/57; gate 2767 pass / 0 fail / 18 skip; post-build security probe 26 PASS and Pi probe 4 PASS (2026-09-14). Initial pre-build security probe failed due missing dist; both attempts recorded.
- [x] RR1 (P1) — rename source identity: fixed 2026-09-16 on the local full candidate (`merge-r3r4`, uncommitted): `parsePorcelainZ` preserves rename/copy source; source-swap regression added and RED→GREEN verified (evidence: [2026-09-16 review report](../reports/2026-09-16-whole-repo-review-next-steps.md)). Pending independent re-review on the final head.
- [x] RR2 (P1) — durable run identity: fixed 2026-09-16 on the local full candidate: `assertRunPresent` validates via `EventStore.readAll()` (empty/corrupt/mid-corrupt/identity-mismatch/no-RUN_CREATED rejected, torn tail tolerated); all empty-log fixtures replaced with real initialization; controlled delete/write interleave test added. Pending independent re-review on the final head.
- [x] RR4 (P2) — timeout validation: fixed 2026-09-16 on the local full candidate: `timeoutMs` must be a finite positive safe integer (1..2147483647); 0/negative/NaN/Infinity rejected before spawn; default 60000 preserved. Pending independent re-review on the final head.
- [x] SCM aligned PR #42 with the final full candidate 2026-09-16: head pushed as fast-forward `5357163` → `aeb4993` (R3/R1 verified ancestor; R2/R4 included). Hosted CI green on the head (first run failed on the pre-existing delete-vs-writer race flake, failed-job rerun success 2026-09-17; test observation fixed in `6ae179c`).
- [x] Author-run same-head evidence on a fresh checkout of `aeb4993` (2026-09-17): original 5 + re-review 3 regressions pass, focused 61/61, gate 2771 pass / 0 fail / 18 skip, security + pi probes pass. Evidence: [review package](../reports/2026-09-16-rr-fix-review-package.md). Independent review dispatch failed on provider quota (402); review remains with the owner / Grok bot per the turnkey protocol.
- [ ] **Superseded historical checklist:** the former final-independent-review/merge wording for PR #42 is retained as dated evidence only. PR #42–#45 later merged per the 2026-09-20 reconciliation; no current merge or disposal action is pending here. Author verification remains distinct from independent review.

## Historical delivery record — SoL-Pi efficiency line (merged 2026-09-13)

Plan: [initial TASK-20260913-sol-pi-efficiency](../superpowers/plans/2026-09-13-sol-pi-grok-handoff.md). Latest: [delivery status, 2026-09-13](../reports/2026-09-13-sol-efficiency-delivery-status.md).

Live verification at 2026-09-13 08:22 UTC supersedes the earlier owner-reported unpushed status: **PR #36 is MERGED**, head `4804d4c625559b58675a4726bbdd43eeecb78e4c`, remote main `6ee16a3722fda35d9b6098144602f199fb0a7d0f`. Evidence for checked items: [post-merge verification](../reports/2026-09-13-sol-efficiency-delivery-status.md), including query artifacts and exact CI link. This is delivery-fact verification, not blanket acceptance of every policy gate.

- [x] Full tip SHA, accessible local chain and stage-to-scope mapping established (2026-09-13); PR-A/B/HOTFIX/P3/P4/P5 commits and reports listed in the evidence record.
- [x] Reviewed-chain head pushed and PR opened: [PR #36](https://github.com/Xhhemoing/pi-sparkle/pull/36), head `4804d4c625559b58675a4726bbdd43eeecb78e4c` (live GitHub verification 2026-09-13).
- [x] GitHub reports all three hosted checks SUCCESS; delivered head is the previously reported tip, merge parents include it and merge/head trees match (2026-09-13). No fresh local product gate is claimed.
- [x] Merge fact verified: PR #36 merged `2026-09-13T08:19:09Z`; live main `6ee16a3722fda35d9b6098144602f199fb0a7d0f` (2026-09-13 API + ls-remote).
- [ ] SCM/xhh supplies per-stage independent Reviewer PASS artifacts with exact tested SHAs/commands and final independent gate record; GitHub reviews array is empty and PR body gate paste remains unchecked.
- [ ] SCM/xhh links original explicit/standing owner authorization for the exact delivered head; PR body mentions standing auth, but this session does not independently establish its source or confer authorization.
- [x] Local owner reconciled dirty HOTFIX/workflow changes: committed as `052fd5a` (governance/workflow) + `5256339` (provider-fail hotfix) on `cursor/ps-hotfix-provider-fail-attribution`, pushed 2026-09-16; origin/main synced into the branch 2026-09-17 (merge reconciling the independent `ed9a6e9` HOTFIX on main).
- [ ] F6 seal/real-provider holdout, extension/live adaptation/Outcome-supported remain separately gated; merged code and hosted CI are not F-PROD evidence.
## Superseded historical detail — SoL-Pi efficiency line (merged 2026-09-13)

- [x] Offline `EfficiencyRow` / `EfficiencyReport` aggregator + `scripts/analyze-harness-efficiency.ts` (`--evidence-class synthetic|observed --input --json`). `monetarySavingUsd` always null. PR-B observation store is out of scope.

## Superseded historical detail — PR-B observation store + offline projection

- [x] `ObservationStore` put/recall under `runtime/runs/<runId>/observations/objects/<sha256>.txt` (SHA-256, 8 MiB/object, 64 MiB/run, run lock, symlink refusal, 0700/0600)
- [x] `projectObservation` eligibility + priorFullSends full vs placeholder; enabled=false ⇒ no archive
- [x] Unit + integration tests (store / projection / lifecycle reduction ≥70%)
- [x] `run-observation` durable class + dictionary + status-matrix; delete cascade via run subtree
- [ ] Historical reviewer/merge wording superseded by the dated PR #36 delivery record above; do not treat this line as current work. The later 2026-09-20 native projection wiring is tracked in the current Native Pi section.

## Superseded historical detail — PS-HOTFIX provider failure attribution

- [x] finish() provider fail → UNOBSERVED + PROVIDER_ERROR (not FAILED empty evidence)
- [x] FailureClass `provider` + classifyTaskFailure / R1 / bandit / diagnostics filters
- [x] Regression: provider fail ∉ taskSuccess FAIL; model FAILED-with-evidence still counts
- [x] docs/reports HOTFIX note; pending-local-review cleaned

## Superseded historical detail — PS-P3 real closed loop

- [x] Isolated worktree create/dispose (`src/execution/worktree.ts`)
- [x] Worktree-scoped coding tools read/write/run (`src/execution/coding-tools.ts`) + path-escape refusal
- [x] Independent check runner binds exitCode / stdout+stderr hash / cwd / revision (`src/execution/independent-check.ts`)
- [x] Acceptance requires independentCheck + artifactHash; self-report alone fails closed (`src/execution/acceptance.ts`)
- [x] Run-scoped loop artifacts + `run-loop-artifact` durable class (delete cascade via run subtree)
- [x] `createConfiguredPiExecutor` accepts `tools` at execution boundary
- [x] Unit + integration tests (no live LLM)
- [x] `pnpm gate` green + freeze tip (no merge)

## Superseded historical detail — PS-P4 trusted experiments (F6 hard gate)

- [x] Equivalent R0/R1 full taskSpec compile (`src/experiments/task-spec.ts`); kill tasks[0]/placeholder prices/`Date.now`/fake family
- [x] Freeze config/catalog/dirs/provenance/clock; empty freeze + empty provenance fail closed
- [x] Observation ledger dedupe before bandit (`src/learning/observation-ledger.ts`); wired in auto-loop
- [x] Independent oracle + auditable pairing; collection vs task vs telemetry vs evidenceClass
- [x] Evidence retention keep-raw default; wired into retention delete gate; durable classes
- [x] Tests + `pnpm gate`; freeze tip (no merge / no push / no P5)

## Grok follow-up — trusted execution (2026-09-13)

Plan: [TASK-20260913-grok-trusted-execution](../superpowers/plans/2026-09-13-grok-trusted-execution.md).

- [ ] Historical G0–G3 checklist: no new execution is authorized by this record. G3 remains a report-only F6 readiness inventory; experiments were not run. Current evidence-first gates are tracked above.

## Historical delivery record — PR-A / PR-B / PS-HOTFIX / PS-P3 / PS-P4 / P5 (merged 2026-09-13)

- [x] PR #36 MERGED 2026-09-13T08:19:09Z; main `6ee16a3722fda35d9b6098144602f199fb0a7d0f` includes tip `4804d4c`.
- [ ] SCM supplies per-stage independent Reviewer PASS artifacts with exact SHAs (GitHub reviews array empty — unavailable).
- [ ] F6 seal/real-provider holdout remain separately gated.
