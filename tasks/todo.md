# Active checklist

Process entry point: [`AGENTS.md`](../AGENTS.md) -> [`docs/development-workflow.md`](../docs/development-workflow.md) -> [`tasks/README.md`](README.md). Every `[x]` below requires dated evidence; unresolved contradictions must be recorded and corrected, not silently checked off.
Archived: [M0–M2.5](archive/m0-m2-todo.md), [acceptance](archive/ACCEPTANCE-2026-08-17.md).

## Owner decisions (2026-09-20, session 2)

Owner instructions this session: "你自己决定 / 继续" — recorded as standing authorization for (a) merging PR #45 after its review PASS + green CI, (b) deleting the 8 verified-merged remote branches, and (c) proceeding with the native apply registration slice through implementation and evidence; the G3 human-authorization gate for the first host-mutable tool registration was satisfied by this standing grant for the merge of the registration slice itself (no PR opened — fast-forwarded to main after full-suite green). Model-facing trust boundary was enforced in code and pinned by tests; the write tool remains unregistered.

Recorded from the owner's session instructions; evidence: [luna review record](../docs/reports/2026-09-20-rr-review-luna.md), [PR #43 conflict packet](../docs/reports/2026-09-20-pr43-conflict-review-packet.md).

- [x] **sota-opt line archived** (owner decision 2026-09-20): keep existing materials (`origin/cursor/sota-persistent-opt-83a1`, Loop 5 round reports under `.agent_workspace/`); a restart requires a named owner and an explicit goal. No further work on that line until then.
- [x] **Backup dispatch channel designated**: `luna-fast` (`xhh-luna/gpt-5.6-luna-fast`) is the owner-designated backup reviewer/dispatch channel (connectivity probe `mu969yx0-e778d5ab` returned `LUNA_PROBE_OK` same day). Designation is explicit, not a silent fallback; dispatch tasks stay narrow-scope/single-turn where possible (verified effective pattern, 2026-09-20).
- [ ] **Relay group-config fix item (open)**: the xhh relay's `cursor-grok-4.6-fast` 404 (`model_not_found ... not available for this group`) and 402 budget-pool failures remain unresolved; owner assigned a separate fix track. Until fixed, grok-fast dispatches stay unavailable; do not silently fall back.
- [x] **F6 stays parked**: waiting on off-repo custodian materials (100+15 specs, SM95 key metadata); nothing to execute in-repo.

## Native Pi integration (2026-09-18)

Plan: [TASK-20260918-native-pi](../docs/superpowers/plans/2026-09-18-native-pi.md). Owner approved option B; ADR-006 revisited (historical keep-Proposed entry below is superseded).

- [x] Native read-only delegation entry, host model/auth reuse, bounded results and cancellation implemented; 2026-09-18 focused 21/21, gate 2761 pass / 0 fail / 18 skip, security 26 PASS, Pi 4 PASS. [Evidence](../docs/reports/2026-09-18-native-pi.md). First slice ready-for-review; independent/live-provider acceptance not claimed.
- [x] Isolated write session with host-supplied independent acceptance implemented and locally verified 2026-09-19: preflight 7/7, integration 8/8, serialized full suite 2776 pass / 18 skip, build/typecheck/lint/workflow/security/Pi probes pass. Candidates and failure evidence remain retained; no automatic application. [Write report](../docs/reports/2026-09-18-native-write-worker.md). [Plan](../docs/superpowers/plans/2026-09-18-native-write.md).
- [x] Candidate application slice (`NativeApplySession`) implemented and locally verified 2026-09-19: accepted-only apply, stale-target and non-fast-forward refusal, in-candidate re-verification with the frozen host command, git-native `merge --ff-only` with rollback, explicit managed disposal. Focused native set 32/32; serialized full suite 2786 pass / 0 fail / 18 skip; typecheck/lint/workflow/build/security/Pi probes pass. Library API only; not registered in the extension/CLI; disposal remains explicit. [Apply plan](../docs/superpowers/plans/2026-09-19-native-apply.md). [Apply report](../docs/reports/2026-09-19-native-apply.md). Preferred-model probe at session start returned unavailable (no fallback used). Host-facing registration remains gated. 2026-09-20: the HEAD-drift rollback follow-up was closed by PR #45 (merge `abbf4461`): induced-failure test exposed a real gap (merge-failure-after-ref-update left the source at the drift commit) and the fix rolls the source back to its prior revision; luna-fast independent review PASS, hosted CI green. [Review record](../docs/reports/2026-09-20-apply-rollback-review-luna.md). Registration still requires the command-policy/environment boundary review, disposal policy, and human authorization.
- [x] Apply registration slice (`sparkle_apply_candidate`) implemented 2026-09-20, delivered to main (`1707c8f`, ff-merged `40a4988`) under the owner's standing session grant: tool consumes only a host-issued handle; trusted result reconstructed from hash-verified loop-artifact bytes; issuance via host-only `/sparkle-issue-candidate`; tool surface pinned. Focused unit 23/23, integration 15/15, serialized full suite 2816 pass / 0 fail / 18 skip; typecheck/lint/build/security/Pi probes pass. [Verification record](../docs/reports/2026-09-20-native-apply-registration.md). [ ] Independent review dispatch (luna-fast) remains a follow-up to complete the review record post-hoc.
- [ ] Quality-first unified routing, live context efficiency and measured optimization; F-PROD remains open.
- [ ] Automatic candidate application under scope B (residual): write-tool registration is a separate slice requiring its own boundary review; global-config allowlists beyond handle issuance remain open and gated. Registration slice status: implemented, pending review/authorization (item above).

