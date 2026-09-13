# Agent and Developer Operating Rules

This repository is governed by [the development workflow](docs/development-workflow.md).
These rules apply to human contributors and coding agents.

## Operating Rules

1. Read this file, `tasks/README.md`, the active plan, the active checklist, and any relevant ADR/status entry before editing.
2. Do not infer completion from code presence. Every behavior change needs an explicit acceptance criterion and a verification command.
3. For non-trivial work, write or update the plan before implementation. For bug fixes and new behavior, write a failing test first unless the change is documentation/configuration only.
4. Preserve user changes in a dirty worktree. Inspect and work around them; never reset or discard them.
5. Keep runtime state, triage dumps, model transcripts, and temporary reports under `.agent_workspace/` unless they are intentionally promoted into `docs/` or `tasks/`.
6. Record important decisions, blockers, verification results, and deferred risks in the repository during the same work session. Chat is not the system of record.
7. Treat `docs/status-matrix.md`, accepted ADRs, and the active task files as contracts. If implementation and documentation disagree, stop and resolve the discrepancy before claiming completion.
8. Do not mark a human or experimental gate complete from unit tests alone. Link the decision package and the exact evidence.
9. Keep changes minimal and file-disjoint when possible. Frozen CLI/event/JSON contracts require both implementation review and pinning-test review.
10. Before delivery, run the smallest relevant focused check and then the applicable gate. Report exact commands and outcomes, including skips or failures.

## Required Evidence

Every completed task must leave enough information for another contributor to resume without the conversation:

- scope, non-goals, and acceptance criteria;
- files/symbols changed and compatibility or privacy risks;
- focused tests and the full gate when required;
- unresolved questions, blockers, and explicit follow-up owner/condition;
- links to the plan, decision record, report, or status row that was updated.

Use [the task plan template](docs/templates/task-plan.md) and [the verification template](docs/templates/verification-record.md) for new work. Run `pnpm workflow:check` before delivery.

## Test and Delivery Policy

- Default local merge gate: `pnpm gate`.
- Release/preview gate: `pnpm prerelease`.
- Real provider, crash, benchmark, and holdout runs are opt-in and must say so in their evidence record.
- A self-report is not independent verification. Distinguish implementation outcome, command verification, independent review, and human approval.
- Never claim "done", "fixed", or "passing" without current command output in the repository record or delivery description.
