# Active implementation plan

Process entry point: [`AGENTS.md`](../AGENTS.md) -> [`docs/development-workflow.md`](../docs/development-workflow.md) -> [`tasks/README.md`](README.md). Keep this file for active scope and links; record dated evidence in the checklist or a report.

## GitHub/local integration (2026-09-28)

`TASK-20260928-sync-merge`: [plan](../docs/superpowers/plans/2026-09-28-sync-merge.md) and [verification/review record](../docs/reports/2026-09-28-sync-merge.md). The user authorized synchronization and compatible branch merges. PR #46, S0-min implementation and patch-equivalent O09 ancestry are integrated in candidate `3f5711ba`; the PR correction and S0-min specification/quality reviews independently PASS at that exact source revision. Final full gate/probes and publication are pending. Original drafts, O02 stash and eight conflicting branches are retained.

This dated update supersedes older planning-only statements about S0-min implementation authorization/review: Option A implementation is authorized and source-reviewed, but the boundary remains **not FROZEN** and owner acceptance is separate. D1/L1/L2, R10/R11, F6, broad reliability completion, live-provider work and production authorization remain open or deferred. Source merge does not close those gates.
## Reliability optimization execution (2026-09-27)

User authorized implementation with multiple subagents on 2026-09-27. Execution is isolated on `codex/reliability-optimization-20260927`; the original checkout and its planning changes are preserved. O01/O04, O02 setup, the bounded O05 evidence slice, O07 I/O, O08a queue and O11 empty-waiver repair have source/focused-test review; whole-plan acceptance remains open pending remaining work and integration verification. O09a/b is exclusively delegated to the coordinated `offline-determinism-o09` worktree, not implemented twice. [Execution record](../docs/reports/2026-09-27-reliability-implementation.md) records ownership, RED/GREEN commands, review and unresolved work. The paragraph below records the earlier planning result, not the current authorization state.

