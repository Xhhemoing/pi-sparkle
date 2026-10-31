# Report-driven implementation plan

Task: TASK-20260927-report-improvements\
State: in-progress (A1/A2 only; later packages planned)\
Owner: implementation agent; repository maintainer owns independent acceptance and policy gates\
Source baseline: `1b04aa9d9e70206cfb41a2963189dfb5bcab3a5d`\
Branch: `codex/report-plan-phase-a-20260927`

## Request and evidence boundary

Implement the supplied **pi-sparkle architecture and agent improvement report**, dated 2026-09-27, rather than produce another aspirational review. The report's two loops remain the organizing principle: task contract -> bounded execution -> independent verification -> inspectable delivery; trustworthy outcomes -> scoped experience candidates -> controlled evaluation -> explicit promotion.

Current main was checked against the report baseline before work. No open pull request was returned at intake. Existing O01-O11 reliability work, B0/D1/S0-min/L1/L2, R10/R11 and F6 retain their own acceptance records. In particular, the interrupted integrated gate is NOT a pass; this plan does not supersede ownership of O02 or duplicate O08b/O09. No live-provider experiment, new credentials, production apply, automatic promotion, state migration, global configuration change or main-branch merge is authorized by this implementation slice.

## Architecture and non-goals

Reuse requirement/track/native, the existing event/checkpoint authority, context/episode, evaluation, and adaptation resource types. Do not introduce a second scheduler, memory database, model registry or policy authority. Keep JSONL, frozen RunStatus/event/CLI schemas, handle-only application, explicit promotion, and opaque IDs/exact-byte semantics. No new cryptographic hash or integrity guarantee.

The roadmap below is an implementation proposal, not evidence of completion. Each package needs a focused regression, adjacent integration checks, a dated verification record and review before acceptance. Shared files must have one active owner; parallel work is limited to disjoint packages.

## Stage A - trustworthy baseline and direct fixes

### A0 - close the integrated baseline (open; dependency for merge)

- Files: existing reliability plan/report, package scripts, applicable existing regression suites.
- Work: re-run the integrated baseline gate at an exact commit; reconcile O02 cancellation/setup and remaining disposal/evidence work with its current owner. Do not rewrite earlier PASS records.
- Commands: `pnpm install --frozen-lockfile`; `pnpm gate`; applicable `pnpm security:probe` and `pnpm pi:probe`; run crash/performance/real-provider probes only under their separate opt-in scope.
- Acceptance: test/build/report identify the same source revision; failures, skips and not-run checks are separate. O02 is not marked complete from unrelated tests.

### A1 - Chinese intent and read-only planning (implement now)

- Files: new `src/requirement/objective-intent.ts`; `src/requirement/heuristic.ts`; `src/track/plan.ts`; focused requirement/track tests.
- Work: recognize concrete Chinese action/object/target information without requiring English spaces; recognize positive and negative test intent; explicit user intent outranks preference defaults. Preserve unknowns instead of inferring authorization.
- Work: explicit investigation/no-write intent yields a report deliverable and a read-only constraint, not a diff or modified-file promise. The planner emits only its existing read-only planner/scout roles. A contradictory write answer or default cannot lift an explicit no-write restriction.
- Work: normalize stable answer values alongside legacy English and Chinese aliases without changing the persisted DecisionQuestion schema.
- Acceptance: the report's Chinese login-timeout examples are no longer vague; positive tests produce the existing test criterion; a no-tests request does not become a test requirement; investigation produces no implementer/tester and no workspace-writable profile; scoped negatives such as 'do not modify other modules' do not prohibit the intended local implementation; no authority grant is added.
- Limit: deterministic Chinese/English rules are not a general language model. File-level scope, no-commit and dependency-change enforcement outside this planning seam require separate admission-control work; do not claim all entry points are covered.

### A2 - quoted candidate command arguments (implement now)

- Files: new `src/native/command-args.ts`; `extensions/pi-sparkle/index.ts`; focused native/extension tests.
- Work: parse exactly five nonempty arguments with whole-argument single/double quoting; preserve Windows backslashes, drive letters and UNC paths. Reject unmatched/embedded ambiguous quotes, NUL/newlines and wrong arity before registering anything. No shell expansion, interpolation or command evaluation.
- Acceptance: the report's quoted paths containing spaces remain three exact path values; malformed input does not mutate issued handles; old simple paths still work; existing handle/source/artifact checks remain unchanged. No new model-facing write tool or verification-command parameter.
- Follow-up: a host picker/structured candidate ID is a later UX slice, not claimed by this parser fix.

Stage-A merge gate: A1/A2 focused tests and adjacent tests, `pnpm workflow:check`, `pnpm gate`, extension-appropriate security/Pi probes, final diff review. Environment-blocked checks remain open; a branch/PR can be delivered without representing it as merge-ready.

## Stage B - one inspectable native task loop

### B1 - optional native read-only contract

- Files: `extensions/pi-sparkle/index.ts`, `src/native/session.ts`, existing requirement types and native tests.
- Add bounded optional scope/prohibitions/deliverables/acceptance/source references to read-only delegation; reuse existing contract validation, not a new authoritative store. Keep 1-4 workers and existing tool restrictions.
- Acceptance: old role/objective calls still work; structured constraints reach every child; unknown authority stays absent; long/invalid fields are rejected; task card and returned references agree with persisted input.
- Depends on A1 and review of the input seam. Does not itself grant independent verification.