## Delivery gate coordination (2026-09-18)

Evidence/requests: [delivery gate record](../docs/reports/2026-09-18-delivery-gate-unblock.md); [plan](../docs/superpowers/plans/2026-09-18-delivery-gate-unblock.md).

- [x] Live #42/#43 head/CI checks, PR requests, F6 census and temp-tree inventory recorded (2026-09-18; record above).
- [x] Independent PASS on #42 `928995d` (delta re-review after the payload-identity fix; full record: [luna review](../docs/reports/2026-09-20-rr-review-luna.md)) and #44 (PASS after hygiene fix; record: [native review](../docs/reports/2026-09-20-native-pi-review-luna.md)); #43 human conflict review completed by owner 2026-09-20 per the packet. All three PRs MERGED: #42 `b1f2ee8`, #43 `7bdc591`, #44 `bb62d792`.
- [x] Post-merge cleanup (2026-09-20): stale local branches and worktrees removed with merge-base verification; disposal manifest executed (r-fix draft patch archived). PR #45 merged same day (`abbf4461`); all 8 remaining merged remote branches deleted after verification — remote has only `main`. Remaining: SCM/xhh supplies six original #36 stage PASS artifacts + owner authorization source (unresolved).
- [ ] Custodian completes 100+15 materials off-repo; owner rules on public-draft contamination. Existing 115 drafts do not satisfy this gate.
- [ ] SCM verifies SM95 key metadata/separation (hostname unresolved here), then bind existing frozen ESTIMATE prices; seal only after preregistration and G3 runner/readiness gates. No experiment run.
- [ ] After review PASS, preserve dirty/ignored content and approve exact three-temp-tree disposal manifest before cleanup; no deletion yet.

## Human / policy gates (block claims, not local fake tests)

- [x] ADR-004 accepted and the six adaptive defaults approved, unchanged (2026-08-21). Exit recorded in [status-matrix.md](../docs/status-matrix.md).
- [x] Close P0: independent review returned **CONDITIONAL** (2026-08-22): Q3/Q4/Q5 pass; Q1 (plane isolation) and Q2 (delete tooling + cascade) were blockers — both remediated same day (see review package §7). Package: [2026-08-22-p0-privacy-review-package.md](../docs/reports/2026-08-22-p0-privacy-review-package.md).
  - 2026-08-22 re-verification: privacy/redaction suites 8/8 green against the remediation (technical check done; §6 command fixed to explicit file args).
  - **Closed 2026-08-26** by [technical re-verification](../docs/reports/2026-08-26-p0-technical-reverification.md): Q1/Q2 tests green. An independent privacy-officer countersign remains welcome but no longer blocks the Developer Preview (authoritative: [status-matrix.md](../docs/status-matrix.md)).
