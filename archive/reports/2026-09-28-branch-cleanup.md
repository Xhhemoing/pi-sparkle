# Merged branch cleanup verification — 2026-09-28

## Identity

- Task: `TASK-20260928-branch-cleanup`; [plan](../superpowers/plans/2026-09-28-branch-cleanup.md).
- Environment: Windows, PowerShell 7, `E:/Project/pi-sparkle`, 2026-09-28 (Asia/Shanghai).
- Author/executor: Codex coordinator, acting on the user's explicit branch-cleanup request.
- Starting main: `ccb8b3422dd182ba1db4211e303c4acd42c10a4e` locally and on origin.
- State: scoped branch cleanup verified; five local pointers and one remote pointer deleted.

## Commands

| Command | Result | Evidence |
|---|---|---|
| `git fetch --all --prune`; `git branch --merged main`; `git ls-remote --heads origin` | PASS | Six merged feature branches; retain dirty O09 and remove five clean/unused pointers |
| Per-worktree `git status --porcelain=v1 --untracked-files=all` and ignored-entry inventory | PASS | All 12 worktrees recorded in local `before.json`; B0/S0/sync candidates clean |
| `gh pr list --state open`; `gh pr view 46 --json state,headRefName,headRefOid,mergeCommit,mergedAt` | PASS | No open PRs; #46 MERGED with unchanged head `ce529a4d` |
| `gh run view 36383676551 --json status,conclusion,headSha,url` | PASS | Completed/success on starting main `ccb8b342`; prior integration CI, not a cleanup-specific test |
| `git switch --detach <same-tip>` (three clean worktrees); `git branch -d <branch>` (five branches); expected-ref remote deletion; `git fetch origin --prune` | PASS | Actual Git success output retained in `operations.log`; remote now has only main |
| Post-operation branch/worktree/stash comparison | PASS | Local 15 -> 10; remote 2 -> 1; all 12 paths/HEADs retained; nine feature refs unchanged; non-root statuses/ignored entries and both stash identities unchanged (`after.json`) |
| Root changed-file review | PASS | Only this report, its plan and active task files; no source/test/config changes |
| `pnpm workflow:check`; `git diff --check` | PASS | `workflow-check: ok (10 required files, 16 required headings)`; diff check exit 0 |
| Full runtime gate, provider/crash/benchmark/holdout runs | NOT RUN | Maintenance/docs-only work; no runtime changes or experimental authorization |

## Deleted Branches and Recovery

| Scope | Branch | Preserved commit in main |
|---|---|---|
| Local | `codex/controlled-improvement-20260925` | `e1ce19c0f93d8e34e7ca25512c5d32d2743ba669` |
| Local | `codex/controlled-improvement-b0-20260925` | `e1ce19c0f93d8e34e7ca25512c5d32d2743ba669` |
| Local | `codex/controlled-improvement-s0-min-20260925` | `d095a099be4461d83818a0d06e5b7f7fa06d828e` |
| Local | `codex/reliability-optimization-20260927` | `8ccdc1f962d867da9bedaf5d6a39bac989e65d7e` |
| Local | `codex/sync-merge-20260928` | `bb6d59c82467954c77a414f7bfe939623cb4b51a` |
| Remote | `codex/report-plan-phase-a-20260927` | `ce529a4def48989a03734a2b06c64aaf701b9b7d` |

Local deletion uses `git branch -d`; remote deletion uses `git push --force-with-lease=refs/heads/codex/report-plan-phase-a-20260927:ce529a4def48989a03734a2b06c64aaf701b9b7d origin :refs/heads/codex/report-plan-phase-a-20260927`. The lease conditions this deletion on the inspected tip and does not rewrite main or another branch's history.

Recreate any local pointer with `git branch <name> <commit>`; all target commits remain reachable from main. A deleted remote pointer can be recreated with `git push origin <commit>:refs/heads/<name>` if needed.

## Preserved Work

- Unmerged branches: `codex/ci-e1-20260925`, `codex/ci-e1-support-20260925`, `codex/ci-e2-20260925`, `codex/ci-n1-20260925`, `codex/ci-n3-20260925`, `codex/controlled-improvement-d1-20260925`, `codex/offline-fixes-20260925`, `codex/stage0-review-20260924`. Prior integration previews found conflicts; deletion is deferred until reconciliation and any required human conflict review.
- Merged but dirty `codex/offline-determinism-o09`: four draft paths retained. Dirty stage0-review: four paths retained. Detached reconstruction worktree: 34 paths retained.
- Stashes retained verbatim: `c967dcf3391d9c0dd5b7e530e9669752cc9c0e3e` (original planning drafts) and `b484c3e2c0af33577316d10f518e31002300f6f1` (unfinished O02).
- B0/S0/sync worktree directories, files, ignored data and registrations are retained; only their clean HEAD attachments change to detached at the same commit.

## Risks and Handoff

No independent code review is claimed for pointer cleanup; author-run Git verification is distinct from the prior independent source review. No source/contracts change and no new hash, baseline, freeze or gate is introduced. S0 owner freeze, D1/L1/L2, O02/O03, R10/R11, F6 and production/live-provider acceptance remain open.

Remaining branch owners/maintainer should reconcile unique work before later deletion. To resume in a detached retained worktree, create an appropriately named new branch first. Do not reapply either stash blindly onto main; inspect its scope and conflicts first.

Changed tracked files are limited to this report, its plan, `tasks/plan.md` and `tasks/todo.md`. Local evidence: `.agent_workspace/branch-cleanup-20260928/before.json`, subsequent operation log and verification inventory. Publication procedure: commit these four reviewed documentation files, use a normal `git push origin main`, and verify local/remote main plus clean root state in `.agent_workspace/branch-cleanup-20260928/publication.json`. This record does not claim a new runtime gate or hosted run for the documentation commit.
