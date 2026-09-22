# Evidence-first phase plan — expert review record (2026-09-21)

## Scope and provenance

This record captures the bounded read-only reviews dispatched after the
owner-supplied deep-research amendment to
`docs/superpowers/plans/2026-09-21-evidence-first-phase.md`.

Review request: [evidence-first plan re-review](2026-09-21-evidence-first-plan-re-review.md).
Amended plan commit at dispatch: `45dbb0e`.

The reports below are advisory review outputs. They are not implementation
verification, a human approval, or an Outcome-supported result. The project
must not mark the phase accepted until the required corrections are made and a
fresh review/owner gate is recorded. The current tree fact is now reconciled:
`Sparkle_apply_candidate` is present/wired but not production-authorized;
worker-write registration and automatic write-to-apply chaining remain absent.

## Dispatch results

| Review role | Channel/result | Verdict | Status |
|---|---|---|---|
| Governance/program | owner-designated `luna-fast` | **REQUEST CHANGES** | Report received |
| Evaluation/statistics | owner-designated `luna-fast` | **APPROVE WITH CHANGES** | Report received |
| Security/trust boundary | owner-designated `luna-fast` | **REQUEST CHANGES** | Report received |
| Repository consistency | `luna-fast` | no report; concurrency limit failure | **Unreviewed** |

The `sparkle_delegate` child reports are bounded reports and are not
independently verified by the host. The relay/channel outage and no-silent-
fallback policy remain in force.

## Blocking findings

### P0-1: existing apply registration is conflated with future write capability

The current tree already registers host-facing `sparkle_apply_candidate` in
`extensions/pi-sparkle/index.ts`, and the status matrix marks it wired. The
phase plan's broad wording that write/apply registration is blocked or not
started was therefore contradictory. The plan/status wording has now been
corrected to distinguish registration, worker-write registration, and
production authorization.

The project must distinguish three states in every plan and status record:

1. **Existing host-facing apply registration** — present and wired; consumes a
   host-issued handle; not yet production-authorized pending R10/R11 review and
   owner approval.
2. **`NativeWriteSession` / worker write registration** — library capability
   exists, but no worker write tool is registered.
3. **Authorization to apply or chain writes automatically** — a separate
   policy/owner gate; not implied by registration or local tests.

Required correction: rewrite the phase global constraint, mainline item, and
acceptance criterion using these exact distinctions. R10/R11 review is
prospective hardening and authorization review of the existing apply surface;
it does not imply that the already-wired tool was absent.

### P0 operational rule

No live A/B/C run may start until the read-only evaluator gate and
preregistration are frozen. No new write capability or production apply claim
may start until the full R10/R11 gate closes.

## Required P1 corrections

### P1-1: split the umbrella into four executable plans

Create and link these dependency-ordered plans:

1. projection hardening and telemetry;
2. read-only evaluator manifest/freeze;
3. exploratory A/B/C pilot and preregistration;
4. full evaluator/apply boundary and future worker-write registration.

The pilot depends on plans 1 and 2. Full apply-boundary work is independent of
projection hardening and is not implemented by the pilot plan.

### P1-2: create the named deliverables

The previous plan named but did not contain these artifacts:

- `docs/superpowers/specs/2026-09-21-readonly-evaluator-manifest.md`
- `docs/superpowers/specs/2026-09-21-projection-measurement.md`
- `docs/reports/2026-09-21-ab-c-pilot-preregistration.md`

Each must state owner/state, schema, immutable fields/digests, acceptance
criteria, exact verification command, refusal/omission rules, dependencies,
and approval gates. Draft files are not frozen manifests or live authorization.

### P1-3: separate read-only evaluator freeze from full R10/R11

The pre-pilot gate freezes only the acceptance definition for a read-only
projection experiment. It must include an immutable evaluator snapshot and
digest, candidate write exclusion, result schema, task/repo/runtime/tool/policy
identity, and a mutation-attempt refusal test. It does not issue apply
capabilities or authorize writes.

The later R10/R11 gate covers candidate snapshots, evaluator/runtime/policy/
result/approval binding, expiry, idempotency, crash reconciliation, existing
apply-tool authorization, and any future worker-write registration.

### P1-4: choose one primary KPI and freeze it consistently

Use the following as the draft canonical definition across all three planning
artifacts:

> **Primary platform KPI:** provider/runtime cost per independently accepted
> task bundle. For each distinct task, use a fixed `K` runs per arm and a fixed
> retry rule. The numerator is all provider/runtime cost across those runs and
> retries, including provider/auth/quota/runtime failures. The denominator is
> the number of distinct tasks with at least one valid run independently
> accepted without human correction. A secondary run-level cost-per-accepted-
> run metric and a human-correction metric are reported separately. An arm with
> zero accepted tasks has an undefined primary KPI and cannot support a claim.