Delivery update (2026-09-27): the reviewed O08b/O09 commits have been integrated and remote `main` verified at `8ccdc1f9`. The user requested immediate synchronization without waiting for a new full gate; the interrupted gate is not counted as passed. O02 remains paused with recoverable local changes. [Exact second-sync record](../docs/reports/2026-09-27-reliability-implementation.md#second-urgent-github-synchronization--verified-result).

`TASK-20260927-reliability-optimization`: [consolidated plan](../docs/superpowers/plans/2026-09-27-reliability-optimization.md) and [review reconciliation](../docs/reports/2026-09-27-review-reconciliation.md), planning `ready-for-review`; implementation remains `planned`. Current-source review confirms apply rollback/identity/cancellation/disposal and bounded-read gaps; the supplied 2026-09-20 singleton-model and approximate observation-key findings are superseded by later code and fresh focused tests. First implementation priority is preserving concurrent user changes during apply, followed by cancellation/lifecycle and independent privacy/state/evidence corrections. No runtime code, new hash/baseline/gate, live run or production authorization is introduced by this planning slice.

The dated [controlled-improvement roadmap](../docs/superpowers/plans/2026-09-25-controlled-improvement-roadmap.md) remains authoritative over older summaries below: B0 accepted; D1 author candidate unreviewed; S0-min not approved/frozen; L1/L2/final review planned. R10/R11 and F6 remain separate.

## Earlier active-plan context

Delivery authorization update (2026-09-27): finish the implementable O01–O11 phase and required verification/review, then root alone coordinates local integration/merge, recoverable archival of delivered inactive worktrees, and a reviewed non-sensitive project-data commit/push to GitHub. O09a/b and O08b are delegated exclusively to the coordinated offline-determinism worktree; it remains in use and must not be archived. O12 and original human/experiment boundaries remain excluded. Preserve unrelated changes and unshipped work; inventory tracked/untracked/ignored data before publishing, never upload credentials or raw private sessions, and leave global user directories untouched. [Detailed delivery sequence](../docs/superpowers/plans/2026-09-27-reliability-optimization.md#2026-09-27-delivery-authorization-and-coordinated-ownership).

Urgent delivery-order correction (2026-09-27): publish the independently reviewed, full-gate-verified first batch promptly, then deliver the rest of O01–O11 in later commits. This supersedes waiting for every package before the first local merge/push; it does not narrow the whole phase or approve O09a's open P1. [First-batch gate and interim scope](../docs/reports/2026-09-27-reliability-implementation.md#corrected-first-batch-gate-and-probes).

Completed runtime M0–M2.5 and accepted adaptive slices were archived on 2026-08-17:

- [M0–M2.5 plan](archive/m0-m2-plan.md)
- [Acceptance record](archive/ACCEPTANCE-2026-08-17.md)
- [Full M3–M6 snapshot](archive/adaptive-plan-full.md)

The live adaptive remainder is [adaptive-plan.md](adaptive-plan.md). Checklist: [todo.md](todo.md) and [adaptive-todo.md](adaptive-todo.md).

Final spec (implement this): [2026-08-18-three-line-final.md](../docs/superpowers/specs/2026-08-18-three-line-final.md).
Project plan: [2026-08-18-three-line-project.md](../docs/superpowers/plans/2026-08-18-three-line-project.md).
Phase A: [2026-08-18-phase-a-tracking-supervisor.md](../docs/superpowers/plans/2026-08-18-phase-a-tracking-supervisor.md).
Phase B: [2026-08-18-phase-b-outcome-r1.md](../docs/superpowers/plans/2026-08-18-phase-b-outcome-r1.md).
Phase C: [2026-08-18-phase-c-offline-attribution.md](../docs/superpowers/plans/2026-08-18-phase-c-offline-attribution.md).
Phase D: [2026-08-18-phase-d-promotion-cas.md](../docs/superpowers/plans/2026-08-18-phase-d-promotion-cas.md).

Unplanned code already in the tree (`src/track/`, `src/cluster/`, `src/learning/auto-loop.ts`, `src/graph/compile-children.ts`) is **not** treated as a closed plan. It stays until it has its own accepted spec or is folded into the remaining adaptive work.

Native integration: `TASK-20260918-native-pi` is in progress under the [native Pi plan](../docs/superpowers/plans/2026-09-18-native-pi.md). Owner approved quality-first, preferred `cursor-grok-4.6-fast`, and modification scope B (global Pi configuration included; credentials/permissions excluded). ADR-006 was revisited and Accepted for the inbound adapter. Delivered locally-verified slices: read-only delegation ([2026-09-18](../docs/reports/2026-09-18-native-pi.md)); retained-write/acceptance ([2026-09-19](../docs/reports/2026-09-19-native-apply.md)); rollback follow-up via PR #45 (merged `abbf4461`); apply registration ([2026-09-20](../docs/reports/2026-09-20-native-apply-registration.md)); per-task delegate routing over the host catalog ([2026-09-20](../docs/reports/2026-09-20-native-delegate-routing.md)); live observation projection with `sparkle_recall_observation` ([2026-09-20](../docs/reports/2026-09-20-native-observation-projection.md)). The two 2026-09-20 routing/projection slices and the registration slice await a batched independent review re-dispatch (luna relay outage, [record](../docs/reports/2026-09-20-luna-dispatch-outage.md)). Remaining follow-ups: measured token deltas, CLI-side projection wiring, global-config allowlists. Checkpoint F still gates online adaptive selection and Outcome-supported claims. Background architecture: [Pi intelligent adaptive loop report](../docs/reports/pi-intelligent-adaptive-loop.md).

Next-phase authority: [TASK-20260921-evidence-first-phase](../docs/superpowers/plans/2026-09-21-evidence-first-phase.md) remains planned and amended, not accepted. Its read-only evaluator freeze, typed/fail-closed projection policy, cumulative recall budgets, exploratory-pilot limits, and separate R10/R11 boundary gate remain prerequisites. Three expert reports returned on 2026-09-21: two **REQUEST CHANGES** and one **APPROVE WITH CHANGES**; the fourth repository-consistency review was not run because of the concurrency limit. The amended documents require fresh low-concurrency review. No outage-fixed claim, review-passed claim, implementation approval, experimental/production approval, or product-positioning claim follows. Reconciliation slice: [plan](../docs/superpowers/plans/2026-09-21-evidence-first-reconciliation.md). Research synthesis and fact-vs-hypothesis boundary: [amendment](../docs/reports/2026-09-21-deep-research-plan-amendment.md). F6 remains parked under the 2026-09-20 owner decision and is not an execution prerequisite in this slice.

Proposed execution order after an approved review-channel decision: **Stage 0 evaluator/apply boundary design and freeze → projection hardening and mechanism/economic telemetry → read-only evaluator manifest freeze → exploratory A/B/C pilot**. Stage 0 and all later human, independent-review, budget/data, F6, and apply-authorization gates remain open.

## Controlled improvement roadmap (2026-09-25)

User delegated autonomous analysis and a concrete multi-agent plan. The planning baseline remains **Pi-first controlled continuous improvement**, with trustworthy evidence/change control as its foundation. A later independent review on 2026-09-25 returned **REQUEST CHANGES**; the [master roadmap](../docs/superpowers/plans/2026-09-25-controlled-improvement-roadmap.md), [dedicated checklist](controlled-improvement-todo.md), and [dated planning/reconciliation record](../docs/reports/2026-09-25-controlled-improvement-planning.md) now carry the controlling correction. No revised-plan PASS is claimed.

All new implementation tasks remain planned. The corrected critical path is **B0 → parallel D1 / S0-min → L1 → L2 → final review**. D1 reuses existing EventStore/inspection data on demand and creates no N1/N3 storage. S0-min is a hard dependency of L1 and freezes the neutral host outcome DTO plus the canonicalizer that L1/L2 must reuse. L2 merges the former E2/E3 work into a candidate-only historical view. CI-1c, E4 activation and formal promotion are deferred. No global lifecycle long lock is authorized before B0 records the real lock graph. R10/R11 and F6 remain independent gates; this plan closes neither.

### Superseded same-day draft note

The earlier sequence CI-0 → E1/N1 → CI-1a → E2/N2 → E3/N3 → CI-1b → CI-1c → E4/CI-2 is retained in the linked plans as pre-review provenance only and is not the current dispatch order.

## SHA-256 removal gate (2026-09-21, corrected)

`TASK-20260921-remove-sha256` is in progress under accepted [ADR-008](../docs/decisions/0008-remove-sha256.md). The user instructed removal of all first-party SHA-256 mechanisms and runtime integrity checks and delegated implementation to Luna. No replacement cryptographic hash is selected: opaque random versioned locators are used when an ID is needed; exact bytes are compared for equality/dedupe when needed, with no cryptographic tamper guarantee. Legacy records are never silently reclassified.

This acceptance authorizes implementation slices, not migration execution, live-provider runs, production apply, holdout resealing, or production rollout. The active bounded slice is the observation storage/projection slice: `src/context/observation-store.ts`, `src/context/observation-projection.ts`, `src/pi-adapter/observation-tools.ts`, and directly affected native projection wiring only if required, with the named observation unit/integration tests. It introduces `ObservationRef` v2 with opaque random locators and no digest field; persisted legacy refs/objects are refused rather than migrated or reused. Prior timeout/incorrect-assumption wording that recorded owner approval as pending is retained only as corrected history in the ADR/report.

## SHA-256 removal correction (2026-09-21)

The earlier timeout/incorrect-assumption entry recorded owner approval as pending. The user instruction corrected that record: removal and implementation are accepted and delegated to Luna. This correction does not authorize migration/live-provider/production-apply execution or close any experimental/production gate.

## Historical delivery record — SoL-Pi efficiency line (merged 2026-09-12/13)

Merged via PR #36 into remote main. Facts and per-slice scope (from the `grok/sol-efficiency` delivery):

- **PR-A harness-efficiency**: offline JSONL aggregator + thin CLI (`scripts/analyze-harness-efficiency.ts`). Does not touch the runtime CLI, ExecutionEvent, or observation store (PR-B).
- **PR-B observation store + offline projection**: the original PR-B delivery was a run-scoped content-addressed observation archive plus pure projection/recall; its original scope had no live Pi executor/CLI main wiring. Privacy class `run-observation` registered; `deleteRunRecords` cascade covers the archive via the run subtree rm. Native live wiring was delivered separately on 2026-09-20 and is recorded in the current Native Pi section above.
- **PS-HOTFIX provider failure attribution** (`ed9a6e9`): provider/env failures synthesize `verification: UNOBSERVED` + `failure.category: PROVIDER_ERROR` (FailureClass `provider`) so they never enter deterministic `taskSuccess` FAIL / model bandit poisoning. Real agent-reported FAILED-with-evidence remains model-attributable. NOTE: this repo's hotfix line (`5256339` on `cursor/ps-hotfix-provider-fail-attribution`) is an independent fix of the same issue; see the merge-commit reconciliation.
- **PS-P3 real closed loop** (`950b9ef`): isolated worktree + worktree-scoped coding tools + independent command check + run-scoped loop artifacts + acceptance that fails closed on self-report alone. Tool injection at `createConfiguredPiExecutor` / `PiAgentExecutor` `options.tools` (not prompt-only).
- **PS-P4 trusted experiments (F6 hard gate)** (`d84cfc0`): equivalent R0/R1 taskSpec compile, freeze, observation-ledger dedupe, independent oracle, evidence retention keep-raw. No F6 promotion.
- **PS-P5 efficiency** (`4804d4c`): incremental checkpoint replay, event aggregation, duty splits.

The original PR-A/B/HOTFIX/P3/P4/P5 scope and merge-hash record above are retained as dated historical evidence; later native live wiring is not retroactively attributed to PR-B.

Delivery evidence: [delivery status](../docs/reports/2026-09-13-sol-efficiency-delivery-status.md). Independent Reviewer room PASS artifacts are not on the GitHub reviews API (see G0 report). Do not reimplement the merged chain. F6 seal/holdout, extension/live-adaptation and Outcome-supported remain separately gated.


## Delivery gate coordination — historical evidence (closed 2026-09-20)

**All three delivery PRs merged on 2026-09-20:** #42 (`b1f2ee8`; independent review by luna-fast found the RUN_CREATED payload identity P1, fixed in `928995d`, delta PASS), #43 (`7bdc591`; owner-completed human conflict review per the packet), #44 (`bb62d792`; native Pi integration, independent review PASS after process/hygiene fixes). Post-merge cleanup 2026-09-20: 18 merged local branches deleted (merge-base verified), 19 worktrees removed (r-fix dirty draft archived at `.agent_workspace/archived/r-fix-draft-5357163-2026-09-20.patch`), review worktrees disposed. **PR #45 (`fix/apply-head-drift-rollback`) merged 2026-09-20 as `abbf4461`** with owner authorization given in session; luna-fast review PASS and hosted CI green preceded the merge. Same-day remote cleanup: the 8 remaining merged remote branches (`cursor/*`, `grok/trusted-execution-g*`, `sota-persistent-opt-83a1`) deleted after merge-base verification — remote now has only `main`. Remaining open: SCM/xhh #36 evidence request (unresolved), F6 prerequisites (parked). This paragraph is historical evidence, not a current action.

Progress 2026-09-20: PR #42 independent review **executed** (owner-designated luna-fast): full review of `aeb4993` returned REQUEST CHANGES on exactly one P1 (RUN_CREATED payload identity gap in `assertRunPresent`); fix `928995d` implemented RED→GREEN, delta re-review **PASS** (evidence: [review record](../docs/reports/2026-09-20-rr-review-luna.md)). Owner authorized push; remote PR #42 head was `928995d` before the recorded merge.

`TASK-20260918-delivery-gate-unblock`: [plan](../docs/superpowers/plans/2026-09-18-delivery-gate-unblock.md), [evidence and requests](../docs/reports/2026-09-18-delivery-gate-unblock.md). Its former open-PR, pre-merge, and pending-disposal wording is superseded by the dated merge record above; the linked evidence remains authoritative history. F6 preparation, custody, pricing, and seal remained separately gated. Three dirty temp trees were preserved pending PASS and approved disposal manifest; the later disposal record is retained and does not authorize new deletion.

### Superseded 2026-09-18 delivery snapshot

The original snapshot is retained as dated evidence; its open-PR, pending-disposal, and pre-merge wording was superseded by the 2026-09-20 merge record above:

- [x] Live #42/#43 head/CI checks, PR requests, F6 census, and temp-tree inventory recorded (2026-09-18; [delivery gate record](../docs/reports/2026-09-18-delivery-gate-unblock.md)).
- [x] Independent PASS on #42 `928995d` (delta re-review) and #44 (PASS after hygiene fix); #43 human conflict review was then pending owner completion. Later evidence preserves the merge hashes `b1f2ee8`, `7bdc591`, and `bb62d792`.
- [ ] Custodian completes 100+15 materials off-repo; owner rules on public-draft contamination. Existing 115 drafts did not satisfy that gate.
- [ ] SCM verifies SM95 key metadata/separation, binds existing ESTIMATE prices, and seals only after preregistration and G3 runner/readiness gates. No experiment run was claimed.
- [ ] After review PASS, preserve dirty/ignored content and approve the exact three-temp-tree disposal manifest before cleanup; no deletion was authorized by this snapshot.

Current open items are SCM/xhh’s unresolved PR #36 evidence request, F6 custody/readiness/seal prerequisites, independent review re-dispatch for the 2026-09-20 registration/routing/projection slices, and the R10/R11 evaluator/apply boundary. No PR merge, disposal, outage resolution, experiment, or production authorization is performed or claimed by this documentation slice.

## Superseded historical record — Grok follow-up (2026-09-13–17)

The dated review-repair record is retained for provenance. Its pre-merge wording is superseded by the 2026-09-20 delivery records above: PR #42–#45 merged, associated disposal evidence was recorded, and those are not current pending actions. The historical author-run evidence remains author verification, not blanket acceptance or independent review. F6 remains separately gated; no provider/holdout/seal run is claimed on this line.

`TASK-20260913-grok-trusted-execution` / `TASK-20260913-grok-review-repair`: re-review 2026-09-14 returned REQUEST CHANGES on full local candidate `412230a`; all RR residuals (RR1/RR2/RR4) fixed 2026-09-16 and delivered as commit `aeb4993` (fast-forward onto PR #42, [review package](../docs/reports/2026-09-16-rr-fix-review-package.md)). PR #42 head `aeb4993` carried the full candidate; hosted CI green (rerun 2026-09-17). Author-run same-head evidence (5 old + 3 new regressions, focused 61, gate 2771, probes) completed 2026-09-17 on a fresh checkout; independent review dispatch failed on provider quota (402) and remained with the owner / Grok bot per the turnkey protocol. This is historical author evidence, not independent acceptance; F6 stayed NOT READY and no provider/holdout/seal run is claimed.

The original G0–G3 scope is retained as historical evidence only: G0 reproducible workflow baseline/evidence reconciliation ([report](../docs/reports/2026-09-13-grok-g0-baseline.md)); G1A independent acceptance binding command/argv and candidate content; G1B tool/artifact boundaries; G2 real adapter plus local HTTP loopback without live LLM/default CLI; and G3 report-only F6 readiness/pollution inventory ([report](../docs/reports/2026-09-13-grok-g3-f6-readiness.md)), **NOT READY**, experiments not run. No new execution is authorized by this historical record.
