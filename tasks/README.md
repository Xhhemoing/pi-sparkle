# Task Management

Start with the [active plan](plan.md), [open checklist](todo.md) and generated [STATUS](../STATUS.md). A/B/C host integration, policy provenance and static write routing are explicitly authorized; the PR #68 integration with main 9f883e41 has human conflict-review approval; current-head CI and delivery are tracked in that PR. Main includes PR #69's bounded single-task tool/deadline fixes and four-run comparison; its limited successful cost/quality results do not establish general superiority. Earlier short/large-task results and unfinished owner decisions remain in the plan and PRs #65-#67. Original Soul application, D/E, other P4/P5, controller expansion and adaptation/learning remain outside this scope; the broader 15-task evaluation is unfinished.

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
