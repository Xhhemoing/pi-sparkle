# Active implementation plan

## pi-sparkle integration and lean delivery (2026-10-21)

Delivery: [integration PR #62](https://github.com/Xhhemoing/pi-sparkle/pull/62); current verification and remaining conflict-hunk review live in that PR. PR #61 is merged; main protection and six merged-branch deletions are complete.

Owner: repository maintainer, with the coordinating agent responsible for integration. State: in-progress. This session focuses on pi-sparkle branch integration, hosted CI and workflow reduction; it does not start an AIstudy audit or run. pi-sparkle is an internal tool for developing AIstudy; comparative benefit on its real backlog determines further investment. Package publication remains private.

Sequence: integrate existing branches and verify hosted CI, run a paired 15-task AIstudy comparison, then optimize only the path that earns its maintenance cost. P4/P5 and new experiments/adaptation/learning runtime features are frozen until the A/B decision. Existing safety maintenance remains allowed; existing authorization, privacy, containment and experimental conditions remain in force. Hotspot splitting follows the A/B decision, rather than expanding the integration batch.

## PR #62 batch failure follow-up (2026-10-21)

Current scope: independently review the actual conflict resolutions, reproduce the first Ubuntu fake-batch failure, then fix only a demonstrated cause and validate before merge. The previous green run does not establish a cause or fix. Owner: coordinator; independent conflict and root-cause reviewers. No AIstudy work or new runtime scope.

Acceptance: a Linux execution records structured failure/process evidence; a regression fails before the correction and passes afterward; existing process cleanup, cancellation and unknown-effect refusal tests remain intact; current Ubuntu/Windows CI and applicable probes pass. Inspect source-mode `recipe-check`, `command-runner`, batch CLI and their focused tests; use an isolated diagnostic branch for Linux experiments if needed. Keep raw logs under `.agent_workspace/` or Actions; update this PR, not a new report. Existing human conflict-hunk review remains distinct from agent review.

Follow-up finding: Ubuntu reproduced a successful checker (`exitCode: 0`, accepted recipe JSON) being rejected because a process-group probe briefly succeeded just before the group disappeared. [Regression RED](https://github.com/Xhhemoing/pi-sparkle/actions/runs/39615374587) had 11 existing runner tests pass and 3 new tests fail. [Focused GREEN](https://github.com/Xhhemoing/pi-sparkle/actions/runs/39615897895) had 14/14 runner tests, 30/30 cold checkers, the 11-test batch suite and 8 fresh-copy batch executions pass. The runner now waits at most the existing 250 ms grace for observed group disappearance while retaining abort/deadline and persistent-descendant refusal. Independent review found no concrete safety defect; an additional close-phase deadline regression covers its identified validation gap in the final candidate. The original first CI omitted structured stdout, so its exact historical failure is not provable; no claim identifies the transient process as esbuild. Full current-head CI and the existing human conflict-hunk review still precede merge.
## Scope and acceptance

- Integrate PR #61, then continuation onto main; publish a replacement PR with Ubuntu and Windows CI, supersede #60, protect main and remove only fully merged inactive branches. Remote publication and current green CI are required before calling an integrated candidate delivered.
- Follow-up after this integration: compare direct Pi with pi-sparkle on 15 real AIstudy backlog tasks using completion, elapsed time, token/cost coverage, interventions and rework. Preserve identical starting task inputs and acceptance criteria; unknown cost is not zero. Do not claim benefit from fake executors or local unit tests.
- Replace per-slice reports with PR verification summaries and CI artifacts. Keep this plan and the checklist as the active handoff; preserve historical links and unresolved obligations. Generate [STATUS](../STATUS.md) from observable repository state without inferring human approval or outcome support.
- Keep `tasks/todo.md` within 25 lines and limited to open work. Retire receipt-only reporting and `docs: record receipt` commits. Existing reports become a read-only archive at their original paths.

## Files, implementation and verification

Process edits: `AGENTS.md`, `docs/development-workflow.md`, task entry points, PR/template text, and `docs/reports/README.md`. Historical plan/checklist content is retained in the linked archives below with relocated relative links. `docs/status-matrix.md` and `tasks/migration-todo.md` receive a current-direction notice; historical capability claims are not silently changed. STATUS generation and CI evidence collection are independently owned implementation work.

Documentation acceptance: `pnpm workflow:check`, `git diff --check`, a relative-link audit, and confirmation that the active checklist has at most 25 lines. Script/CI acceptance: focused regression tests then the applicable existing `pnpm gate`, coordinated once by the main agent. Record exact outcomes and current revision in the PR, with logs in CI artifacts; failed, skipped and not-run checks remain explicit. No new gate, hash or baseline is added.

Non-goals for this session: AIstudy auditing or task execution, new runtime features, npm publication, automatic adaptation, production apply authorization, or claiming the A/B has run before real task results exist. Stop or defer dependent work when integration/CI fails, required experimental scope is unavailable, or a safety condition remains unresolved. Repository owner selects the retained path after measured results.

## Retained obligations and history

The [previous plan](archive/2026-10-21-pre-integration-plan.md) and [previous checklist](archive/2026-10-21-pre-integration-checklist.md) preserve the full earlier record. Their unchecked items are not closed by archival. F6 custody/holdout, S0-min, R10/R11 evaluator/apply review, PR #36 independent artifacts, platform containment, privacy, and production approvals remain unresolved where previously unresolved. Their implementation roadmap is paused behind the current comparison, except necessary safety maintenance. Historic publication blockers describe their original attempts; current delivery is determined by the replacement PR and its CI.

Current migration details remain in [migration-todo](migration-todo.md); [status-matrix](../docs/status-matrix.md) retains scoped capability and human-policy limits. New verification results belong in the integration PR and its artifacts, not another dated report.
