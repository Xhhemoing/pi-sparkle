# Report execution: remaining dependency queue

Task: `TASK-20260929-report-execution`. Date: 2026-09-29.
State: next-slice planning only, not implementation or authorization.

This queue supplements the [saved execution plan](2026-09-29-report-execution.md) after the bounded C2-context and D1-learning implementations. The [checklist](../../../tasks/report-execution-todo.md) and [dated evidence](../../reports/2026-09-29-report-execution.md) separate implementation, automated verification, independent acceptance and production outcomes. A row below remains unfinished until its own criteria are proved.

## Immediate review boundary

Independently review PR #47 against its exact source head: whole mandatory admission and error sanitization; first-launch failure/cleanup; tuple stratification; semantic task replay and conflict exclusion; no primary replacement; no role/version scope widening. Review should consider the conservative loss of actionable samples when attribution/binding conflicts and the loss of automatic legacy avoid proposals when their policy cannot express observed role/version scope. Confirm these are intended safety tradeoffs. Source and automated tests do not substitute for this review. Main merge remains separate.

## Next independently scoping work

| Order | Package | First bounded change and RED evidence | Dependencies / stop condition |
|---|---|---|---|
| 1 | C2-evidence, host-independent portion | Audit existing artifact/contract/version references, then specify tests in which relevant source/candidate/verifier changes invalidate prior evidence while an unrelated change does not. Keep evidence provenance inspectable. | Do not redefine independent PASS, add a new event authority, or edit frozen host outcome schemas. Host-dependent wiring waits for B2. No implementation is claimed here. |
| 2 | C1 project decision memory | Audit existing context/episode/memory retrieval and privacy deletion ownership. Scope one existing-resource correction/revocation path; RED tests must show a revoked or expired decision is not retrieved and projects remain isolated. | Agree existing persisted-resource/version constraints before writing. Provenance and deletion cascade must cover derived records; no global transcript collection. |
| 3 | B3 read-only continuity/status | Reconcile existing evidence-gap D1 review, then derive a bounded resume/status projection from current events and version drift. Test omitted/truncated evidence and missing criteria. | D1-learning does not approve the separately named evidence-gap D1. No new terminal state or inferred acceptance. |
| 4 | B4 shared root budgets | Reconcile O02/O03 lifecycle ownership first. Scope reservation/settlement over existing supervisor/run accounting. RED tests: concurrent reservations, retry/all-attempt costs, cancellation release and exactly-once replay. | Do not overlap unreconciled retained worktrees or invent prices for unknown providers. |
| 5 | D2-learning candidate bridge | Define a typed existing-resource candidate retaining project/family/role/model/feature scope and support/counterevidence; test dedupe and unrepresentable-scope refusal. Keep a candidate-only inbox. | A legacy family/model avoid rule must not erase known qualifiers. Trusted outcome and schema boundaries must be resolved; no automatic promotion or live selection. |

Each package requires a concrete file-level plan before runtime edits, an observed failing regression, focused GREEN, supported complete gate/probes, staged publication, and independent acceptance. Do not begin all packages as one persistence/authority rewrite. This queue is not permission to bypass a dependency.

## Owner and external critical path

S0-min Option A is implemented and independently source-reviewed, but owner freeze remains outstanding. After that explicit freeze, follow approved L1, L2 and final review for B2 host outcomes and per-criterion completion receipts. Preserve O02/O03 retained work and ownership. R10/R11, F6/F-PROD, provider/budget/data-custodian approvals and independent holdout/subsequent-outcome evidence remain separate.

D3 may specify isolated comparison fixtures and protocol tests without claiming a real experiment. A genuine comparison must pin inputs, candidate/model/validator versions, project/time/source holdout boundaries, balanced ordering and all-attempt costs. E activation requires the applicable approvals, a fixed approved version for new runs, an auditable stop/rollback path and independent later outcomes. Policy rollback must never reset user workspaces.

## Completion standard

Keep the original A-E acceptance criteria. These bounded implementations do not finish shared budget accounting, decision memory, evidence invalidation, method-level candidates, controlled comparisons or production outcomes. No percentage improvement, full-roadmap completion or Outcome-supported module is asserted without new evidence. Continue from this queue and the exact reviewed head, not from historical unchecked/checked snapshots.
