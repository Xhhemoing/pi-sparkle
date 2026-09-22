# Evidence-first phase documentation reconciliation plan

## Identity

- ID: `TASK-20260921-evidence-first-reconciliation`
- Owner: documentation slice owner (agent-authored; independent review not performed)
- State: `blocked` — initial reconciliation checks passed, but fresh review requested changes and correction run `mubcjllz-60aaffc6` timed out. Host-identified digest-format, A-baseline provenance, and manifest-schema inconsistencies remain; see the verification report's host closeout.
- Date opened: 2026-09-21
- Related ADR/spec/status: [ADR-006](../../decisions/0006-pi-extension-reverse-adapter.md), [evidence-first phase](2026-09-21-evidence-first-phase.md), [status matrix](../../status-matrix.md)
- Dirty-baseline rule: preserve pre-existing content; the initial six-file scope was explicitly extended by the fresh-review correction request below. Only named paths may be edited, without discarding existing changes.

## Problem and Scope

### Problem

Active task records retain stale current-status wording from the pre-reconciliation delivery gate and do not consistently bind the read-only evaluator manifest to the frozen Stage 0 boundary design and routing identity fields.

Dirty-baseline preservation: the pre-edit `git status --short --untracked-files=all` is evidence-only. Named dirty documents may be amended in place while preserving their existing content; unrelated documentation and scratch files must not be changed.

### In scope

- Reconcile only the permitted active task records and read-only evaluator plan/spec.
- Preserve dated historical evidence and label superseded claims without inventing acceptance.
- Record the current three-report expert disposition, missing fourth consistency review, and fresh-review requirement.
- Add the required `boundaryDesignDigest` and consistent frozen-routing identity requirements while preserving existing draft field semantics.
- Create a verification report with exact command outcomes and author/independent-review distinction.

### Out of scope

- Product/runtime implementation, tests, live providers, experiments, apply authorization, write registration, F6/F-PROD, global configuration, status-matrix edits, deletion, reset, commit, push, merge, or cleanup of pre-existing dirty/untracked content.

## Acceptance Criteria

- [x] `tasks/plan.md` and `tasks/todo.md` no longer present superseded PR #42–#45, disposal, PR-B, or G0–G3 material as current pending work; dated evidence remains linked and unresolved evidence stays open. Verified in the reconciliation report.
- [x] Next-phase pointers state 2 REQUEST CHANGES, 1 APPROVE WITH CHANGES, fourth consistency review not run due concurrency, and amended docs pending fresh review; no outage-fixed or reviews-passed claim is made. Verified in the reconciliation report.
- [x] Read-only evaluator plan/spec require a matching `boundaryDesignDigest` and the same complete frozen-routing identity tuple (`routingSnapshotRef`, `routingSnapshotDigest`, `loadedPolicyHash`), with disabled-routing omission preserved and no partial tuple accepted. Verified by the targeted schema-content check.
- [x] Stage 0, independent implementation review, real-provider budget/data approval, and F6 gates remain open; user execution authorization is not treated as experimental/production approval. Verified in the reconciliation report.
- [x] `pnpm workflow:check` and targeted link/schema-content review are run; exact outcomes are recorded in the verification report.
- [x] The user-authorized execution of this documentation slice is not treated as experimental, provider, production, apply, or F6 approval.

## Implementation Slice