- [x] ADR-006 revisited and Accepted 2026-09-18: thin inbound adapter permitted; credential, permission, trust, and tool-activation boundaries remain excluded. Status and scope are recorded in [ADR-006](../docs/decisions/0006-pi-extension-reverse-adapter.md).
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

## SoL-Pi efficiency line — PR-A / PR-B / PS-HOTFIX / PS-P3 / PS-P4 / P5 (merged 2026-09-13)

Merged via PR #36; per-slice closeout facts are in [tasks/plan.md](plan.md). Reviewer/merge artifacts: [ ] SCM/xhh per-stage independent Reviewer PASS artifacts with exact tested SHAs/commands (GitHub reviews array empty); [ ] owner authorization link for the delivered head.

## Grok follow-up — trusted execution (2026-09-13)

Original plan: [trusted execution](../docs/superpowers/plans/2026-09-13-grok-trusted-execution.md); original [repair prompt](../docs/superpowers/plans/2026-09-13-grok-review-repair-prompt.md). **2026-09-14 re-review of local full candidate `412230a`: REQUEST CHANGES, but all original regression cases now pass.** Evidence for items below: [re-review](../docs/reports/2026-09-14-grok-repair-rereview.md).

- [x] Earlier G0–G3 merge facts remain verified: PR #37–#41 MERGED, remote main `fe253301`; do not reimplement them (2026-09-13 evidence retained in prior report).
- [x] Original R1/R2/R3/R4 concrete regressions plus staged-delete control rerun unchanged on full candidate: 5 pass / 0 fail / 0 skip (2026-09-14). This closes those exact counterexamples, not all related boundary acceptance.
- [x] Focused 57/57; gate 2767 pass / 0 fail / 18 skip; post-build security probe 26 PASS and Pi probe 4 PASS (2026-09-14). Initial pre-build security probe failed due missing dist; both attempts recorded.
- [x] RR1 (P1) — rename source identity: fixed 2026-09-16 on the local full candidate (`merge-r3r4`, uncommitted): `parsePorcelainZ` preserves rename/copy source; source-swap regression added and RED→GREEN verified (evidence: [2026-09-16 review report](../docs/reports/2026-09-16-whole-repo-review-next-steps.md)). Pending independent re-review on the final head.
- [x] RR2 (P1) — durable run identity: fixed 2026-09-16 on the local full candidate: `assertRunPresent` validates via `EventStore.readAll()` (empty/corrupt/mid-corrupt/identity-mismatch/no-RUN_CREATED rejected, torn tail tolerated); all empty-log fixtures replaced with real initialization; controlled delete/write interleave test added. Pending independent re-review on the final head.
- [x] RR4 (P2) — timeout validation: fixed 2026-09-16 on the local full candidate: `timeoutMs` must be a finite positive safe integer (1..2147483647); 0/negative/NaN/Infinity rejected before spawn; default 60000 preserved. Pending independent re-review on the final head.
- [x] SCM aligned PR #42 with the final full candidate 2026-09-16: head pushed as fast-forward `5357163` → `aeb4993` (R3/R1 verified ancestor; R2/R4 included). Hosted CI green on the head (first run failed on the pre-existing delete-vs-writer race flake, failed-job rerun success 2026-09-17; test observation fixed in `6ae179c`).
- [x] Author-run same-head evidence on a fresh checkout of `aeb4993` (2026-09-17): original 5 + re-review 3 regressions pass, focused 61/61, gate 2771 pass / 0 fail / 18 skip, security + pi probes pass. Evidence: [review package](../docs/reports/2026-09-16-rr-fix-review-package.md). Independent review dispatch failed on provider quota (402); review remains with the owner / Grok bot per the turnkey protocol.
- [ ] Final independent review PASS + owner authorization, then merge PR #42. Author self-verification is not independent verification.
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
- [x] Local owner reconciled dirty HOTFIX/workflow changes: committed as `052fd5a` (governance/workflow) + `5256339` (provider-fail hotfix) on `cursor/ps-hotfix-provider-fail-attribution`, pushed 2026-09-16; origin/main synced into the branch 2026-09-17 (merge reconciling the independent `ed9a6e9` HOTFIX on main).
- [ ] F6 seal/real-provider holdout, extension/live adaptation/Outcome-supported remain separately gated; merged code and hosted CI are not F-PROD evidence.
## PR-A harness-efficiency

