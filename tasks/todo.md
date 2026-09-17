# Active checklist

Process entry point: [`AGENTS.md`](../AGENTS.md) -> [`docs/development-workflow.md`](../docs/development-workflow.md) -> [`tasks/README.md`](README.md). Every `[x]` below requires dated evidence; unresolved contradictions must be recorded and corrected, not silently checked off.

Archived: [M0–M2.5](archive/m0-m2-todo.md), [acceptance](archive/ACCEPTANCE-2026-08-17.md).

## Human / policy gates (block claims, not local fake tests)

- [x] ADR-004 accepted and the six adaptive defaults approved, unchanged (2026-08-21). Exit recorded in [status-matrix.md](../docs/status-matrix.md).
- [x] Close P0: independent review returned **CONDITIONAL** (2026-08-22): Q3/Q4/Q5 pass; Q1 (plane isolation) and Q2 (delete tooling + cascade) were blockers — both remediated same day (see review package §7). Package: [2026-08-22-p0-privacy-review-package.md](../docs/reports/2026-08-22-p0-privacy-review-package.md).
  - 2026-08-22 re-verification: privacy/redaction suites 8/8 green against the remediation (technical check done; §6 command fixed to explicit file args).
  - **Closed 2026-08-26** by [technical re-verification](../docs/reports/2026-08-26-p0-technical-reverification.md): Q1/Q2 tests green. An independent privacy-officer countersign remains welcome but no longer blocks the Developer Preview (authoritative: [status-matrix.md](../docs/status-matrix.md)).