| File/symbol | Change | Owner | Dependency/risk |
|---|---|---|---|
| `docs/superpowers/plans/2026-09-21-evidence-first-reconciliation.md` | Extend this correction scope first; reconcile stale current-status sections and next-phase pointer | documentation slice owner | Preserve dated historical evidence; do not edit status matrix |
| `docs/reports/2026-09-21-evidence-first-reconciliation.md` | Record verification, risks, and handoff | documentation slice owner | Exact command output required |
| `docs/reports/2026-09-21-evidence-first-consistency-review.md` | Record fresh consistency-review request, provenance boundary, and finding map | documentation slice owner | Must not claim independent review or approval |
| `docs/superpowers/plans/2026-09-21-evidence-first-phase.md` | Reconcile phase order, arm-scoped identities, retry scope, and open gates | documentation slice owner | Draft only; no execution authorization |
| `docs/superpowers/plans/2026-09-21-readonly-evaluator-freeze.md` | Add arm manifests, boundary digest, routing tuple, and precise retry fields | documentation slice owner | Must match manifest spec |
| `docs/superpowers/plans/2026-09-21-ab-c-pilot.md` | Declare A/B/C runtime/tool differences and fixed K=2 schedule | documentation slice owner | No retry implementation or live run |
| `docs/superpowers/plans/2026-09-21-evaluator-apply-boundary.md` | Draft Stage 0 boundary dependencies and later apply gates | documentation slice owner | No apply authorization or worker-write registration |
| `docs/superpowers/specs/2026-09-21-readonly-evaluator-manifest.md` | Define per-arm manifest schema and ledger binding | documentation slice owner | Preserve draft status and refusal rules |
| `docs/superpowers/specs/2026-09-21-projection-measurement.md` | Align arm-scoped measurement and retry semantics | documentation slice owner | Measurement contract only |
| `docs/superpowers/specs/2026-09-21-evaluator-boundary-freeze.md` | Draft canonical Stage 0 freeze-record specification | documentation slice owner | No self-approval; record location is planned only |
| `docs/reports/2026-09-21-ab-c-pilot-preregistration.md` | Align preregistered arm, schedule, retry, and gate language | documentation slice owner | Draft; no live calls |
| `.agent_workspace/evidence-first-reconciliation/check-docs.mjs` | Check every touched document, links/anchors, shared schema, arm/ledger, retry, Stage 0, and review-state invariants | documentation slice owner | No network or product-code dependency |

Task records, status matrix, ADRs, product sources, and all other dirty paths are
pre-existing and explicitly out of write scope for this correction.

## Test-First Plan

- Red test: Not applicable; documentation/configuration-only reconciliation, with no product behavior change.
- Focused command: targeted repository link and schema-content checks over every touched document listed above.
- Integration/acceptance command: `pnpm workflow:check`.
- Negative and recovery cases: verify no forbidden file changes, no unsupported gate closure, no live calls, and no mutation of pre-existing dirty/untracked content.

## Gates and Handoff

- Human/policy gate: Stage 0 design/owner freeze, independent implementation reviews, real-provider budget/data approval, F6/F-PROD, and production apply authorization remain open.
- Rollback or abort condition: abort if a source record contradicts accepted ADR/status evidence, if an edit would require changing a frozen contract, or if any non-allowed file would be touched.
- Required durable records: this plan, the verification report, and the new consistency-review report; links to expert review and outage evidence.
- Next command after handoff: obtain a fresh low-concurrency review of the amended evidence-first documents, including the previously unrun repository-consistency role.

## Closeout

- Verified commit/date: no commit permitted; local worktree verification rerun 2026-09-21 after continuation edits.
- Commands and outcomes: recorded in the [reconciliation verification report](../../reports/2026-09-21-evidence-first-reconciliation.md).
- Open risks/follow-ups: obtain a fresh low-concurrency review including the previously unrun repository-consistency role; keep the relay outage, owner budget/data approval, exact preregistration thresholds, Stage 0 freeze, F6 custody/readiness, and R10/R11 boundary review open.
- Evidence links: [expert review](../../reports/2026-09-21-evidence-first-plan-expert-review.md), [re-review request](../../reports/2026-09-21-evidence-first-plan-re-review.md), [deep-research amendment](../../reports/2026-09-21-deep-research-plan-amendment.md), [outage record](../../reports/2026-09-20-luna-dispatch-outage.md), [verification report](../../reports/2026-09-21-evidence-first-reconciliation.md).

## Fresh review correction scope (mubcd7l9-651229f5)

This documentation-only correction responds to fresh review findings. It may
edit only the paths named by the request; it must not alter product code,
configuration, runtime state outside the named checker, or any pre-existing
dirty path. No commit, push, live provider call, experiment, owner approval,
production/apply authorization, or freeze claim is permitted.

### Acceptance criteria

- [ ] Every arm has an explicit identity record. A uses the native Pi executor
  with no sparkle learned routing; B and C share the same frozen tuple. The
  common evaluator/task/repository constraints are shared, while tool schema
  and runtime identity may differ between A and B/C. C's recall-tool
  difference is declared rather than represented as complete schema identity.
  Each ledger row includes `armManifestDigest`.
- [ ] Retry language reflects the source boundary: `maxAttempts=3` is the
  provider-executor retry upper bound for one `PiAgentExecutor.execute()`
  execution, including the first call; it is not exactly three API calls and
  is not a global budget across all children or tool turns. The pilot uses
  exactly `K=2` scheduled runs per task/arm, with no outcome-driven extra runs.
  Task/agent retry enforcement is not implemented by this documentation slice.
