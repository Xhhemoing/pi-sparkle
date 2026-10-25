# Agent and Developer Operating Rules

Use the [development workflow](docs/development-workflow.md) and accepted [ADR-010](docs/decisions/0010-evidence-bound-changes.md). pi-sparkle provides evidence-bound changes for Pi. Current scope, phase and remaining exits live in [tasks/plan.md](tasks/plan.md), not in this file.

## Operating Rules

1. At start or recovery, identify the effective workspace, branch and relevant dirty paths; read `tasks/README.md`, the active plan/checklist and only relevant ADR/status entries. Historical plans and another worktree's results do not dispatch current work.
2. Organize implementation around the next usable end-to-end result and its dependencies. Integrate the public entrypoint early; a scripted demo or component pass does not satisfy the phase's remaining exits. Fix findings that violate agreed acceptance, compatibility or safety; put unrelated enhancements in existing deferred work.
3. Record non-trivial implementation scope, observable acceptance and commands in the existing plan before editing. Behavior changes and bug fixes require an intended failing test first; documentation/configuration changes use relevant content checks.
4. Preserve other contributors' changes. Give agents disjoint write paths and serialize shared interfaces, dependencies and full checks. The coordinator owns the next integration result; integrate or review waiting work before adding more implementers.
5. Preserve exact candidate/checker evidence, protected paths, fresh source verification, explicit accept/apply separation, cumulative budgets, cancellation, settlement and refusal on unknown effects. Human conflict-hunk review and frozen CLI/event/JSON implementation/pinning-test review remain required.
6. Original Soul stays protected; use authorized isolated synthetic inputs only. Keep runtime state, transcripts and temporary logs in `.agent_workspace/`; never commit credentials or unredacted private data. Paid-provider, crash, benchmark, holdout, installation, release and main-merge boundaries retain their separate authorization.
7. Accepted ADRs and scoped status-matrix claims remain binding. New general scheduler/durability, P4/P5 and experiments/adaptation/learning features remain frozen unless explicitly authorized under their existing conditions; safety/compatibility maintenance remains allowed. Keep the old 15-task comparison and unresolved safety duties visible.
8. Use existing plans, PR verification and CI artifacts. Keep `tasks/todo.md` within 25 lines and unfinished-only; no per-slice reports or receipt-only commits. Remove redundant historical material only under cleanup authority, checking dependencies and preserving necessary links to published Git history.

## Required Evidence

Use the [plan template](docs/templates/task-plan.md) as a compact content guide within the existing plan, omitting irrelevant fields. Record scope/non-goals, next usable result, dependencies, acceptance, risks and unresolved owner/condition. Put exact commands, outcomes and required independent review in the PR using the [verification template](docs/templates/verification-record.md); detailed logs stay in CI artifacts or private workspace. Keep only necessary handoff links in the plan.

Resolve conflicting current claims before completion. Distinguish implementation, focused verification, complete acceptance, hosted CI, human adoption, release and demonstrated benefit. Retain failed, skipped, not-run and unknown results; local or hosted green cannot supply approval. Run `pnpm status` to generate ignored local `STATUS.md`; it is an observation, never authorization. CI also uploads a generation-time snapshot in its existing job artifacts.

## Test and Delivery Policy

- Use change-focused tests and existing boundary checks during implementation; run complete checks at an integrated milestone. Reuse same-candidate evidence when inputs, environment and coverage still apply and no new concern exists. Later changes require impact-based revalidation; focused results cannot be combined into a full acceptance claim.
- Documentation/templates/skill instructions use `pnpm workflow:check`, `git diff --check`, relevant links/content checks and any changed skill validator. Runtime-affecting configuration follows runtime risk. Do not run a local full runtime gate merely for documentation.
- Runtime default local merge gate remains `pnpm gate`; preview/release gate remains `pnpm prerelease`, with applicable existing probes. Only one full build/gate/package runs at a time; no dependency mutation during another candidate's validation.
- Complex cross-module, authorization, security and data-correctness changes require independent read-only review; review high-risk seams early and recheck affected fixes. Stop repeated full scans when there is no new finding or candidate change.
- Before delivery run `pnpm workflow:check`, inspect the actual diff and verify the remote branch/current green CI. Preserve inherited or new CI failures explicitly; documentation checks do not establish runtime acceptance.
- Do not add hashes, frozen contracts, baselines or gates by default, or remove existing safeguards. Any new mechanism needs a concrete failure and an explanation of why Git, versions, keys, transactions, uniqueness, types and ordinary tests are inadequate; gates belong at irreversible, cross-system, security or formal-release boundaries.
