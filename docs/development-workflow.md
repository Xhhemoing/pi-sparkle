# Development Workflow

Use this workflow for project-specific planning, integration, verification and delivery. General collaboration rules live in AGENTS; current scope and owner decisions live in `tasks/plan.md` and accepted ADRs. Historical plans, archived reports and generated STATUS do not authorize execution.

## 1. Intake and Classification

Confirm the effective workspace, branch, relevant existing changes and active plan before implementation. Read only the sources needed for the next result. Classify the work as analysis, documentation/process, behavior change, experiment or release; apply checks for that scope rather than every workflow step to every request.

For non-trivial implementation, update the existing plan with the user outcome, scope/non-goals, next usable end-to-end result, dependencies, observable acceptance, affected paths and relevant verification. Reuse the [plan template](templates/task-plan.md) as a content guide, not a new form or per-slice file. Read-only questions need no implementation plan or runtime gate.

Preserve original Soul, synthetic/private-evidence boundaries, frozen capabilities and all unresolved safety duties. Existing paid-provider, crash, benchmark, holdout, installation, release and main-merge authorization remains separate. Register any authorized experiment's inputs, model, permissions, order, independent acceptance and measurement boundary before running it.

## 2. Source of Truth and Persistence

Resolve conflicts using accepted ADR/spec and explicit owner decisions, current plan/checklist for authorized scope, actual candidate/source/PR/CI for execution facts, and `docs/status-matrix.md` for scoped capability claims. A dated capability row cannot erase newer observed failures; tests cannot grant approval. Resolve discrepancies in existing authoritative records before claiming completion.

Keep current phase and next action in the active plan, unfinished work in `tasks/todo.md` (at most 25 lines), and exact validation/review in the PR and CI artifacts. Generated STATUS is an ignored local snapshot: run `pnpm status`. CI generates `.agent_workspace/ci/STATUS.md` and includes it in existing quality/CLI job artifacts; see [retrieval guidance](../tasks/plan.md#retained-evidence-and-unfinished-obligations). A fresh checkout does not require this file. Private logs, transcripts and triage belong in `.agent_workspace/`; no credentials or unredacted private data in Git or uploaded artifacts.

## 3. Plan Before Implementation

Choose the next result along the actual user flow, including its public entrypoint and integration dependencies. Build the required components toward that result; run the real seam early rather than leaving integration until every component is complete. A first usable path does not remove the phase's error, recovery, compatibility or safety exits.

Assign disjoint write ownership and explicit dependencies. Share only necessary context; serialize shared interfaces, schema/lock files, authorization and transactions. The coordinator integrates completed work before growing the implementation queue and alone schedules full builds/gates/packages.

Review high-risk seams early: authority, source/candidate identity, settlement, remaining budgets and recovery. Findings that violate existing acceptance, compatibility or safety are repairs; unrelated improvements return to existing deferred work. If a public contract or authorization must change, update the relevant plan/ADR and obtain the applicable owner decision before crossing that boundary.

## 4. Test-First Implementation

For a behavior change or bug fix, demonstrate the intended failure, make the smallest repair, then run its regression and affected neighboring checks. Preserve actual behavior assertions; mocks or startup smoke do not replace execution. Documentation and instruction edits use content/structural checks rather than invented runtime regressions.

When blocked, state a testable cause and choose the smallest experiment that distinguishes it. If the next retry cannot add evidence, retain the failure, unknown cause and condition for resumption, then advance independent authorized work. Rerun after an actual fix or changed condition; a focused pass does not erase a failed full run.

## 5. Verification Gates

Choose verification from changed behavior and risk; retain existing required checks:

| Change | During implementation | Integrated delivery verification |
|---|---|---|
| Docs/templates/skill instructions | workflow/diff, relevant content/links and changed skill validator | targeted review and current remote CI; no local runtime gate solely for prose |
| Pure logic | failing regression, focused units and typecheck | hosted CI complete suite |
| CLI/persistence/lifecycle | actual affected entrypoints and integration/negative cases | hosted CI; safety core (scope, candidate/apply/discard, Ledger, budgets, cancellation) also one serial `pnpm gate` and relevant probe |
| Real-task run (ADR-011) | registered task, budget, isolated copy for Soul | private task record; aggregated statistics at review |
| Privacy/security/adapter | boundary regressions and relevant independent review | `pnpm gate`, `pnpm security:probe`, `pnpm pi:probe` |
| Experiment/holdout | authorized preregistration, eligibility and actual observations | existing dedicated evidence; self-optimization only within the ADR-011 loop |
| Preview/release | applicable complete checks and probes | `pnpm prerelease` and separate release authority |

Run inexpensive relevant type, lint and boundary checks before an expensive complete run. Schedule the complete run when the intended integration is ready; a failing integrated candidate still needs its required complete revalidation after repair. Do not restart a full run for every small edit or treat a run of an older candidate as validation of later changes.

Reuse evidence only when the candidate, checked inputs, environment and coverage still apply. A new change, failure or unresolved concern determines what to rerun. Never stitch focused checks into a complete gate claim or weaken protected checks to manufacture green. Keep one full build/gate/package at a time and preserve shared dependencies while it runs.

PR results identify candidate/environment, exact commands, pass/fail/skipped/not-run/not-applicable, inherited failures and artifact links. Preflight is not runtime success; green tests or CI do not close human or experiment approval.

## 6. Review and Delivery

Complex cross-module, authorization, security and data-correctness changes require independent read-only review of the actual candidate/diff. Reviewers report concrete defects and counterexamples, without making unrelated product expansion a blocker. After a repair, verify the original counterexample and review affected changes when needed; no fixed rounds of unchanged whole-repository review.

Inspect final scope for accidental private data, conflict markers, generated artifacts and frozen-surface changes; use required pinning-test review. Agent-authored conflict resolutions still require line-by-line human conflict-hunk review before commit/push. Never invent an independent review or infer human adoption from green.

## 7. Closeout and Handoff

Close only the agreed scope after its acceptance and required review. Keep remaining phase exits, failed/unknown evidence and owner decisions explicit. Exact commands/results belong in the PR/CI; update the existing plan, remove only completed checklist entries, and generate STATUS with `pnpm status`. No per-slice reports, receipt-only commits or automatic history deletion; owner-authorized cleanup must check dependencies and preserve needed Git-history references.

A delivered candidate has its remote branch and current green CI; retain a failed or missing CI condition rather than calling it delivered. Main merge, release and original Soul application keep their existing authorization. Leave the next executable action and necessary evidence links so another session can resume without replaying completed effects or reading chat history.

## 8. Process Health

Improve this workflow only for a concrete recurring failure or material risk. Prefer correcting stale guidance, execution timing, ownership or integration order before adding mechanisms. Use existing Git/CI/plan evidence to observe time to the first usable flow, late integration defects, avoidable complete reruns and manual rework. Do not claim a speedup or infer skill use from counts or missing telemetry; validate proposed benefits in actual subsequent work.
