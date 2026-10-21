# Task Management

Start with the [active plan](plan.md), [open checklist](todo.md) and generated [STATUS](../STATUS.md). PR #64 is merged; its initial comparison, replication and unresolved candidate defect remain recorded evidence. Two further paired tasks are measured and independently reviewed in isolated Soul copies: Rust integer-time correctness and Python archive boundary-test quality. The numeric native run failed on an upstream stream error despite usable code; both numeric candidates needed formatting. Both archive candidates completed with no review blocker. See the plan for exact metrics, interventions and limits; these results do not establish general superiority. Original Soul code/data stay untouched; inputs are synthetic. This bounded expansion does not complete the deferred 15-task evaluation. P4/P5 and new experiments/adaptation/learning features remain frozen; no runtime functionality is added.
## Authoritative Files

- [`plan.md`](plan.md): current scope, order, acceptance criteria and handoff links.
- [`todo.md`](todo.md): unfinished work only, at most 25 lines.
- [`migration-todo.md`](migration-todo.md): historical slice details and retained constraints; its old next steps do not override the active freeze.
- [`adaptive-plan.md`](adaptive-plan.md) and [`adaptive-todo.md`](adaptive-todo.md): preserved adaptive-loop constraints; paused pending the A/B decision.
- [Previous plan](archive/2026-10-21-pre-integration-plan.md) and [previous checklist](archive/2026-10-21-pre-integration-checklist.md): full pre-integration history, including unresolved obligations.

Accepted ADRs and explicit owner decisions govern scope and approval. [Status-matrix](../docs/status-matrix.md) retains scoped capability/human-policy claims; generated STATUS summarizes observations, not authorization. Resolve conflicting current claims in the existing active plan or relevant decision record, without creating another receipt report.

## Required Task Record

Update the existing active plan for non-trivial work: owner/state, problem, scope/non-goals, observable acceptance, affected files/dependencies, test-first approach, verification commands, risks and next action. The [plan template](../docs/templates/task-plan.md) is a content guide, not a requirement for a new file per slice.

Put exact verification outcomes and independent review in the PR description using the [verification template](../docs/templates/verification-record.md); detailed logs belong in CI artifacts or temporary `.agent_workspace/` output. Preserve the PR/artifact links needed to resume. Do not create per-slice reports or `docs: record receipt` commits. [Retained reports](../docs/reports/README.md) preserve historical evidence; removed redundant material remains in published Git history.

## State Rules

- `[ ]` means unfinished; remove completed entries from the active checklist after the PR/CI records their outcome.
- `blocked` names the blocker and owner/condition to remove it; `accepted` applies only to the stated verified scope.
- A local pass, remote publication, hosted CI, independent review, human approval and outcome benefit are separate facts.
- Archived unchecked items remain unresolved. Old publication blockers and test results are dated history, not current observations.
- Preserve historical records and existing safety boundaries. Do not claim production readiness or outcome support without the required real evidence and approval.