- [x] ADR-006 decided (2026-08-21): keep Proposed; no `extensions/pi-sparkle/` Pi import until revisited.
- [x] Cost-quality target resolved: ADR-005 Accepted (2026-08-19) locks the paired CI gates and six decisions.
- [ ] Holdout data source remains open as F6 work inside the F-PROD line; do not start F-PROD before P0 + provider smoke. See [gates readiness](../docs/reports/2026-08-21-gates-readiness.md).
  - 2026-09-04: [F6 decision package](../docs/reports/2026-09-04-f6-holdout-decision-package.md) drafted by three-model cross-validation (fable → gpt-5.6-sol challenge → kimi-k3 synthesis, host-adjudicated). Primary: clean-room paired dogfood blocks on this repo. ~~Blocked on 5 owner questions~~ → **answered 2026-09-07 by delegated adjudication** ([ADR-007](../docs/decisions/0007-f6-owner-questions-adjudicated.md), standing owner veto): dogfood closes internal validity with external validity permanently disclaimed; key-separated custodianship (SM95 key, in-repo ciphertext) substitutes for a named human; ESTIMATE price table v1 frozen with a billing reconciliation hook; R0 = frozen live static router at the seal commit; learning arm frozen for the window. Pre-registration filled at [f6-preregistration.md](../docs/specs/f6-preregistration.md); remaining slots (seal commit, parameterHash) bind at seal. Provider smoke re-confirmed on the xhh relay: [dogfood acceptance](../docs/reports/2026-09-04-xhh-dogfood-acceptance.md).
  - 2026-09-04 Week-0 engineering DONE: invocation provenance (`executorClass`) + cache observation (`cacheHit`) landed with loopback-transport tests; `scripts/holdout-seal.mjs` (commitment seal/verify); `scripts/holdout-block.mjs` (clean-room paired-block runner, validated on fake executor); [pre-registration template](../docs/specs/f6-preregistration-template.md) ready to freeze. Remaining before Week 1: owner answers + custodian appointment + 100+15 spec authoring.
  - [x] Provider smoke DONE 2026-08-22: real end-to-end run COMPLETED via openrouter-ox/stealth/ox-alpha (pi's conversation key reused per owner decision; stored in runtime/auth.json + envVar OPENROUTER_OX_API_KEY). Fixes shipped: slashed model ids mis-split in resolveIdentity; providers.json reasoning/compat passthrough; createConfiguredPiExecutor auto-loads state-root providers.json. PI_SMOKE=1 suite green.

## Three-line program (2026-08-18 final)

- [x] Phase A: tracking assessment + supervisor gates ([plan](../docs/superpowers/plans/2026-08-18-phase-a-tracking-supervisor.md)) — verified implemented 2026-08-22 (artifacts + tests existed; plan checkboxes were stale). Gate-apply idempotency, CoT-reader removal, quality×coverage prescore all green.
- [x] Phase B: outcome vector + dual LCB + corrected R1 ([plan](../docs/superpowers/plans/2026-08-18-phase-b-outcome-r1.md)) — verified implemented 2026-08-22 (`posterior.ts` nObsEff/beta-quantile+normal LCB, `r1.ts` cheapest-above-floor + hysteresis + conservative fallback, version-keyed estimates).
- [x] Phase C: offline logit **and** probability-additive attribution; threshold calibration report ([plan](../docs/superpowers/plans/2026-08-18-phase-c-offline-attribution.md)) — implemented 2026-08-22: `offline-types` / `offline-prob-add` / `offline-logit`(IRLS+bootstrap, ridge-stabilized) / `attribution-report` pair / propensity `status: INVALID_ESTIMATE` / `threshold-calibration` / manifest holdout split + `markHoldoutCompromised` / ADR-005 protocol sentence.
- [x] Phase D: proposal-first candidates + CAS ([plan](../docs/superpowers/plans/2026-08-18-phase-d-promotion-cas.md)) — verified implemented 2026-08-22 (`adapt auto` never promotes, single resource boundary, replay cache key, cost-CI block, ledger pointer rebuild, rollback).

See [adaptive-todo.md](adaptive-todo.md) for older M3 leftovers. Do not mark Checkpoint D/F closed from module tests alone.

## Optional M7

- [ ] Review whether consented data justifies external SFT/preference/RL.
- [ ] Keep training infrastructure outside this TypeScript runtime.

## Grok follow-up — trusted execution (2026-09-13)

Original plan: [trusted execution](../docs/superpowers/plans/2026-09-13-grok-trusted-execution.md); original [repair prompt](../docs/superpowers/plans/2026-09-13-grok-review-repair-prompt.md). **2026-09-14 re-review of local full candidate `412230aa6421a126c63dba964e322ae7ebd7b763`: REQUEST CHANGES, but all original regression cases now pass.** Evidence for items below: [re-review](../docs/reports/2026-09-14-grok-repair-rereview.md).

- [x] Earlier G0–G3 merge facts remain verified: PR #37–#41 MERGED, remote main `fe253301`; do not reimplement them (2026-09-13 evidence retained in prior report).
- [x] Original R1/R2/R3/R4 concrete regressions plus staged-delete control rerun unchanged on full candidate: 5 pass / 0 fail / 0 skip (2026-09-14). This closes those exact counterexamples, not all related boundary acceptance.
- [x] Focused 57/57; gate 2767 pass / 0 fail / 18 skip; post-build security probe 26 PASS and Pi probe 4 PASS (2026-09-14). Initial pre-build security probe failed due missing dist; both attempts recorded.
- [x] RR1 (P1) — rename source identity: fixed 2026-09-16 on the local full candidate (`merge-r3r4`, uncommitted): `parsePorcelainZ` preserves rename/copy source; source-swap regression added and RED→GREEN verified (evidence: [2026-09-16 review report](../docs/reports/2026-09-16-whole-repo-review-next-steps.md)). Pending independent re-review on the final head.
- [x] RR2 (P1) — durable run identity: fixed 2026-09-16 on the local full candidate: `assertRunPresent` validates via `EventStore.readAll()` (empty/corrupt/mid-corrupt/identity-mismatch/no-RUN_CREATED rejected, torn tail tolerated); all empty-log fixtures replaced with real initialization; controlled delete/write interleave test added. Pending independent re-review on the final head.
- [x] RR4 (P2) — timeout validation: fixed 2026-09-16 on the local full candidate: `timeoutMs` must be a finite positive safe integer (1..2147483647); 0/negative/NaN/Infinity rejected before spawn; default 60000 preserved. Pending independent re-review on the final head.
- [ ] SCM aligns PR #42 with final full candidate; current OPEN PR head `5357163` includes only R3/R1, not local R2/R4. Local merge name is not remote delivery or owner authorization.
- [ ] Final same-head old+new regressions, gate, post-build probes and independent review; SCM authorized delivery only afterward. Three new review tests currently fail (0 pass / 3 fail / 0 skip).
- [ ] F6 remains NOT READY; no provider/benchmark/holdout/seal or new dispatch in this review. Finish missing G3 evidence without inventing historical outcomes.

## SoL-Pi efficiency — Grok handoff (2026-09-13)

Plan: [initial TASK-20260913-sol-pi-efficiency](../docs/superpowers/plans/2026-09-13-sol-pi-grok-handoff.md). Latest: [delivery status, 2026-09-13](../docs/reports/2026-09-13-sol-efficiency-delivery-status.md).

Live verification at 2026-09-13 08:22 UTC supersedes the earlier owner-reported unpushed status: **PR #36 is MERGED**, head `4804d4c625559b58675a4726bbdd43eeecb78e4c`, remote main `6ee16a3722fda35d9b6098144602f199fb0a7d0f`. Evidence for checked items: [post-merge verification](../docs/reports/2026-09-13-sol-efficiency-delivery-status.md), including query artifacts and exact CI link. This is delivery-fact verification, not blanket acceptance of every policy gate.

- [x] Full tip SHA, accessible local chain and stage-to-scope mapping established (2026-09-13); PR-A/B/HOTFIX/P3/P4/P5 commits and reports listed in the evidence record.
- [x] Reviewed-chain head pushed and PR opened: [PR #36](https://github.com/Xhhemoing/pi-sparkle/pull/36), head `4804d4c625559b58675a4726bbdd43eeecb78e4c` (live GitHub verification 2026-09-13).
- [x] GitHub reports all three hosted checks SUCCESS; delivered head is the previously reported tip, merge parents include it and merge/head trees match (2026-09-13). No fresh local product gate is claimed.
- [x] Merge fact verified: PR #36 merged `2026-09-13T08:19:09Z`; live main `6ee16a3722fda35d9b6098144602f199fb0a7d0f` (2026-09-13 API + ls-remote).
- [ ] SCM/xhh supplies per-stage independent Reviewer PASS artifacts with exact tested SHAs/commands and final independent gate record; GitHub reviews array is empty and PR body gate paste remains unchecked.
- [ ] SCM/xhh links original explicit/standing owner authorization for the exact delivered head; PR body mentions standing auth, but this session does not independently establish its source or confer authorization.
- [ ] Local owner preserves/reconciles existing dirty HOTFIX/workflow changes before syncing main; local HEAD remains `8dd31e9`, and this worktree's previous gate failure is not cleared by remote CI.
- [ ] F6 seal/real-provider holdout, extension/live adaptation/Outcome-supported remain separately gated; merged code and hosted CI are not F-PROD evidence.