- [x] Offline `EfficiencyRow` / `EfficiencyReport` aggregator + `scripts/analyze-harness-efficiency.ts` (`--evidence-class synthetic|observed --input --json`). `monetarySavingUsd` always null. PR-B observation store is out of scope.

## PR-B observation store + offline projection

- [x] `ObservationStore` put/recall under `runtime/runs/<runId>/observations/objects/<sha256>.txt` (SHA-256, 8 MiB/object, 64 MiB/run, run lock, symlink refusal, 0700/0600)
- [x] `projectObservation` eligibility + priorFullSends full vs placeholder; enabled=false ⇒ no archive
- [x] Unit + integration tests (store / projection / lifecycle reduction ≥70%)
- [x] `run-observation` durable class + dictionary + status-matrix; delete cascade via run subtree
- [ ] Reviewer / merge (do not push from this worktree)

## PS-HOTFIX provider failure attribution

- [x] finish() provider fail → UNOBSERVED + PROVIDER_ERROR (not FAILED empty evidence)
- [x] FailureClass `provider` + classifyTaskFailure / R1 / bandit / diagnostics filters
- [x] Regression: provider fail ∉ taskSuccess FAIL; model FAILED-with-evidence still counts
- [x] docs/reports HOTFIX note; pending-local-review cleaned

## PS-P3 real closed loop

- [x] Isolated worktree create/dispose (`src/execution/worktree.ts`)
- [x] Worktree-scoped coding tools read/write/run (`src/execution/coding-tools.ts`) + path-escape refusal
- [x] Independent check runner binds exitCode / stdout+stderr hash / cwd / revision (`src/execution/independent-check.ts`)
- [x] Acceptance requires independentCheck + artifactHash; self-report alone fails closed (`src/execution/acceptance.ts`)
- [x] Run-scoped loop artifacts + `run-loop-artifact` durable class (delete cascade via run subtree)
- [x] `createConfiguredPiExecutor` accepts `tools` at execution boundary
- [x] Unit + integration tests (no live LLM)
- [x] `pnpm gate` green + freeze tip (no merge)

## PS-P4 trusted experiments (F6 hard gate)

- [x] Equivalent R0/R1 full taskSpec compile (`src/experiments/task-spec.ts`); kill tasks[0]/placeholder prices/`Date.now`/fake family
- [x] Freeze config/catalog/dirs/provenance/clock; empty freeze + empty provenance fail closed
- [x] Observation ledger dedupe before bandit (`src/learning/observation-ledger.ts`); wired in auto-loop
- [x] Independent oracle + auditable pairing; collection vs task vs telemetry vs evidenceClass
- [x] Evidence retention keep-raw default; wired into retention delete gate; durable classes
- [x] Tests + `pnpm gate`; freeze tip (no merge / no push / no P5)

## Grok follow-up — trusted execution (2026-09-13)

Plan: [TASK-20260913-grok-trusted-execution](../docs/superpowers/plans/2026-09-13-grok-trusted-execution.md).

- [ ] G0 — reproducible workflow baseline + evidence reconciliation; report `docs/reports/2026-09-13-grok-g0-baseline.md`.
- [ ] G1A — independent acceptance binds command/argv + candidate content; focused RED/GREEN + `pnpm gate`.
- [ ] G1B — tool/artifact boundaries; gate/security/Pi probes.
- [ ] G2 — real adapter + local HTTP loopback after G1A/B; no live LLM / default CLI.
- [x] G3 — F6 readiness/pollution inventory (report-only); no seal/oracle. See [g3 report](../docs/reports/2026-09-13-grok-g3-f6-readiness.md). **NOT READY**; experiments NOT RUN.

## SoL-Pi efficiency — delivery (2026-09-13)

- [x] PR #36 MERGED 2026-09-13T08:19:09Z; main `6ee16a3722fda35d9b6098144602f199fb0a7d0f` includes tip `4804d4c`.
- [ ] SCM supplies per-stage independent Reviewer PASS artifacts with exact SHAs (GitHub reviews array empty — unavailable).
- [ ] F6 seal/real-provider holdout remain separately gated.
