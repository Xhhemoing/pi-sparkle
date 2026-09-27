# Active checklist

Process entry point: [`AGENTS.md`](../AGENTS.md) -> [`docs/development-workflow.md`](../docs/development-workflow.md) -> [`tasks/README.md`](README.md). Every `[x]` below requires dated evidence; unresolved contradictions must be recorded and corrected, not silently checked off.

## Reliability optimization execution (2026-09-27)

- [ ] User authorized implementation and multi-subagent execution on 2026-09-27. O01/O04, O02 setup, bounded O05, O07, O08a and O11 empty-waiver slices have focused verification and independent source review; integrated gate and remaining acceptance work stay open. O07 heap/latency measurement is NOT RUN. O09a/b is owned by the coordinated `offline-determinism-o09` worktree. [Execution and verification](../docs/reports/2026-09-27-reliability-implementation.md).

- [ ] Complete authorized O01–O11 slices only under the scopes/dependencies in the [consolidated plan](../docs/superpowers/plans/2026-09-27-reliability-optimization.md); O12 remains deferred. Earlier planning-only evidence is retained in the review reconciliation report, not treated as the current implementation state.
- [ ] First delivery: O01 protects concurrent user bytes/index/refs during apply and rejects invalid candidate ownership before verification. O02/O03 then cover cancellation, setup cleanup and recoverable ownership; independent O04/O05/O11 repairs may proceed in disjoint files.
- [ ] Preserve the corrected R2/R7 implementations; add missing context/cross-platform coverage rather than reintroducing hashes or duplicating host model/auth machinery. [Current evidence: 32 focused PASS, 2 fuzz PASS, duplicate-pair defect reproduced](../docs/reports/2026-09-27-review-reconciliation.md).
- [ ] Full-suite timeout diagnosis and future implementation gates remain open. B0 is accepted per its dated verification; D1 task review, S0-min, L1/L2/final review, R10/R11 and F6 retain their existing status and are not closed by this plan.

## Controlled improvement planning (2026-09-25)

