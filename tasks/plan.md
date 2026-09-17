# Active implementation plan

Process entry point: [`AGENTS.md`](../AGENTS.md) -> [`docs/development-workflow.md`](../docs/development-workflow.md) -> [`tasks/README.md`](README.md). Keep this file for active scope and links; record dated evidence in the checklist or a report.

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

## Grok follow-up — trusted execution (2026-09-13)

`TASK-20260913-grok-trusted-execution` / `TASK-20260913-grok-review-repair`: **Latest re-review (2026-09-14): REQUEST CHANGES on full local candidate `412230aa6421a126c63dba964e322ae7ebd7b763`.** [Re-review and continuation prompt](../docs/reports/2026-09-14-grok-repair-rereview.md): unchanged original regressions now 5/5 pass; focused 57/57; gate 2767 pass / 0 fail / 18 skip. Three new boundary probes fail: rename source identity (RR1), empty/corrupt event-log acceptance (RR2), zero execution timeout (RR4). Do not repeat the four original fixes; finish these residuals and controlled lifecycle tests. PR #42 remains OPEN at `5357163` (only R3/R1), while R2/R4 exist in the local full candidate; remote main remains `fe253301`. SCM must align the delivered PR head with the verified full artifact. [Prior review](../docs/reports/2026-09-13-grok-trusted-execution-review.md) and [original repair prompt](../docs/superpowers/plans/2026-09-13-grok-review-repair-prompt.md) are historical evidence, not the current failure count. No new implementation, dispatch, push, merge or experiment was performed by this re-review; preserve dirty worktrees and keep F6 NOT READY.

## SoL-Pi efficiency handoff (2026-09-13)

`TASK-20260913-sol-pi-efficiency`: [initial Grok bot task plan](../docs/superpowers/plans/2026-09-13-sol-pi-grok-handoff.md). **Latest live verification (2026-09-13 08:22 UTC): PR-A → B → HOTFIX → P3 → P4 → P5 merged through [PR #36](https://github.com/Xhhemoing/pi-sparkle/pull/36), head `4804d4c625559b58675a4726bbdd43eeecb78e4c`, remote main `6ee16a3722fda35d9b6098144602f199fb0a7d0f`.** Three hosted CI checks report SUCCESS; merge parents include the exact head and merge/head trees match. [Delivery status and evidence boundary](../docs/reports/2026-09-13-sol-efficiency-delivery-status.md) preserves the earlier unmerged snapshot and records the correction. Next: SCM/xhh completes independent-review/authorization evidence; local owner reconciles dirty HOTFIX/workflow changes before syncing main (local HEAD remains `8dd31e9`). Do not reimplement the merged chain. F6 seal/real-provider holdout, extension/live-adaptation and Outcome-supported remain separately gated; merged implementation is not experimental acceptance.