### B2 - host outcome wiring and completion receipt

- Files: existing execution/evaluation/native outcome and artifact paths; accepted S0-min canonicalizer only.
- Depends on approved S0-min -> L1, followed by L2/final review. Bind criteria and actual host evidence to the exact candidate/source/validator versions.
- Acceptance: execution COMPLETED + no host check remains UNOBSERVED; old-candidate evidence cannot pass a new candidate; provider/environment failures do not become model-quality failures; displayed execution, verification and user acceptance stay separate without changing RunStatus.
- R10/R11 and production apply remain separate. Never accept model-supplied arbitrary verification commands.

### B3 - task/status/candidate cards and resume summary

- Files: native command views, existing EventStore/inspection, checkpoint/episode projections.
- Depends on D1 source review; reuse on-demand projections. Display actual artifacts, blockers, missing acceptance, retained candidate and next action, not invented completion percentages.
- Acceptance: projections rebuild from original records; restart shows goal/completed work/retained artifacts/valid evidence/required rechecks; missing independent evidence is visible; apply and execution status cannot be confused.

### B4 - root budget admission

- Files: existing run/supervisor/telemetry, not a parallel ledger.
- Reserve and settle retries, subtask expansion and verification against the root allowance with serialized admission.
- Acceptance: concurrent child reservations cannot exceed the limit; cancelled work releases reservations exactly once; failed attempts count; unknown prices are unknown, not zero or a promised dollar cap.

## Stage C - project continuity and evidence lifetime

### C1 - scoped decision memory

- Files: context/episode/preferences/feedback plus adaptation `memory` resources.
- Record decision, rationale, scope, source, version, counterevidence and revocation. Retrieval starts with paths/symbols/family/keywords, not a new vector service.
- Acceptance: project A constraints never leak into B; user correction revokes derived reuse; source deletion invalidates or disposes derived candidates/statistics under existing retention policy; memory text has no instruction authority.

### C2 - constraint-preserving context and invalidation

- Files: `src/context/packet.ts`, existing evidence/artifact references and context tests.
- Separate non-omittable constraints from optional context; when critical material exceeds budget, repack, shrink or refuse dispatch. Calibrate Chinese/code/log estimates from measured fixtures.
- Acceptance: critical constraints cannot silently disappear; changed relevant code/validator/source invalidates affected evidence; unrelated documentation changes need not invalidate all work. Measure omission and repeated reads as well as tokens.

## Stage D - method-level learning, not blind routing

### D1-learning - stratified eligible diagnostics

- Files: `src/learning/diagnostics.ts`, `auto-loop.ts`, task-success and existing observation ledger.
- Group by project/family/role/model and relevant feature/policy version; show count and uncertainty. Permit primary-model diagnosis without auto-activation. Reuse canonical dedupe/eligibility.
- Acceptance: review success cannot hide implementation failures; duplicate observations add no samples; provider/permission/cancellation/unknown outcomes do not become model-quality negatives; self-reports are not independent PASS.

### D2-learning - method candidates and inbox

- Files: existing adaptation workflow-template/skill/example/prompt resources and read-only views.
- Store executable steps, applicability, stop conditions, support/counterevidence and an evaluation plan. No new strategy registry or implicit cross-project generalization.
- Acceptance: candidate remains inert without existing approval/CAS promotion; obsolete source evidence prevents reuse; user can inspect scope and decline/revoke.

### D3-learning - authorized baseline/candidate evaluation

- Files: existing experiments/evaluation harness and manifests.
- Freeze task input/project/model/policy/validator versions; isolate train/holdout by project/source/time; balance order; count all cost and retries. Historical log replay alone is not a counterfactual experiment.
- Acceptance: independent outcome evidence and leakage checks; repeated tasks do not inflate samples; no Outcome-supported claim from fake/loopback or identical-arm F-SIM results. Real-provider budget/data/holdout authorization is a prerequisite, not supplied by this plan.

## Stage E - controlled activation

- Reuse explicit approval, CAS promotion, per-run pinned versions and policy rollback. F-PROD keeps its existing utility lower-bound > 0 and cost upper-bound <= 0 requirements unless separately revised and approved.
- Start with one approved task/resource/project slice; stop new activation on regression. Roll back strategy versions, not user workspaces or already-executed side effects.
- Acceptance: effective version and approval are traceable; existing runs keep their manifest; future tasks provide independent evidence of benefit. S0-min/R10/R11/F6/production gates are not silently closed.

## Test-first execution and closeout

1. Record A1/A2 regression tests before changing implementations; establish RED against actual baseline modules where the environment permits.
2. Implement helpers and wire the real extractor/planner/extension. Test pure rules plus cross-module behavior; do not count mocked validation as integration evidence.
3. Run adjacent tests and the full applicable gate; preserve exact command output and execution environment in the dated report.
4. Update `tasks/report-improvement-todo.md` and the task index; open a reviewable PR without merging main or claiming independent review.
5. Abort or split on an unapproved frozen-contract change, widened permission, overlap with active ownership or unexplained regression. Rollback for this additive slice is to revert its commits; no user state migration or deletion.

## Success measures

Track mandatory-acceptance pass rate, first-pass quality/rework, Chinese-English mode/scope/acceptance parity, unnecessary clarification, critical-context retention, repeated work after resume, deduplicated holdout improvement, and all-attempt cost/latency. No percentage improvement is promised without a real task baseline. Safety boundaries and honest UNOBSERVED disclosure are hard requirements.
