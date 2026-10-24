# Task Management

Start with the [active Phase 1 plan](plan.md#phase-1-language-initialization-and-execution-examples-2026-10-24), [open checklist](todo.md), [ADR-010](../docs/decisions/0010-evidence-bound-changes.md) and generated [STATUS](../STATUS.md). The owner authorized PR #77's merge and Phase 1 continuation; main contains it as 2f87ca31. Draft [PR #78](https://github.com/Xhhemoing/pi-sparkle/pull/78) now integrates TaskSpec, preflight/init, shared scope and fixed checks, bounded repair/time pools and four installed Windows language examples. Current complete acceptance and remaining Phase 1 work are tracked in the active plan; focused or predecessor passes do not close the phase. #68 remains separate, #72 remains deferred lab work, and old A-F safety duties and the 15-task comparison remain unresolved. Preserve original Soul and private evidence; paid providers, publication and another main merge keep their separate authorization boundaries.
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
