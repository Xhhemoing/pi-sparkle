# Report-driven execution and dependency reconciliation

Task: `TASK-20260929-report-execution`  
Date: 2026-09-29  
Owner: implementation agent for the isolated source branch; repository maintainer for independent review, owner freezes and production/experiment authorization.  
State: in-progress; no new implementation acceptance is claimed by this plan.  
Source baseline: `6ef6a04882ed5a42fa5dae1d37f77b0c48e64689` (`main`).  
Branch: `codex/report-execution-20260929`.

## Request and controlling evidence

The user supplied `pi-sparkle-architecture-and-agent-improvement-report-2026-09-27.md` and requested a saved revised plan, implementation, verification, and staged GitHub publication through the remaining work. The report's evaluation baseline was `1b04aa9d9e70206cfb41a2963189dfb5bcab3a5d`, not current main. Its recommendations are not proof of current defects or owner approval of frozen interfaces.

Read alongside [active plan](../../../tasks/plan.md), [active checklist](../../../tasks/todo.md), [report checklist](../../../tasks/report-improvement-todo.md), [status matrix](../../status-matrix.md), [development workflow](../../development-workflow.md), [original report plan](2026-09-27-report-driven-improvements.md), [continuation plan](2026-09-27-report-continuation.md), and [2026-09-28 integration evidence](../../reports/2026-09-28-sync-merge.md).

### Dated reconciliation (takes precedence over older planning snapshots)

- A1 Chinese/English intent and read-only planning, A2 quoted paths, A0-root canonical path correction, and B1 optional native task contracts were implemented, source-reviewed, tested and merged before this task. Do not reimplement them.
- The 2026-09-27 interrupted gate is historical. The 2026-09-28 integration record reports 3152 pass / 0 fail / 18 skip at `14a50358` and publication at `bb6d59c8`. These are prior-run evidence, not results obtained in this session; run current verification for new changes.
- S0-min Option A implementation is authorized, merged and independently source-reviewed at `3f5711ba`. It remains **not FROZEN** pending owner acceptance. Do not call it unimplemented or treat source review as owner freeze.
- D1 (the existing evidence-gap projection), L1, L2 and final review remain separate from **D1-learning** below. Do not conflate these identifiers.
- O02/O03 and other reliability packages retain their existing ownership; unmerged local worktrees/stashes are not available in this container and must not be overwritten, reset or presumed absent.
- Nothing becomes Outcome-supported merely through this plan, source presence, self-review or green CI.

## Product outcome and non-goals

Deliver the report's two loops on existing infrastructure: goal -> contract -> relevant bounded context -> bounded execution -> independent verification -> inspectable delivery; trustworthy outcome -> scoped experience -> candidate -> independent comparison -> explicit approval -> version-pinned activation.

Reuse requirement/track/native/run, EventStore/checkpoints, existing evaluation/artifacts, context/episode/preferences, and adaptation resource types. Do not add another scheduler, credential provider, event authority, global memory database or routing registry. Preserve frozen RunStatus/CLI/event contracts, ADR-008's no-new-cryptographic-integrity-mechanism decision, handle-only candidate application, source-change preservation, and opt-in provider/experiment boundaries.

## Revised order and work packages

The A-E roadmap remains open in full. Prioritize newly verified defects over restating already delivered work. Packages that do not depend on host-outcome approval may proceed in disjoint files while that approval is outstanding; this is not a waiver of the blocked dependency.

