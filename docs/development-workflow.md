# Development Workflow

This document is the project-level process for planning, implementing, testing, reviewing, and preserving development knowledge. It is intentionally compatible with the existing event-log, ADR, status-matrix, holdout, and privacy practices.

## 1. Intake and Classification

Before code changes, update the existing `tasks/plan.md`; a separate dated plan or slice report is not required. Integration and completed-document cleanup are merged. The current step is a matched direct-Pi/pi-sparkle comparison on a real task in Soul's isolated test version. Keep original Soul code/data untouched and use synthetic inputs. Record the task, input, model, permissions, run order, acceptance and measurement boundaries before execution; retain failures and distinguish shared preparation, model execution and later review/rework. One pair does not complete the broader evaluation. P4/P5 and new experiments/adaptation/learning features stay frozen until an explicit owner decision based on comparative evidence. Safety maintenance remains allowed. Capture:

- problem and user outcome;
- in-scope and explicitly out-of-scope behavior;
- affected planes/modules and frozen contracts;
- acceptance criteria written as observable behavior;
- risks: persistence, concurrency, privacy, compatibility, cost, or experiment validity;
- verification commands and human gates.

Classify the work as one of: bug fix, feature, refactor, documentation/process, experiment, or release. Bug fixes and behavior changes require a regression test plan. Experiments require a pre-registered question, eligibility rules, and an evidence-retention plan.

## 2. Source of Truth and Persistence

Use sources in this order when records disagree:

1. accepted ADR/spec and explicit owner decision;
2. `docs/status-matrix.md` for present/wired/exercised/outcome-supported status;
3. `tasks/plan.md` and `tasks/todo.md` for active scope and checklist status;
4. current PR verification summaries and CI artifacts; `docs/reports/` is an archive of historical evidence;
5. `docs/agent-progress.md` and `docs/agent-decisions.md` for historical decisions and loop notes;
6. chat, scratch notes, and generated graphs are not authoritative.

Update the existing active plan when scope, decisions or blockers change. Record exact validation results in the PR description and CI artifacts, with only necessary handoff links in the plan. Use `.agent_workspace/` for temporary logs. Do not put secrets, raw credentials or unredacted user data in tracked records or uploaded artifacts. Generated `STATUS.md` summarizes repository observations; it does not infer authorization, current CI success or outcome benefit.

## 3. Plan Before Implementation

A plan must name the files/symbols, dependencies, acceptance criteria, test cases, and verification commands. Split work into independently reviewable slices. For concurrent or agent-assisted work, assign disjoint file ownership and require each slice to report:

- changed files and contract impact;
- tests added or updated;
- command output and known skips;
- unresolved risks and follow-up conditions.

If implementation reveals a new invariant or a changed public contract, pause and update the plan/ADR before continuing.

## 4. Test-First Implementation

For new behavior or a bug fix:

1. write one focused failing test that demonstrates the desired behavior;
2. run it and confirm the failure is for the intended reason;
3. implement the smallest change;
4. rerun the focused test and relevant neighboring tests;
5. refactor only while green.

Test layers:

- unit: pure rules, parsers, reducers, serializers, and error classification;
- integration: persistence, CLI, adapter, privacy, lifecycle, and cross-module contracts;
- acceptance: whole-checkpoint scenarios, independent evidence, holdout eligibility, and human gates;
- probes: built artifact, security, compatibility, crash, benchmark, or release-specific checks.

Do not replace a real behavior assertion with a mock assertion. Do not treat skipped opt-in provider/crash tests as passing evidence.

## 5. Verification Gates

Choose the smallest sufficient check, then expand according to risk:

| Change | Minimum verification | Delivery gate |
|---|---|---|
| Docs/templates only | `pnpm workflow:check` | targeted link/content review |
| Pure logic | focused unit test + typecheck | `pnpm gate` |
| CLI/persistence/lifecycle | focused unit and integration tests | `pnpm gate` plus relevant probe |
| Privacy/security/adapter | focused tests | `pnpm gate`, `pnpm security:probe`, `pnpm pi:probe` |
| Experiment/holdout | pre-registration and eligibility tests | dedicated evidence package; keep live adaptation off until gate closes |
| Preview/release | full gate and probes | `pnpm prerelease` |

The PR verification summary must distinguish pass, fail, skipped, not-run and not-applicable. Include environment, commit, commands and results; link CI artifacts for detailed output, including failed runs. A green local test run does not close a human policy gate. Preserve existing checks; do not add a gate merely to enforce reporting format.

## 6. Review and Delivery

Before merge:

- inspect the final diff, including generated or deleted files;
- check for conflict markers, accidental secrets, and untracked work artifacts;
- review frozen surfaces against their pinning tests;
- ensure status/checklist wording matches the evidence;
- complete the PR template and include gate output;
- document any accepted risk, deferred work, or follow-up trigger.

Agent-authored or auto-resolved changes require line-by-line human review of conflict hunks. Never report an independent review that did not actually occur.

## 7. Closeout and Handoff

At closeout, put verification and review results in the PR description and CI artifacts. Remove completed work from `tasks/todo.md`, keep it within 25 lines, and leave the next action plus necessary PR links in `tasks/plan.md`. Do not create per-slice reports or receipt-only commits such as `docs: record receipt`. Keep historical evidence and unresolved obligations; owner-authorized deletion of completed redundant reports must preserve necessary references through published Git history. Generate STATUS after updating the checklist; its commit is a generation-time observation, not a completion claim. A pi-sparkle candidate is delivered only when its remote branch and current green CI exist. Soul's isolated trial does not authorize committing, publishing or applying changes to the original project. The next contributor must be able to resume from the active plan and PR without reading chat history.

## 8. Process Health

Review this workflow when any of these occur: repeated test regressions, contradictory status claims, lost decisions, untracked agent output, a failed gate without a recorded cause, or a new execution/security boundary. Improve the process with a small documented change and a regression check where feasible.
