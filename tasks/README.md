# Task Management

Start with the [active plan](plan.md), its [confirmed Phase 1 order](plan.md#owner-approved-sequence-and-next-acceptance-2026-10-24), [unfinished checklist](todo.md) and [ADR-010](../docs/decisions/0010-evidence-bound-changes.md). The active plan records the effective workspace, owner authorization and candidate-specific evidence. Operating guides do not pin the current phase or repeat volatile PR/job summaries.

## Authoritative Files

- [`plan.md`](plan.md): scope, next usable result, dependencies, acceptance, decisions, retained failures and handoff links.
- [`todo.md`](todo.md): unfinished work only, at most 25 lines, ordered by the next usable result.
- [`migration-todo.md`](migration-todo.md), [`adaptive-plan.md`](adaptive-plan.md) and [`adaptive-todo.md`](adaptive-todo.md): retained historical details and constraints; old next steps do not dispatch current work or lift freezes.
- [Previous plan](archive/2026-10-21-pre-integration-plan.md) and [checklist](archive/2026-10-21-pre-integration-checklist.md): unresolved earlier duties and historical evidence.
- [Status matrix](../docs/status-matrix.md): scoped capability claims; [generated STATUS](../STATUS.md): generation-time observations, not authorization.

## Required Task Record

For non-trivial implementation, use the existing plan and [template](../docs/templates/task-plan.md) to name the user result, scope/non-goals, dependencies/write ownership, observable acceptance, risks and relevant commands. A short or read-only task needs no new plan/report. Prioritize an actual public-entry flow over a backlog of completed but unintegrated components.

Put exact command outcomes and necessary independent review in the PR using the [verification template](../docs/templates/verification-record.md); detailed logs stay in CI/private `.agent_workspace/`. Keep necessary links and next actions in the active plan. Do not create per-slice or receipt-only records.

## State Rules

- `[ ]` is unfinished; remove completed items only after their results are recorded. Archived unchecked work remains unresolved.
- `blocked` names the actual missing condition; `accepted` applies only to its verified scope. Do not infer authorization, cost coverage or successful recovery from historical JSON, source inspection or a green check.
- Implementation, focused checks, complete verification, remote CI, independent review, owner adoption and outcome benefit are separate facts. Preserve failures/skips/unknowns and candidate identities.
- Preserve original Soul/private evidence, the old 15-task evaluation and earlier safety duties. Paid runs, publication, main merge and frozen learning/general orchestration retain their existing boundaries.
- Reuse still-applicable evidence and stop unchanged repeated checking; later changes require affected verification and applicable existing complete delivery checks. Current exit conditions cannot be reduced to make a phase appear complete.
