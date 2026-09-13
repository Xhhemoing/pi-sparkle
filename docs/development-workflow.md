# Development Workflow

This document is the project-level process for planning, implementing, testing, reviewing, and preserving development knowledge. It is intentionally compatible with the existing event-log, ADR, status-matrix, holdout, and privacy practices.

## 1. Intake and Classification

Before code changes, capture the request in the active task record or a dated plan under `docs/superpowers/plans/`:

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
4. focused implementation reports under `docs/reports/`;
5. `docs/agent-progress.md` and `docs/agent-decisions.md` for historical decisions and loop notes;
6. chat, scratch notes, and generated graphs are not authoritative.

Update the appropriate repository record immediately when a decision, blocker, test result, or scope change occurs. Use `.agent_workspace/` for high-volume temporary material and promote only the conclusion and evidence links into tracked docs. Do not put secrets, raw credentials, or unredacted user data in tracked records.

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

The final record must distinguish pass, fail, skipped, not-run, and not-applicable. Include environment, commit, and command output summary. A green local test run does not close a human policy gate.

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

At closeout, update the active checklist and one durable record: a report, decision, progress entry, or status-matrix row. State what remains open. Archive completed plans rather than deleting them. The next contributor should be able to identify the current task, next command, blockers, and evidence links without reading the chat transcript.

## 8. Process Health

Review this workflow when any of these occur: repeated test regressions, contradictory status claims, lost decisions, untracked agent output, a failed gate without a recorded cause, or a new execution/security boundary. Improve the process with a small documented change and a regression check where feasible.
