# Pending local review — 2026-09-12 (superseded 2026-09-17)

## Status (2026-09-17)

This note is historical. Current facts: PS-P1/P2 combo merged (PR #35); the SoL efficiency chain merged via PR #36 including its own HOTFIX `ed9a6e9`; the independent hotfix on this repo's line committed as `5256339` on `cursor/ps-hotfix-provider-fail-attribution` and reconciled with `ed9a6e9` in the 2026-09-17 origin/main merge (main's `taskFailureForProvider` with `PROVIDER_ERROR` category retained; both synthesize UNOBSERVED verification, never FAILED-with-empty-evidence). G0–G3 merged via PRs #37–#41; remote main `fe253301`. Soul M0-3 G-W remained blocked on xhh VS 2022 Build Tools as of the last note.

## Original note (2026-09-12)

- **PS-P1 / PS-P2 / combo**: merged to `main` @ `8dd31e9` (Heidi authorized).
- **PS-HOTFIX Provider 失败归因**: in flight — `finish()` must not synthesize `verification: FAILED` (empty evidence) on provider fail; use `UNOBSERVED` + `failure` classification so `taskSuccess` / bandit / diagnostics do not treat infra failures as model FAIL.
- **Soul M0-3 G-W**: blocked on xhh VS 2022 Build Tools (Ops winget); script parse + MSVC fail-fast staged locally on Soul branch.

Earlier notes that marked **P1 BLOCKED** are obsolete after the combo merge.
# Pending local review (2026-09-12)

Status note for the `grok/sol-efficiency` worktree. **Do not leave stale “P1 BLOCKED” text.**

## Merged upstream

- **P1/P2 combo** merged at `8dd31e9` (`Merge pull request #35 from Xhhemoing/cursor/ps-p1-p2-combo`).
- P1 is **not** blocked on this branch tip.

## This branch tip stack

| Slice | Commit | Notes |
| --- | --- | --- |
| PR-A harness-efficiency | `51e906d` | Offline aggregator + CLI |
| PR-B observation store | `da38a44` | Run-scoped store + projection |
| **PS-HOTFIX** provider fail attribution | `ed9a6e9` | Provider/env fail → UNOBSERVED + `provider` FailureClass; no model taskSuccess poison |
| **PS-P3** real closed loop | `950b9ef` | Isolated worktree + coding tools + independent check + acceptance; self-report alone ≠ PASS; gate green |
| **PS-P4** trusted experiments | *(this tip after P4 commit)* | Equivalent R0/R1 compile, freeze, ledger dedupe, oracle task-vs-collect, keep-raw evidence; gate green; no F6 promotion |

## Reviewer asks

- Review HOTFIX + PR-A/PR-B on `grok/sol-efficiency`.
- PS-P3 closed loop at `950b9ef`; PS-P4 trusted experiments on this tip; gate green; freeze tip for Reviewer (no merge).
- No push / no merge from this worktree; no Soul / no P5.

