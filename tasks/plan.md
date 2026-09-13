# Active implementation plan

Process entry point: [AGENTS.md](../AGENTS.md) -> [docs/development-workflow.md](../docs/development-workflow.md) -> [	asks/README.md](README.md). Keep this file for active scope and links; record dated evidence in the checklist or a report.
Completed runtime M0–M2.5 and accepted adaptive slices were archived on 2026-08-17:

- [M0–M2.5 plan](archive/m0-m2-plan.md)
- [Acceptance record](archive/ACCEPTANCE-2026-08-17.md)
- [Full M3–M6 snapshot](archive/adaptive-plan-full.md)

The live adaptive remainder is [adaptive-plan.md](adaptive-plan.md). Checklist: [todo.md](todo.md) and [adaptive-todo.md](adaptive-todo.md).

Final spec (implement this): [2026-08-18-three-line-final.md](../docs/superpowers/specs/2026-08-18-three-line-final.md).
Project plan: [2026-08-18-three-line-project.md](../docs/superpowers/plans/2026-08-18-three-line-project.md).
Phase A: [2026-08-18-phase-a-tracking-supervisor.md](../docs/superpowers/plans/2026-08-18-phase-a-tracking-supervisor.md).
Phase B: [2026-08-18-phase-b-outcome-r1.md](../docs/superpowers/plans/2026-08-18-phase-b-outcome-r1.md).
Phase C: [2026-08-18-phase-c-offline-attribution.md](../docs/superpowers/plans/2026-08-18-phase-c-offline-attribution.md).
Phase D: [2026-08-18-phase-d-promotion-cas.md](../docs/superpowers/plans/2026-08-18-phase-d-promotion-cas.md).

Unplanned code already in the tree (`src/track/`, `src/cluster/`, `src/learning/auto-loop.ts`, `src/graph/compile-children.ts`) is **not** treated as a closed plan. It stays until it has its own accepted spec or is folded into the remaining adaptive work.

Next architecture (not yet a task plan): [Pi intelligent adaptive loop report](../docs/reports/pi-intelligent-adaptive-loop.md) Phases 0–5, gated on ADR-006 (Proposed) and Checkpoint F.

## PR-A harness-efficiency (2026-09-12)

Offline JSONL aggregator + thin CLI on `grok/sol-efficiency`. Does not touch the runtime CLI, ExecutionEvent, or observation store (PR-B).

## PR-B observation store + offline projection (2026-09-13)

Run-scoped content-addressed observation archive + pure projection/recall on `grok/sol-efficiency`. No live Pi executor / CLI main wiring. Privacy class `run-observation` registered; `deleteRunRecords` cascade covers the archive via the run subtree rm.

## PS-HOTFIX provider failure attribution (2026-09-12)

On tip after PR-A+PR-B (`da38a44`). Provider/env failures synthesize `verification: UNOBSERVED` + `failure.category: PROVIDER_ERROR` (FailureClass `provider`) so they never enter deterministic `taskSuccess` FAIL / model bandit poisoning. Real agent-reported FAILED-with-evidence remains model-attributable.

## PS-P3 real closed loop (2026-09-12 / 2026-09-13)

Isolated worktree + worktree-scoped coding tools + independent command check + run-scoped loop artifacts + acceptance that fails closed on self-report alone. Tool injection at `createConfiguredPiExecutor` / `PiAgentExecutor` `options.tools` (not prompt-only). Does not flip `independentEvidence` from child self-report. No P4/P5/Soul; no merge.

## Grok follow-up — trusted execution (2026-09-13)

`TASK-20260913-grok-trusted-execution`: [next-round plan](../docs/superpowers/plans/2026-09-13-grok-trusted-execution.md). Research base: merged PR #36 / remote main `6ee16a3722fda35d9b6098144602f199fb0a7d0f`. Sequence: G0 reproducible workflow baseline → G1A independent acceptance/content binding → G1B tool/artifact boundaries → G2 real-adapter offline loopback. G3 inventories F6 readiness (report-only). Do not repeat A/B/HOTFIX/P3/P4/P5. Active seat work starts at G0 on branch `grok/trusted-execution-g0`.

## SoL-Pi efficiency delivery (2026-09-13)

`TASK-20260913-sol-pi-efficiency` merged via [PR #36](https://github.com/Xhhemoing/pi-sparkle/pull/36): head `4804d4c625559b58675a4726bbdd43eeecb78e4c`, remote main `6ee16a3722fda35d9b6098144602f199fb0a7d0f`. Evidence: [delivery status](../docs/reports/2026-09-13-sol-efficiency-delivery-status.md). Independent Reviewer room PASS artifacts / GitHub reviews: see G0 report (unavailable on GitHub reviews API). Do not reimplement the merged chain.
