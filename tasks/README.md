# Task Management

Start with the active plan's [current execution checkpoint](plan.md#current-execution-checkpoint-2026-10-26), then the [unfinished checklist](todo.md) and the relevant [real-task stage](plan.md#real-task-improvement-loop-2026-10-25). Check the actual branch/HEAD, dirty paths and relevant live PR before dispatching work from that checkpoint. [ADR-010](../docs/decisions/0010-evidence-bound-changes.md) and [ADR-011](../docs/decisions/0011-real-task-improvement-loop.md) define the accepted boundaries. The active plan records owner authorization and candidate-specific evidence; dated review totals and old next-action paragraphs are retained evidence, not a second dispatch queue. Operating guides do not pin the current phase or repeat volatile PR/job summaries.

## Authoritative Files

- [`plan.md`](plan.md): scope, next usable result, dependencies, acceptance, decisions, retained failures and handoff links.
- [`todo.md`](todo.md): unfinished work only, at most 25 lines, ordered by the next usable result.
- [`migration-todo.md`](migration-todo.md), [`adaptive-plan.md`](adaptive-plan.md) and [`adaptive-todo.md`](adaptive-todo.md): retained historical details and constraints; old next steps do not dispatch current work or lift freezes.
- [Previous plan](archive/2026-10-21-pre-integration-plan.md) and [checklist](archive/2026-10-21-pre-integration-checklist.md): unresolved earlier duties and historical evidence.
- [Status matrix](../docs/status-matrix.md): scoped capability claims. Run `pnpm status` to generate ignored local `STATUS.md`; CI snapshots are in the existing quality/CLI Actions artifacts (see [retrieval](plan.md#retained-evidence-and-unfinished-obligations)). Neither snapshot grants authorization.

- [Phase 1 evidence](../docs/evidence/phase1-exit.md) and [older plan archive](archive/2026-10-25-pre-maintenance-plan.md): retained traceability, failures, historical decisions and unfinished obligations; read relevant sections rather than treating old next actions as current.

## Required Task Record

For non-trivial implementation, use the existing plan and [template](../docs/templates/task-plan.md) to name the user result, scope/non-goals, dependencies/write ownership, observable acceptance, risks and relevant commands. A short or read-only task needs no new plan/report. Prioritize an actual public-entry flow over a backlog of completed but unintegrated components.

Put exact command outcomes and necessary independent review in the PR using the [verification template](../docs/templates/verification-record.md); detailed logs stay in CI/private `.agent_workspace/`. Keep necessary links and next actions in the active plan. Do not create per-slice or receipt-only records.

## State Rules

- `[ ]` is unfinished; remove completed items only after their results are recorded. Archived unchecked work remains unresolved.
- `blocked` names the actual missing condition; `accepted` applies only to its verified scope. Do not infer authorization, cost coverage or successful recovery from historical JSON, source inspection or a green check.
- Implementation, focused checks, complete verification, remote CI, independent review, owner adoption and outcome benefit are separate facts. Preserve failures/skips/unknowns and candidate identities.
- Preserve original Soul/private evidence, the old 15-task evaluation and earlier safety duties. Paid runs, publication, main merge and frozen learning/general orchestration retain their existing boundaries.
- Reuse still-applicable evidence and stop unchanged repeated checking; later changes require affected verification and applicable existing complete delivery checks. Current exit conditions cannot be reduced to make a phase appear complete.