- [ ] Delivery authorization 2026-09-27: after the remaining O01–O11 phase meets its scoped checks/reviews, root alone coordinates later integration/merge, recoverable archival of delivered inactive managed worktrees, and reviewed publication of non-sensitive project data. Preserve unfinished/in-use worktrees (including coordinated O09/O08b), ignored data before archive, credentials/private sessions and all global user directories. The first interim merge/push is recorded below; no archival or remaining-phase merge is claimed here. [Delivery plan](../docs/superpowers/plans/2026-09-27-reliability-optimization.md#2026-09-27-delivery-authorization-and-coordinated-ownership).
- [x] Urgent interim GitHub sync: the 37-file reviewed first batch passed local gate 3011/0/18 and built probes, then commit `e2edc68c` was locally fast-forwarded and verified as remote `main` by `git ls-remote` (2026-09-27). O09a review correction and O09b/O08b remain outside this first sync; the rest of O01–O11 stays open. Hosted CI and later evidence publication are separate. [Exact execution record](../docs/reports/2026-09-27-reliability-implementation.md#first-github-synchronization--verified-result).

- [ ] **Corrected implementation is in progress:** `9b9fbeec` was independently reviewed as **REQUEST CHANGES**; corrected revision `7d7cd59b` then received independent **PASS** with 90 focused tests and no findings. The author-run full gate is 2879 pass / 0 fail / 18 skip. This current-slice review is not B0/D1 task acceptance, S0-min approval, or the post-L2 final review. [Implementation](../docs/reports/2026-09-25-controlled-improvement-implementation.md) · [review](../docs/reports/2026-09-25-integrated-review.md) · [Stage 0 owner package](../docs/reports/2026-09-25-stage0-owner-freeze-package.md).
- [ ] **Corrected execution sequence:** `B0 → (D1 review || S0-min freeze) → L1 → L2 → final review`. The read-only evaluator-manifest candidate is pre-S0 evidence and does not freeze the required host-owned outcome DTO, trusted source/binding rules, failure attribution, or canonicalizer. D1 reuses EventStore/inspection and adds no N1/N3 store. CI-1c, E4 activation, and formal promotion remain deferred.
- [ ] **Independent gates remain separate:** no global lifecycle long lock is authorized by this plan; canonical JSON must reuse the canonicalizer accepted by S0-min; R10/R11 apply/write review and F6 governance/holdout remain open or parked independently. Author-run full-gate success does not substitute for the required B0, D1, S0-min, or final independent verdicts.

## SHA-256 removal gate (2026-09-21, corrected)

- [x] **Removal/implementation decision accepted:** [ADR-008](../docs/decisions/0008-remove-sha256.md) records removal of all first-party SHA-256 and runtime integrity checks. No replacement cryptographic hash selected; opaque random versioned locators and exact byte equality/dedupe are the contract, without cryptographic tamper guarantee.
- [ ] **Separate gates remain open:** migration execution, live-provider runs, production apply/rollout, holdout/F6, and independent review. Final sweep 2026-09-22 closed the author-run preview/release, full gate, security, Pi compatibility, workflow, and targeted-doc checks; it did not close human, independent, live-provider, pilot, apply, or holdout gates.
- [x] **Evidence-first census and bounded design recorded:** [removal plan](../docs/superpowers/plans/2026-09-21-remove-sha256.md) and [report](../docs/reports/2026-09-21-remove-sha256.md); 219 files, 836 lines, 65 computations, 778 persisted/wire references, 45 validators, 1,418 identity/cache/dedupe matches.
- [x] **Implementation:** dependency-independent `migrate-legacy` comparison slice removes SHA-256 equality and uses exact bytes; focused tests, typecheck, workflow check, and diff check passed. Persisted wire schemas unchanged. Evidence: [removal report](../docs/reports/2026-09-21-remove-sha256.md).
- [x] **G1–G4 implemented, G5 gate green (2026-09-22):** all runtime groups delivered on the uncommitted worktree — G1 opaque `obs_v2_`/`art_v2_` identity with legacy refusal, G2 execution/evaluator/apply rebinding (bounded text + byte-length artifact binding, opaque apply handles), G3 canonical-key freeze/spec/ledger identity plus non-crypto holdout seal/custody/inventory scripts, G4 dictionary/status/skill-reference corrections, and the last SHA surface (`log-skill-route.mjs` → opaque random `task_v2_` id, RED→GREEN). G5 scan: zero active SHA-256 computations in runtime surfaces; only legacy-refusal detectors remain. Focused G1 35 / G2 52 / G3 62 / skill-route 6 pass; `pnpm gate` 2842 pass / 0 fail / 18 skip; typecheck/lint/workflow/diff-check/security 26 PASS/Pi 4 PASS green. Evidence: [removal report](../docs/reports/2026-09-21-remove-sha256.md) Session 5. Author-run; independent review, migration execution, live-provider, production apply/rollout, and holdout/F6 remain separate open gates.
Archived: [M0–M2.5](archive/m0-m2-todo.md), [acceptance](archive/ACCEPTANCE-2026-08-17.md).

## Owner decisions (2026-09-20, session 2)

Owner instructions this session: "你自己决定 / 继续" — recorded as standing authorization for (a) merging PR #45 after its review PASS + green CI, (b) deleting the 8 verified-merged remote branches, and (c) proceeding with the native apply registration slice through implementation and evidence; the G3 human-authorization gate for the first host-mutable tool registration was satisfied by this standing grant for the merge of the registration slice itself (no PR opened — fast-forwarded to main after full-suite green). Model-facing trust boundary was enforced in code and pinned by tests; the write tool remains unregistered.

Recorded from the owner's session instructions; evidence: [luna review record](../docs/reports/2026-09-20-rr-review-luna.md), [PR #43 conflict packet](../docs/reports/2026-09-20-pr43-conflict-review-packet.md).

- [x] **sota-opt line archived** (owner decision 2026-09-20): keep existing materials (`origin/cursor/sota-persistent-opt-83a1`, Loop 5 round reports under `.agent_workspace/`); a restart requires a named owner and an explicit goal. No further work on that line until then.
- [x] **Backup dispatch channel designated**: `luna-fast` (`xhh-luna/gpt-5.6-luna-fast`) is the owner-designated backup reviewer/dispatch channel (connectivity probe `mu969yx0-e778d5ab` returned `LUNA_PROBE_OK` same day). Designation is explicit, not a silent fallback; dispatch tasks stay narrow-scope/single-turn where possible (verified effective pattern, 2026-09-20).
- [ ] **Relay group-config/outage item (observed 2026-09-20 only):** direct probes then reported cursor-upstream `ERROR_NOT_LOGGED_IN` for the sampled fast/non-fast models; `gpt-5.6-sol-fast` also hit a group allowlist, while `/v1/models` returned 200. This dated evidence established failed dispatches at that time, not universal current unavailability or recovery. Keep the owner relay-fix track open; no silent fallback. Evidence: [dispatch outage record](../docs/reports/2026-09-20-luna-dispatch-outage.md).
- [x] **F6 stays parked** (owner decision 2026-09-20): waiting on off-repo custodian materials (100+15 specs, SM95 key metadata); nothing to execute in-repo.
- [ ] **Next-phase documentation reconciliation (2026-09-21):** [plan](../docs/superpowers/plans/2026-09-21-evidence-first-reconciliation.md). Three expert reports returned: **2 REQUEST CHANGES, 1 APPROVE WITH CHANGES**; the fourth repository-consistency review was not run because of concurrency. The successful documentation implementation dispatch for this correction is additional evidence that current universal relay unavailability is unestablished, not evidence of relay recovery. The Stage 0 correction is author-verified in [report](../docs/reports/2026-09-22-stage0-boundary-correction.md), but fresh low-concurrency review dispatches on 2026-09-22 failed and yielded `UNOBSERVED`, including follow-up `run_27637fa2-3e86-47c9-bb6c-811734186ee4` (`xhh-luna/gpt-5.6-luna-fast`, reviewer+scout, `no actionable model-project issue`); no independent verdict, relay recovery, or Stage 0 approval is claimed. This slice does not approve experimental/production execution, resolve the outage, or close any human gate.

## Native Pi integration (2026-09-18)

Plan: [TASK-20260918-native-pi](../docs/superpowers/plans/2026-09-18-native-pi.md). Owner approved option B; ADR-006 revisited (historical keep-Proposed entry below is superseded).

- [x] Native read-only delegation entry, host model/auth reuse, bounded results and cancellation implemented; 2026-09-18 focused 21/21, gate 2761 pass / 0 fail / 18 skip, security 26 PASS, Pi 4 PASS. [Evidence](../docs/reports/2026-09-18-native-pi.md). First slice ready-for-review; independent/live-provider acceptance not claimed.
- [x] Isolated write session with host-supplied independent acceptance implemented and locally verified 2026-09-19: preflight 7/7, integration 8/8, serialized full suite 2776 pass / 18 skip, build/typecheck/lint/workflow/security/Pi probes pass. Candidates and failure evidence remain retained; no automatic application. [Write report](../docs/reports/2026-09-18-native-write-worker.md). [Plan](../docs/superpowers/plans/2026-09-18-native-write.md).
- [x] Candidate application slice (`NativeApplySession`) implemented and locally verified 2026-09-19: accepted-only apply, stale-target and non-fast-forward refusal, in-candidate re-verification with the frozen host command, git-native `merge --ff-only` with rollback, explicit managed disposal. Focused native set 32/32; serialized full suite 2786 pass / 0 fail / 18 skip; typecheck/lint/workflow/build/security/Pi probes pass. Library API only; disposal remains explicit. Host-facing `sparkle_apply_candidate` registration was added 2026-09-20 as a separate handle-only surface; it is wired but not production-authorized. [Apply plan](../docs/superpowers/plans/2026-09-19-native-apply.md). [Apply report](../docs/reports/2026-09-19-native-apply.md). Preferred-model probe at session start returned unavailable (no fallback used). The HEAD-drift rollback follow-up closed via PR #45 (merge `abbf4461`): induced-failure test exposed a real gap and the fix rolls the source back to its prior revision; luna-fast independent review PASS, hosted CI green. Existing registration remains subject to the R10/R11 evaluator/environment boundary review, disposal policy, and owner authorization; worker write registration and automatic write-to-apply chaining remain absent. [Registration verification](../docs/reports/2026-09-20-native-apply-registration.md). [Review scope](../docs/superpowers/plans/2026-09-21-evaluator-apply-boundary.md).
- [x] Apply registration slice (`sparkle_apply_candidate`) implemented 2026-09-20, delivered to main (`1707c8f`, ff-merged `40a4988`) under the owner's standing session grant: tool consumes only a host-issued handle; trusted result reconstructed from opaque-id addressed, schema/byte-length checked loop-artifact bytes; issuance via host-only `/sparkle-issue-candidate`; no cryptographic tamper guarantee is claimed; tool surface pinned. Focused unit 23/23, integration 15/15, serialized full suite 2816 pass / 0 fail / 18 skip; typecheck/lint/build/security/Pi probes pass. [Verification record](../docs/reports/2026-09-20-native-apply-registration.md). [ ] Independent review dispatch failed 3× before start — relay-wide cursor-upstream outage (`ERROR_NOT_LOGGED_IN` on all fast/non-fast models; gateway /models OK; evidence: [dispatch outage record](../docs/reports/2026-09-20-luna-dispatch-outage.md)). Re-dispatch on recovery (still down at last probe 2026-09-20); no silent fallback. Batch with the delegate-routing re-dispatch.
- [ ] Quality-first unified routing — the corrected multi-model current slice received independent **PASS** at `7d7cd59b` after the earlier REQUEST CHANGES. Capability snapshots omit host headers, dispatch reuses the unchanged host model, result text names actual assigned models, corrupt learned policy fails closed, and canonical sensitive targets do not archive. Author gate: 2879 / 0 / 18; independent focused set: 90 / 0. Live-provider execution, Stage 0, pilot, production apply, F-PROD, and Outcome-supported gates remain open. [Initial record](../docs/reports/2026-09-20-native-delegate-routing.md). [Review](../docs/reports/2026-09-25-integrated-review.md).
- [x] Context efficiency wiring — `TASK-20260920-native-observation-projection` delivered 2026-09-20 on `feat/native-observation-projection`: PR-B observation library now live in native workers (default off; opt-in `contextEfficiency` on `sparkle_delegate`). First two sends of a >10KiB read are full, then a ≤2KiB recallable placeholder; `sparkle_recall_observation` pages opaque-id addressed, exact-byte checked same-run archives; no cryptographic tamper guarantee is claimed. Found+fixed a real library bug: the observation store locked on the run lifecycle lock, so live archives always timed out silently — replaced with a dedicated `observationLockPath`. Focused 150+43+28+232+15, serialized full suite 2826/0/18, probes green. [Verification record](../docs/reports/2026-09-20-native-observation-projection.md). [ ] Independent review pending (batched re-dispatch). Measured token deltas on real delegations still open.
- [ ] **Production authorization / future worker-write boundary (residual):** distinguish the already-wired host-facing `sparkle_apply_candidate` (present, handle-only, non-production-authorized pending R10/R11 review + owner approval) from unregistered `NativeWriteSession` worker-write tools and automatic write-to-apply chaining (both absent). Global-config allowlists beyond handle issuance remain open and gated. The existing apply registration is not being reintroduced; the next slice hardens/reviews/authorizes or refuses that surface.

## External review disposition (2026-09-21)

Owner-provided external review of the 2026-09-21 project status brief processed against the tree: [disposition record](../docs/reports/2026-09-21-external-review-disposition.md) (author-run verification; independent verification still relay-blocked).

- [x] Review verified point-by-point against the pre-ADR-008 code state: projection is tool-return-layer only (no history rewrite / no preserved-thinking risk); recall is snapshot-based and never re-projected; run isolation holds by construction; learned routing reads the promoted CAS-locked registry snapshot with exact canonical-byte checks; the current ADR-008 successor contract makes no cryptographic tamper claim. 18 skips explained (win32 POSIX-permission/atomic/symlink skips — CI runs the ubuntu+windows matrix — plus opt-in live smoke).
- [x] Genuine gaps recorded for the pending independent reviews: apply re-verification runs the frozen command **inside the candidate** (acceptance-definition bytes not bound — reviewer's sharpest finding); handle does not bind evaluator/config digest or issue-time candidate-tree hash. Added to the apply-registration review scope (disposition R10/R11) alongside crash-reconciliation windows.
- [ ] Hardening items are tracked in the separate projection child plan before any live pilot: ADR-008-compatible exact-byte observation identity for the send counter, typed/fail-closed projectability, marker-spoof pin, `isError` forwarding, snapshot-after-mutation pin, cumulative recall budget, delete/resume semantics pin, payload-prefix pinning, and mechanism/economic/outcome telemetry. Current wired baseline remains default-off and locally verified; these are pending hardening, not completed claims. Stage 0 boundary vocabulary was corrected author-run in [report](../reports/2026-09-22-stage0-boundary-correction.md), but Stage 0 is not frozen.
- [ ] Review's proposed execution order remains unaccepted: **Stage 0 evaluator/apply boundary design and freeze → projection hardening and mechanism/economic telemetry → read-only evaluator manifest freeze → owner budget/data approval and exploratory A/B/C pilot**. F6 remains a separate parked governance handoff; no item authorizes execution.
- [ ] **Expert review disposition remains open:** three reports returned (2 **REQUEST CHANGES**, 1 **APPROVE WITH CHANGES**); the fourth repository-consistency review was **not run due concurrency**. Amended docs require a fresh low-concurrency review. Additional dispatches `run_be4facfd-142d-4e0f-892b-d6f9c21d2d17` and `run_0735283f-00e9-44cc-97f4-0550da23062b` both failed with `no actionable model-project issue`; acceptance remains `UNOBSERVED`. No relay recovery or review PASS is claimed. Owner items remain: approved review path, pilot budget/data-transfer scope, exact preregistration thresholds, F6 governance handoff, and product-positioning decision.

## Evidence-first execution order (proposed; all gates open)

The checklist follows the umbrella dependency order after an approved review-channel decision:

- [ ] **Stage 0 evaluator/apply boundary design and owner/reviewer freeze** — [boundary plan](../docs/superpowers/plans/2026-09-21-evaluator-apply-boundary.md); design-only, no writes or apply authorization.
- [ ] **Projection hardening and mechanism/economic telemetry** — [projection plan](../docs/superpowers/plans/2026-09-21-projection-hardening.md). Author-run engineering slice on 2026-09-22: exact-byte observation identity, fail-closed projectability metadata, cumulative recall budget, and mechanism counters. Focused native/projection/experiment/live-isolation tests 35 pass / 0 fail; `tsc -p tsconfig.json --noEmit` pass. Follow-up RED→GREEN also covers no-archive ineligible results, storage fallback, invalid recall budgets, disabled-routing observation refusal, opaque task/repository references, malformed/unknown nested manifest and repository-revision fields, optional modelVersion validation, canonical JSON validation, and unsupported routed-model refusal. Latest full gate: 2858 pass / 0 fail / 18 skip; `pnpm prerelease` also passed. Default remains off. This does not close Stage 0, authorize a provider run, or claim the full telemetry/economic acceptance set. [Record](../docs/reports/2026-09-22-projection-and-readonly-manifest.md).
- [ ] **Read-only evaluator manifest freeze** — [freeze plan](../docs/superpowers/plans/2026-09-21-readonly-evaluator-freeze.md). Author-run validator on 2026-09-22 checks opaque locators, the A/B/C routing tuple, evaluator mutation refusal, and `INVALID_COLLECTION` ledger rows. It is not a frozen manifest and cannot authorize a pilot. [Record](../docs/reports/2026-09-22-projection-and-readonly-manifest.md).
- [ ] **Exploratory A/B/C pilot** — [pilot preregistration](../docs/reports/2026-09-21-ab-c-pilot-preregistration.md); requires the prior freezes plus owner budget/data approval, and cannot establish recovery, non-inferiority, F6 closure, or broad Outcome-supported benefit.

## Delivery gate coordination — historical evidence (closed 2026-09-20)

- [x] **All three delivery PRs merged on 2026-09-20:** #42 (`b1f2ee8`; independent review by luna-fast found the RUN_CREATED payload identity P1, fixed in `928995d`, delta PASS), #43 (`7bdc591`; owner-completed human conflict review per the packet), #44 (`bb62d792`; native Pi integration, independent review PASS after process/hygiene fixes). Post-merge cleanup 2026-09-20: 18 merged local branches deleted (merge-base verified), 19 worktrees removed (r-fix dirty draft archived at `.agent_workspace/archived/r-fix-draft-5357163-2026-09-20.patch`), review worktrees disposed. **PR #45 (`fix/apply-head-drift-rollback`) merged 2026-09-20 as `abbf4461`** with owner authorization given in session; luna-fast review PASS and hosted CI green preceded the merge. Same-day remote cleanup: the 8 remaining merged remote branches (`cursor/*`, `grok/trusted-execution-g*`, `sota-persistent-opt-83a1`) deleted after merge-base verification — remote now has only `main`. The former pending wording is historical, not current work.

### Superseded pre-reconciliation record (2026-09-18; retained for provenance)

The following snapshot is retained as dated evidence; its open-PR, pending-disposal, and pre-merge statuses were superseded by the 2026-09-20 merge record above:

- [x] Live #42/#43 head/CI checks, PR requests, F6 census, and temp-tree inventory recorded (2026-09-18; [delivery gate record](../docs/reports/2026-09-18-delivery-gate-unblock.md)).
- [x] Independent PASS on #42 `928995d` (delta re-review; [luna review](../docs/reports/2026-09-20-rr-review-luna.md)) and #44 (PASS after hygiene fix; [native review](../docs/reports/2026-09-20-native-pi-review-luna.md)); #43 human conflict review was completed by the owner 2026-09-20 per the [packet](../docs/reports/2026-09-20-pr43-conflict-review-packet.md). The later merge hashes remain `b1f2ee8`, `7bdc591`, and `bb62d792`.
- [x] Post-merge cleanup was recorded 2026-09-20: stale local branches/worktrees removed with merge-base verification, the disposal manifest executed, PR #45 merged as `abbf4461`, and all 8 remaining merged remote branches deleted after verification. The earlier record preserved three dirty temp trees pending PASS and an approved disposal manifest; it did not authorize new deletion.
- [ ] Custodian completes 100+15 materials off-repo; owner rules on public-draft contamination. Existing 115 drafts did not satisfy that gate.
- [ ] SCM verifies SM95 key metadata/separation, binds the existing ESTIMATE prices, and seals only after preregistration and G3 runner/readiness gates. No experiment run was claimed.
- [ ] After review PASS, preserve dirty/ignored content and approve the exact three-temp-tree disposal manifest before cleanup; no deletion was authorized by that snapshot.
- [x] Progress 2026-09-20: PR #42 independent review executed on `aeb4993`; it returned REQUEST CHANGES on exactly one P1 (RUN_CREATED payload identity gap in `assertRunPresent`); fix `928995d` implemented RED→GREEN and delta re-review PASS. Owner authorized push; the recorded remote head was `928995d` before merge. [Review record](../docs/reports/2026-09-20-rr-review-luna.md).
- [ ] SCM/xhh’s original PR #36 per-stage evidence request remains unresolved.
- [ ] F6 custody, SM95 metadata, pricing bind, runner readiness, and seal remain open; no experiment run or F6 closure follows from delivery merges.
- [ ] Independent review re-dispatch for the 2026-09-20 registration/routing/projection slices remains open; the 2026-09-20 outage evidence is time-scoped and does not establish universal current unavailability. No silent fallback or outage-fixed claim.
- [ ] No deletion or cleanup is performed by this documentation slice; all pre-existing dirty/untracked content is preserved.

Evidence: [delivery gate record](../docs/reports/2026-09-18-delivery-gate-unblock.md), [#42 review](../docs/reports/2026-09-20-rr-review-luna.md), [#43 conflict packet](../docs/reports/2026-09-20-pr43-conflict-review-packet.md), [native review](../docs/reports/2026-09-20-native-pi-review-luna.md), [registration verification](../docs/reports/2026-09-20-native-apply-registration.md), [outage record](../docs/reports/2026-09-20-luna-dispatch-outage.md).

## Human / policy gates (block claims, not local fake tests)

- [x] Pi pin bump 0.85.1 → 0.86.1 (2026-09-20, `3db30b5` + `3f05b82`): type-surface diff reviewed (transcript-context `SystemMessage.toolsAdded`, `JsonObject` tool args, `JsonValue` details default); adapter product code unchanged; one probe adapted (`report-task-result` reads the leading system message); serialized full suite 2816/0/18; `pi-compat --online` `current`; security/Pi probes green. [Playbook](../docs/how-to-adapt-to-pi.md) updated with 0.86 behavioral notes; status row updated.
- [ ] Pi self-review follow-up (2026-09-22): live `pnpm cli pi-compat --online` and `node scripts/pi-latest-check.mjs` report pinned agent-core/ai `0.86.1` behind latest `0.87.0`; `pi-coding-agent` is reported unpinned. Keep the known-tested `0.86.1` pin until a separate 0.87 adaptation plan, type-surface review, focused tests, full gate, security/Pi probes, and independent review are complete. Doctor also reports historical undeclared dispatch names; do not add profiles merely to silence that finding. [Self-review report](../docs/reports/2026-09-22-pi-self-review.md).

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

Merged via PR #36; per-slice closeout facts are historical evidence in [tasks/plan.md](plan.md). The unresolved SCM/xhh evidence request and owner-authorization provenance remain open historical records; they do not reopen the merged delivery or authorize new work.

## Grok follow-up — superseded historical evidence (2026-09-13–17)

Original plan: [trusted execution](../docs/superpowers/plans/2026-09-13-grok-trusted-execution.md); original [repair prompt](../docs/superpowers/plans/2026-09-13-grok-review-repair-prompt.md). The G0–G3 checklist below is retained for provenance only; its pre-merge, pending-disposal, and pending-review wording is superseded by the dated 2026-09-20 delivery reconciliation above. Do not interpret it as current work or phase acceptance.

- [ ] G0 — reproducible workflow baseline + evidence reconciliation; report `docs/reports/2026-09-13-grok-g0-baseline.md`.
- [ ] G1A — independent acceptance binds command/argv + candidate content; focused RED/GREEN + `pnpm gate`.
- [ ] G1B — tool/artifact boundaries; gate/security/Pi probes.
- [ ] G2 — real adapter + local HTTP loopback after G1A/B; no live LLM / default CLI.
- [x] G3 — F6 readiness/pollution inventory (report-only); no seal/oracle. See [g3 report](../docs/reports/2026-09-13-grok-g3-f6-readiness.md). **NOT READY**; experiments NOT RUN.
- [x] Earlier G0–G3 merge facts remain verified: PR #37–#41 MERGED, remote main `fe253301`; do not reimplement them (2026-09-13 evidence retained in prior report).
- [x] Original R1/R2/R3/R4 concrete regressions plus staged-delete control rerun unchanged on full candidate: 5 pass / 0 fail / 0 skip (2026-09-14). This closes those exact counterexamples, not all related boundary acceptance.
- [x] Focused 57/57; gate 2767 pass / 0 fail / 18 skip; post-build security probe 26 PASS and Pi probe 4 PASS (2026-09-14). Initial pre-build security probe failed due missing dist; both attempts recorded.
- [x] RR1 (P1) — rename source identity: fixed 2026-09-16 on the local full candidate (`merge-r3r4`, uncommitted): `parsePorcelainZ` preserves rename/copy source; source-swap regression added and RED→GREEN verified (evidence: [2026-09-16 review report](../docs/reports/2026-09-16-whole-repo-review-next-steps.md)). Pending independent re-review on the final head.
- [x] RR2 (P1) — durable run identity: fixed 2026-09-16 on the local full candidate: `assertRunPresent` validates via `EventStore.readAll()` (empty/corrupt/mid-corrupt/identity-mismatch/no-RUN_CREATED rejected, torn tail tolerated); all empty-log fixtures replaced with real initialization; controlled delete/write interleave test added. Pending independent re-review on the final head.
- [x] RR4 (P2) — timeout validation: fixed 2026-09-16 on the local full candidate: `timeoutMs` must be a finite positive safe integer (1..2147483647); 0/negative/NaN/Infinity rejected before spawn; default 60000 preserved. Pending independent re-review on the final head.
- [x] SCM aligned PR #42 with the final full candidate 2026-09-16: head pushed as fast-forward `5357163` → `aeb4993` (R3/R1 verified ancestor; R2/R4 included). Hosted CI green on the head (first run failed on the pre-existing delete-vs-writer race flake, failed-job rerun success 2026-09-17; test observation fixed in `6ae179c`).
- [x] Author-run same-head evidence on a fresh checkout of `aeb4993` (2026-09-17): original 5 + re-review 3 regressions pass, focused 61/61, gate 2771 pass / 0 fail / 18 skip, security + pi probes pass. Evidence: [review package](../docs/reports/2026-09-16-rr-fix-review-package.md). Independent review dispatch failed on provider quota (402); review remains with the owner / Grok bot per the turnkey protocol.
- [ ] **Superseded historical checklist:** the former final-independent-review/merge wording for PR #42 is retained as dated evidence only. PR #42–#45 later merged per the 2026-09-20 reconciliation; no current merge or disposal action is pending here. Author verification remains distinct from independent review.

## Historical delivery record — SoL-Pi efficiency line (merged 2026-09-13)

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

Plan: [TASK-20260913-grok-trusted-execution](../docs/superpowers/plans/2026-09-13-grok-trusted-execution.md).

- [ ] Historical G0–G3 checklist: no new execution is authorized by this record. G3 remains a report-only F6 readiness inventory; experiments were not run. Current evidence-first gates are tracked above.

## Historical delivery record — PR-A / PR-B / PS-HOTFIX / PS-P3 / PS-P4 / P5 (merged 2026-09-13)

- [x] PR #36 MERGED 2026-09-13T08:19:09Z; main `6ee16a3722fda35d9b6098144602f199fb0a7d0f` includes tip `4804d4c`.
- [ ] SCM supplies per-stage independent Reviewer PASS artifacts with exact SHAs (GitHub reviews array empty — unavailable).
- [ ] F6 seal/real-provider holdout remain separately gated.
