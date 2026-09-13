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
