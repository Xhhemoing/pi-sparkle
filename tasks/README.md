# Task Management

This directory contains the active execution state. Historical plans and accepted slices belong under `tasks/archive/`.

## Authoritative Files

- [`plan.md`](plan.md): active scope, dependencies, and links to detailed plans.
- [`todo.md`](todo.md): current checklist, human gates, and completion evidence.
- [`adaptive-plan.md`](adaptive-plan.md): detailed adaptive-loop contract and remaining implementation constraints.
- [`adaptive-todo.md`](adaptive-todo.md): adaptive-loop checklist and acceptance notes.

When these files appear inconsistent, do not silently choose a checkbox. Resolve the conflict in `docs/status-matrix.md`, an accepted ADR, or a dated report, then update both active task files and link the evidence.

## Required Task Record

Every new task or slice records:

- ID and owner;
- problem, scope, and non-goals;
- acceptance criteria;
- exact files/symbols and dependencies;
- test-first plan and verification commands;
- risks, human gates, and rollback/abort condition;
- current state: `planned`, `in-progress`, `blocked`, `ready-for-review`, `accepted`, or `archived`;
- last verified commit/date and evidence links.

Use [`docs/templates/task-plan.md`](../docs/templates/task-plan.md) for detailed work and [`docs/templates/verification-record.md`](../docs/templates/verification-record.md) for closeout evidence.

## State Rules

- `[ ]` means not accepted, even if code exists.
- `[x]` requires a dated evidence link or command result beside the item.
- `blocked` requires a reason and the condition that removes it.
- `accepted` means the stated acceptance criteria passed; it does not imply production readiness or outcome support.
- Do not rewrite historical records to make old claims look current; add a dated correction.

## Report-driven slices (2026-09-27)

`TASK-20260927-report-improvements`: [original plan](../docs/superpowers/plans/2026-09-27-report-driven-improvements.md), [dedicated checklist](report-improvement-todo.md), and [historical A1/A2 verification](../docs/reports/2026-09-27-report-improvements.md).

`TASK-20260927-report-continuation`: [staged A0-root/B1 plan](../docs/superpowers/plans/2026-09-27-report-continuation.md), [current verification and handoff](../docs/reports/2026-09-27-report-continuation.md), and [native contract usage](../docs/native-task-contract.md). Runtime head `a1c32daa` passed the full hosted quality job and both Windows/Linux smoke and focused root/contract jobs. The earlier no-hosted-verification/Windows-blocked snapshot is superseded by this dated evidence, not retroactively rewritten. New independent review, main merge, remaining reliability ownership, host-outcome/production gates and the rest of the A-E roadmap remain open. This is not acceptance of all Stage A or Stage B.
