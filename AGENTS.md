# Agent and Developer Operating Rules

Use the [development workflow](docs/development-workflow.md) and [ADR-010](docs/decisions/0010-evidence-bound-changes.md). pi-sparkle targets evidence-bound changes for Pi. Phase 0 is authorized; current runtime capabilities and outcome claims remain limited to actual evidence.

## Operating Rules

1. Read this file, `tasks/README.md`, the active plan/checklist, and only relevant ADR/status entries before editing.
2. Follow the active Phase 0 plan: reconcile current delivery, implement the accepted direction, verify Pi compatibility, then unify the worker and separate research dependencies. Freeze new general-purpose scheduler/durability and lab features; safety and compatibility maintenance remain allowed. Preserve original Soul and synthetic-only/private-evidence boundaries. Keep the old 15-task evaluation and unresolved safety duties; do not infer main merge, npm release or paid-model authorization.
3. Every behavior change needs observable acceptance criteria and a verification command. For non-trivial work update `tasks/plan.md` before implementation; bug fixes and new behavior require a failing test first, except documentation/configuration changes.
4. Preserve user changes; never reset, discard or overwrite another contributor's work. Assign disjoint write paths to agents and serialize shared changes and full gates.
5. Keep runtime state, transcripts, triage dumps and temporary logs in `.agent_workspace/`. Do not commit credentials or unredacted private data.
6. Put validation commands/results in the PR description and CI artifacts. Record scope, decisions, blockers and remaining work in the existing active task files; do not create per-slice Markdown reports or receipt-only commits such as `docs: record receipt`.
7. Keep `tasks/todo.md` within 25 lines, with only unfinished work. Retain unresolved obligations and safety/decision evidence. Completed redundant reports may be removed under the owner's cleanup authorization after checking dependencies; redirect necessary references to published Git history. Do not add routine reports to `docs/reports/`.
8. Accepted ADRs, scoped status-matrix claims and existing safety/authorization boundaries remain binding. Resolve discrepancies before claiming completion; simplify process without removing safety measures.
9. Human and experimental approval cannot be inferred from tests. Frozen CLI/event/JSON changes require implementation and pinning-test review. Agent-authored conflict resolutions require the existing human conflict-hunk review.
10. Run the smallest relevant check and applicable existing gate. A candidate is not delivered until its remote branch and current green CI exist. [STATUS](STATUS.md) is generated; do not hand-edit it or treat it as an approval decision.

## Required Evidence

Use the [task plan template](docs/templates/task-plan.md) as a compact checklist within the active plan. Use the [verification template](docs/templates/verification-record.md) in the PR description; a separate report is not required. Include scope/non-goals, acceptance criteria, changed files, compatibility/privacy risks, exact commands and outcomes, independent review for complex cross-module, authorization, security and data-correctness changes, and unresolved owner/condition. Existing human conflict-hunk review remains mandatory. CI artifacts hold detailed logs. Preserve durable links in the active plan when needed for handoff; chat alone is insufficient. Run `pnpm workflow:check` before delivery.

## Test and Delivery Policy

- Default local merge gate: `pnpm gate`; release/preview gate: `pnpm prerelease`.
- Real provider, crash, benchmark and holdout runs remain opt-in; record their actual scope and results. The authorized Soul test-version pilot does not waive existing authorization or data boundaries, or authorize changes to original Soul, live data, installation or release.
- Distinguish implementation, command verification, independent review and human approval. Failed, skipped and not-run checks are explicit; local success does not prove hosted CI or outcome benefit.
- Never claim done, fixed or passing without current command output in the PR, CI artifacts or delivery description.
- Do not add hashes, frozen contracts, baselines or gates by default. Existing safety measures remain. Any proposed new mechanism needs a concrete failure that Git, versions, keys, transactions, uniqueness, types and ordinary tests cannot adequately address; gates belong only at irreversible, cross-system, security or formal-release boundaries.
