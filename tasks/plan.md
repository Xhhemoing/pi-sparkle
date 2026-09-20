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

Native integration: `TASK-20260918-native-pi` is in progress under the [native Pi plan](../docs/superpowers/plans/2026-09-18-native-pi.md). Owner approved quality-first, preferred `cursor-grok-4.6-fast`, and modification scope B (global Pi configuration included; credentials/permissions excluded). ADR-006 was revisited and Accepted for the inbound adapter. Read-only native delegation, the retained isolated-write/independent-acceptance slice, and the candidate-application slice (`NativeApplySession`, 2026-09-19, [report](../docs/reports/2026-09-19-native-apply.md)) are locally verified. Host-facing registration of the apply session, unified quality routing, and live projection remain follow-ups gated on independent review and human authorization. Checkpoint F still gates online adaptive selection and Outcome-supported claims. Background architecture: [Pi intelligent adaptive loop report](../docs/reports/pi-intelligent-adaptive-loop.md).

## SoL-Pi efficiency line (merged) — PR-A / PR-B / PS-HOTFIX / PS-P3 / PS-P4 / P5 (2026-09-12/13)

Merged via PR #36 into remote main. Facts and per-slice scope (from the `grok/sol-efficiency` delivery):

- **PR-A harness-efficiency**: offline JSONL aggregator + thin CLI (`scripts/analyze-harness-efficiency.ts`). Does not touch the runtime CLI, ExecutionEvent, or observation store (PR-B).
- **PR-B observation store + offline projection**: run-scoped content-addressed observation archive + pure projection/recall. No live Pi executor / CLI main wiring. Privacy class `run-observation` registered; `deleteRunRecords` cascade covers the archive via the run subtree rm.
- **PS-HOTFIX provider failure attribution** (`ed9a6e9`): provider/env failures synthesize `verification: UNOBSERVED` + `failure.category: PROVIDER_ERROR` (FailureClass `provider`) so they never enter deterministic `taskSuccess` FAIL / model bandit poisoning. Real agent-reported FAILED-with-evidence remains model-attributable. NOTE: this repo's hotfix line (`5256339` on `cursor/ps-hotfix-provider-fail-attribution`) is an independent fix of the same issue; see the merge-commit reconciliation.
- **PS-P3 real closed loop** (`950b9ef`): isolated worktree + worktree-scoped coding tools + independent command check + run-scoped loop artifacts + acceptance that fails closed on self-report alone. Tool injection at `createConfiguredPiExecutor` / `PiAgentExecutor` `options.tools` (not prompt-only).
- **PS-P4 trusted experiments (F6 hard gate)** (`d84cfc0`): equivalent R0/R1 taskSpec compile, freeze, observation-ledger dedupe, independent oracle, evidence retention keep-raw. No F6 promotion.
- **PS-P5 efficiency** (`4804d4c`): incremental checkpoint replay, event aggregation, duty splits.

Delivery evidence: [delivery status](../docs/reports/2026-09-13-sol-efficiency-delivery-status.md). Independent Reviewer room PASS artifacts are not on the GitHub reviews API (see G0 report). Do not reimplement the merged chain. F6 seal/holdout, extension/live-adaptation and Outcome-supported remain separately gated.


## Delivery gate coordination (2026-09-18) — CLOSED 2026-09-20

**All three delivery PRs merged on 2026-09-20:** #42 (`b1f2ee8`; independent review by luna-fast found the RUN_CREATED payload identity P1, fixed in `928995d`, delta PASS), #43 (`7bdc591`; owner-completed human conflict review per the packet), #44 (`bb62d792`; native Pi integration, independent review PASS after process/hygiene fixes). Post-merge cleanup 2026-09-20: 18 merged local branches deleted (merge-base verified), 19 worktrees removed (r-fix dirty draft archived at `.agent_workspace/archived/r-fix-draft-5357163-2026-09-20.patch`), review worktrees disposed. Remaining open: SCM/xhh #36 evidence request (unresolved), remote stale branch deletion (owner call), F6 prerequisites (parked).

Progress 2026-09-20: PR #42 independent review **executed** (owner-designated luna-fast): full review of `aeb4993` returned REQUEST CHANGES on exactly one P1 (RUN_CREATED payload identity gap in `assertRunPresent`); fix `928995d` implemented RED→GREEN, delta re-review **PASS** (evidence: [review record](../docs/reports/2026-09-20-rr-review-luna.md)). Owner authorized push; remote PR #42 head is now `928995d` (fast-forward `aeb4993..928995d`, verified via ls-remote). Remaining: CI green + owner merge authorization on GitHub.

`TASK-20260918-delivery-gate-unblock`: [plan](../docs/superpowers/plans/2026-09-18-delivery-gate-unblock.md), [evidence and requests](../docs/reports/2026-09-18-delivery-gate-unblock.md). PR #43 `7c908ee` remains OPEN with green CI; the required human conflict review is prepared as a [line-by-line packet](../docs/reports/2026-09-20-pr43-conflict-review-packet.md) (2026-09-20) — owner completes the A/B/C checkboxes, then merges. Native branch `feat/native-pi-slices` (baseline `13f954e`, committed 2026-09-20, focused 32/32) opens its PR only after #42 and #43 merge; file intersection with PR #42 verified empty 2026-09-20. PR #42/#43 remain OPEN pending owner merge; SCM/xhh evidence requested on #36. F6 preparation: complete custodian-held 100+15 materials, SM95 key metadata, bind existing ESTIMATE prices, then gated seal. Three dirty temp trees preserved pending PASS and approved disposal manifest.

## Grok follow-up — trusted execution (2026-09-13)

`TASK-20260913-grok-trusted-execution` / `TASK-20260913-grok-review-repair`: re-review 2026-09-14 returned REQUEST CHANGES on full local candidate `412230a`; all RR residuals (RR1/RR2/RR4) fixed 2026-09-16 and delivered as commit `aeb4993` (fast-forward onto PR #42, [review package](../docs/reports/2026-09-16-rr-fix-review-package.md)). PR #42 head `aeb4993` carries the full candidate; hosted CI green (rerun 2026-09-17). Remaining: independent review PASS + owner authorization, then merge. Author-run same-head evidence (5 old + 3 new regressions, focused 61, gate 2771, probes) completed 2026-09-17 on a fresh checkout; independent review dispatch failed on provider quota (402) and remains with the owner / Grok bot. F6 stays NOT READY; no provider/holdout/seal runs performed on this line.