- [ ] A native A-arm configuration is independently frozen before any live
  run; mismatch is declared and blocks collection. The existing native
  executor's actual tool/runtime/auth configuration is documented, without
  claiming identical schemas with B/C.
- [ ] Stage 0 has a draft canonical freeze-record specification under
  `.agent_workspace/evidence-first-reconciliation/`, including deterministic
  canonicalization and hashing, invariant/evaluator write-exclusion,
  weak-integrity/crash/replay fields, provenance and owner-review bindings
  without circular digests, and reproducibility/mutation-refusal criteria.
  `boundaryDesignDigest` hashes the design payload; approval evidence binds
  that same digest. This draft is not self-approved or frozen.
- [ ] The checker covers every touched document, local links/anchors, shared
  schema fields, arm identity/ledger bindings, retry scope, Stage 0 draft
  requirements, and forbidden completion claims.
- [ ] The report records `REQUEST CHANGES`, the fresh-context same-model
  provenance, the fact that it is not independent review, finding-by-finding
  remediation, and pending re-review.

### Source facts inspected before editing

- `src/pi-adapter/pi-executor.ts`: `runWithRetry()` creates a fresh agent per
  `execute()` call, resolves the configured retry policy, and returns after
  success, cancellation, non-retryable failure, or exhaustion.
- `src/pi-adapter/provider-retry.ts`: `RetryPolicy.maxAttempts` is total
  attempts including the first; the default is 3; retry decisions are local to
  the executor loop.
- `src/pi-adapter/native-executor.ts`: native execution builds a separate
  `PiAgentExecutor`, filters coding tools to `sparkle_read_file`, and adds the
  recall tool only when projection is enabled.
- `docs/superpowers/plans/2026-09-21-evidence-first-phase.md`, the child plans,
  specs, preregistration, prior review records, and status records are the
  documentation surfaces reconciled by this slice.

## Fresh review execution extension: mubcd7l9-651229f5

This extension is the first implementation action for the fresh review. It is
limited to the explicitly permitted documentation paths and the named checker;
all existing dirty and untracked paths remain preserved. No product code,
configuration mutation, commit, push, live provider, experiment, owner
approval, production/apply authorization, or freeze claim is permitted.

### Required reconciliations

1. **Arm identity and ledger binding.** Keep common evaluator/task/repository
   constraints shared, but define per-arm manifests. Arm A is the native Pi
   executor with sparkle learned routing disabled; B and C share the same
   frozen routing tuple. Runtime identity and tool schemas may differ, and C's
   recall tool is a declared difference rather than complete schema identity.
   Every ledger row must carry `armManifestDigest`.
2. **Retry scope.** Reflect the inspected source precisely: the provider
   executor's `maxAttempts=3` is a retry upper bound including the first call
   for one `PiAgentExecutor.execute()` scope. It is not exactly three API calls
   and is not a global budget across children or tool turns. The pilot schedule
   is exactly `K=2` runs per task/arm with no outcome-driven extra runs;
   task/agent retry enforcement is explicitly not implemented here.
3. **Native A freeze dependency.** Require an independently frozen A
   configuration before any live collection. The source facts are a separate
   `PiAgentExecutor`, host-resolved auth, native `sparkle_read_file` filtering,
   and conditional recall-tool addition. Any mismatch is declared and blocks
   collection; identical B/C/A schemas must not be asserted.
4. **Stage 0 draft record.** Specify a canonical freeze-record design under
   `.agent_workspace/evidence-first-reconciliation/stage0-freeze-record.json`:
   deterministic canonicalization/hash procedure, invariant and evaluator
   write-exclusion, weak-integrity/crash/replay fields, provenance and
   non-circular owner-review binding, reproducibility, and mutation refusal.
   `boundaryDesignDigest` hashes the design payload, while approval evidence
   binds that same digest without entering the hashed payload. The record is a
   draft only and cannot self-approve or claim a freeze.
5. **Review disposition and verification.** Record **REQUEST CHANGES** with
   fresh-context same-model provenance, explicitly not independent review;
   map each finding to remediation and require pending low-concurrency
   re-review, including the previously unrun repository-consistency role.

### Documentation-only verification contract

The checker must cover every touched document, local links/anchors, shared
schema fields, arm/ledger invariants, retry scope, Stage 0 draft requirements,
and forbidden completion/approval claims. Delivery records must report the
exact checker, `pnpm workflow:check`, and `git diff --check` output, while
remaining explicit that these are author-run checks only.