Human correction time is not silently mixed into the primary platform KPI; it is
reported per task/per accepted task and in a predeclared all-in sensitivity
analysis. Missing usage remains unknown, never zero.

### P1-5: freeze pilot execution rules

The preregistration must specify before outcome inspection:

- every task appears in every arm unless a documented incomplete-block design
  is approved;
- fixed repository revision per task;
- randomized arm and repeat order;
- distinct task is the analysis/bootstrap unit; repository is a cluster when
  tasks share a repository;
- maximum retries, retry timing, timeout, cancellation, and stopping authority;
- assigned/not-started, started/provider-failure, runtime-failure,
  evaluator-failure, valid-completed, accepted, and rejected states;
- provider/runtime failures contribute cost and zero operational acceptance;
- no post-outcome exclusion or replacement;
- predeclared reserve-task rules;
- missing-usage and incomplete-pair treatment;
- exact paired bootstrap or hierarchical estimator and interval method;
- no efficacy peeking unless a sequential rule is frozen in advance.

### P1-6: bind frozen routing concretely

B and C must use either disabled learned routing or one immutable,
content-addressed routing snapshot. The manifest must record path/reference,
version, SHA-256, and loaded-policy hash. Registry mutation during collection
aborts the run.

### P1-7: define projectability metadata before requiring it

The typed metadata contract should be explicit:

```ts
interface ProjectabilityMetadata {
  resultKind: "observation" | "receipt" | "permission" | "error" | "other";
  isError: boolean;
  mutatesState: boolean;
  securityCritical: boolean;
  toolPolicyProjectable: boolean;
}
```

Absent metadata fails closed. The current read tool must emit explicit metadata
before a live C arm is allowed. Text-marker detection remains a fail-closed
compatibility fallback.

### P1-8: remove F6 from this phase's acceptance criteria

F6/F-PROD is out of scope and must not make this phase incomplete. Link the
existing F6 governance records and state that the A/B/C pilot cannot close F6,
enable R1/bandit selection, reuse F6 pricing/holdout evidence, or justify M7
training infrastructure. A separate owner-gated F6 decision task may be
created independently.

## P2 corrections

- The preserved research report is an owner-supplied non-authoritative artifact;
  unresolved citation tokens, uncited vendor claims, and future-dated claims
  require independent source/retrieval evidence before becoming project facts.
- Use one canonical camelCase capability field vocabulary everywhere:
  `runId`, `baseRevision`, `candidateTreeDigest`, `evaluatorBundleDigest`,
  `evaluatorResultDigest`, `runtimeIdentity`, `toolSchemaDigest`,
  `policyDigest`, `approvalIdentity`, `issuedAt`, `expiresAt`,
  `idempotencyKey`.
- The repository-consistency review did not run because the fourth dispatch hit
  the concurrency limit. Do not infer approval from the three returned reports.

## Accepted guidance retained

- The evidence-first direction is coherent.
- Approximately 30 tasks × 2–3 repeats is exploratory only; it cannot prove
  non-inferiority or broad Outcome-supported benefit.
- A→B is a system-level contrast; B→C is the projection marginal contrast,
  conditional on a frozen equivalence manifest.
- The project must preserve the distinction among Present/Wired/Exercised/
  Outcome-supported and among author verification, independent review, human
  approval, and outcome evidence.
- The research report remains a hypothesis source, not independent verification.

## Correction status

- [x] P0 registration-state wording reconciled in the umbrella plan,
  `tasks/todo.md`, and `docs/status-matrix.md`: existing host-facing apply is
  present/wired/non-production-authorized; worker write and automatic chaining
  are absent.
- [x] Four child plans and three named draft deliverables created and linked.
- [x] Canonical K=2 task-bundle KPI, fixed retry policy, missingness taxonomy,
  task/repository clustering, and human-correction secondary metric added.
- [x] Read-only evaluator gate separated from full R10/R11 apply gate; F6
  moved to a governance handoff rather than this phase's acceptance criterion.
- [x] Existing host-facing apply registration, unregistered worker-write
  capability, and production authorization are reconciled in the plan,
  checklist, status matrix, and ADR-006.
- [ ] Fresh low-concurrency review remains required, including the repository-
  consistency role that previously did not run.

## Required follow-up

1. Resolve any remaining findings from the fresh focused re-review.
2. Obtain owner approval for the read-only evaluator manifest, pilot budget/data
   policy, and exact preregistration thresholds.
3. Do not start live providers or new write-tool implementation before those
   gates and the applicable child-plan reviews close.