| ID / report stage | Work and principal files | Observable acceptance / verification | Dependency and current disposition |
|---|---|---|---|
| A0-current / A | Establish current source/check/build/probe identity; existing CI and dated evidence. | `pnpm workflow:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`; security/Pi/kernel probes; record exact head, counts and skips. | In progress. Prior 3152/0/18 is not relabeled as this run. |
| A-reliability / A | Finish retained O02 cancellation/setup cleanup, O03 cross-instance disposal, raw evidence and measured I/O work under existing reliability plan. | No child/process/learning after cancellation; foreign candidate refusal; measured heap/latency and original/raw evidence; applicable native/privacy tests and probes. | Preserve current owner; reconcile retained drafts and acceptance before overlapping edits. Remains open. |
| A-regression / A | Preserve merged Chinese intent, negative constraints, report-only deliverables, quoted Windows paths and root identity tests. | Existing requirement/track/native parser/root focused tests and Linux/Windows CI. | Already delivered bounded slices; rerun as regression, do not claim all Stage A closed. |
| B2 / B | Host-neutral outcomes and per-criterion completion receipt over existing evaluation/native. | COMPLETED without independent evidence remains UNOBSERVED; version/source mismatch invalidates evidence; execution, verification and acceptance remain separate. | Blocked by S0-min owner freeze, then approved L1/L2 and required final review. |
| B3 / B | On-demand status, candidate and resume projections from current events/inspection. | Rebuildable; bounded results; disclose missing/truncated evidence, source drift, remaining criteria and next action; no new terminal authority. | Existing D1 review/dependency must be reconciled; host-independent projection changes may be separately scoped. |
| B4 / B | Root budget reservation and exactly-once settlement in run/supervisor/telemetry. | Concurrent reservations cannot exceed root allowance; retries and failures counted; unknown prices remain unknown; release on cancellation; tests include races/replay. | Planned after run ownership/lifecycle reconciliation; no invented dollar guarantee. |
| C2-context / C | Mandatory context retention and safe budget failure in `src/context/packet.ts`, with the existing track/native consumers inspected. | Invalid budget is refused; hard constraints/authorization are not silently omitted; Chinese text has a documented deterministic estimate; optional omissions remain explicit; no dispatch on unsafe packet. Focused context/track tests then full gate. | First independent implementation slice. Do not change frozen events or imply a calibrated tokenizer. |
| C2-evidence / C | Version-to-evidence invalidation using existing artifact/contract/dependency references. | Old candidate/source/verifier evidence never remains an independent PASS after a relevant change; unrelated change does not trigger destructive replay. | Planned; host-outcome-dependent portion waits for B2. |
| C1 / C | Project-scoped decision memory and resume continuity using context/episode and existing memory resources. | Provenance, counterevidence, correction/revocation, expiry and source-deletion cascade; no cross-project default; stale/deleted records excluded from reuse. | Planned; inspect existing privacy ownership before changing persisted records. |
| D1-learning / D | Stratified diagnostics in `src/learning/diagnostics.ts` and bounded auto-loop use; preserve observation-ledger identity. | Separate project/family/role/available version strata; duplicate imports do not raise sample count; conflicting/unknown evidence is not invented; provider/environment failures excluded; primary model diagnosis supported, activation remains explicit. Focused learning tests then full gate. | Second independent implementation slice; no online selection or new storage. |
| D2-learning / D | Method candidates/inbox using existing workflow-template/skill/example/prompt/memory resource types. | Executable preconditions/steps/exit rules; support/counterevidence and scope; candidate-only; dedupe; no automatic promotion. | Planned after trusted evidence and D1-learning; do not call a self-report an independent success example. |
| D3-learning / D | Authorized baseline/candidate comparison over existing experiments/evaluation. | Fixed inputs, candidate/validator/model versions; project/time/source-isolated holdout; balanced order; all-attempt costs; duplicates excluded; independent outcomes. | Protocol tests may proceed; live/holdout execution requires original budget/data/provider/custodian approvals. |
| E / E | Approved version-pinned activation, stop/rollback and degradation monitoring. | Exact approved resource version fixed for new runs; audit trail and stop path; historical evidence immutable; policy rollback never resets user workspaces; F-PROD confidence bounds retained. | Blocked on applicable S0-min, R10/R11, F6/F-PROD and owner approvals plus independent subsequent outcome evidence. |

## First dispatch: test-first implementation

1. Save this plan and an initial checklist before any runtime change.
2. Inspect C2-context call sites, existing packet tests and compatibility constraints. Add failing regression tests before implementing. Keep semantic guarantees explicit rather than silently dropping mandatory material or raising budgets.
3. Inspect D1-learning callers, feedback schema and ledger identity. Add regressions for mixed families, duplicate records, environment failures and primary-model diagnostics. Unknown role/version remains unknown; do not synthesize historical metadata. Preserve existing promotion policy.
4. Continue the next dependency-satisfied slice only after its plan, red test, focused verification and compatibility review are recorded. Keep all unimplemented or unapproved packages unchecked.
5. Publish separately reviewable commits (plan, red tests, behavior, evidence); use a pull request rather than overwrite main. Do not fabricate independent reviewer PASS or merge through an unmet gate.

## Verification and reproducibility

The current container cannot resolve GitHub directly and has Node 22.16.0, below this repository's supported `>=22.19.0`. The authenticated GitHub connector remains available. Supported verification therefore uses the existing GitHub Actions Node 22.19.x / pnpm 10.17.1 workflows; local isolated checks, if used, are supplementary and must not be described as the full supported gate.

A temporary branch-only CI source/dependency snapshot may be used to materialize the exact checked-out public source for offline editing/testing. It must use read-only permissions and `persist-credentials: false`, archive tracked source rather than `.git` or runtime state, include no credentials/private sessions, have short artifact retention, and be removed once bootstrap is complete. Do not change pinned dependencies or loosen gates to accommodate this container.

Every evidence record names baseline, tested head (including PR merge/head distinction), commands, result/counts, skipped opt-in tests and remaining limitations. Existing CI already checks workflow/typecheck/lint/test/build, security/Pi/kernel probes and Windows/Linux smoke. New code requires focused checks plus that applicable gate. Real-provider, crash, benchmark and holdout runs are NOT RUN unless separately executed and recorded.

## Risks, abort and recovery

- Stop a slice on a new frozen-interface dependency, unexpected source drift, duplicate file ownership, or an unreviewed privacy/persistence requirement; update this plan and preserve work.
- Do not alter old evidence to reconcile dates. Add dated corrections and link exact new evidence.
- Keep failed tests visible and fix the behavior rather than relax safety assertions. Do not equate execution termination, command PASS, independent review and user acceptance.
- Source publication is not deployment, production application, approval, or evidence of long-term benefit.
- Use additive Git commits and non-force ref updates; preserve unrelated branches, user changes and opaque candidate handles. No global configuration/credential changes or destructive workspace rollback.

## Closeout contract

Update `tasks/report-improvement-todo.md`, active task pointers and `docs/status-matrix.md` as appropriate. Publish a dated verification/handoff with each slice's state, files, exact results, regression risks, unresolved owner/experiment gates and the next eligible command. The whole project is complete only when every required criterion and separate gate has evidence, not when a planning checklist has been rewritten.
