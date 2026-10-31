# GitHub/local synchronization and branch cleanup — 2026-09-29

## Identity

- ID: `TASK-20260929-sync-cleanup`.
- Owner: Codex, on the user's explicit synchronization/branch-cleanup request.
- State: `accepted` for the verified source synchronization and scoped branch cleanup.
- Date: 2026-09-29 (Asia/Shanghai).
- Authority: `AGENTS.md`, development workflow, current task files and the 2026-09-28 cleanup record.

## Problem and Scope

The clean local main was 15 commits behind GitHub: `6ef6a048` -> `b114255b`. PR #47 and PR #48 are merged; their remote branches still exist. Fast-forward main, remove their redundant remote pointers, prune local tracking refs, and publish this maintenance record.

Preserve all nine local feature branches, all 12 worktree directories, dirty drafts and both existing stashes. Eight feature branches have commits outside main; merged O09 still has four uncommitted draft paths. They are not disposable work. No new source changes, unfinished-branch integration/publication, worktree deletion, history rewrite or runtime/owner-gate acceptance is in scope.

## Acceptance Criteria

- [x] Local main and GitHub main agree after source synchronization; documentation publication is verified separately.
- [x] Delete exactly the two unchanged, merged remote pointers and prune their tracking refs; GitHub retains main.
- [x] All nine retained local feature tips, non-root worktree HEAD/status inventories, all worktree paths and both stash identities remain unchanged.
- [x] `pnpm workflow:check` and `git diff --check` pass; inspect only the four maintenance documentation files in the publication diff.
- [x] Save exact results, retained-work reasons and recovery instructions in the report and active task entries.

## Implementation Slice

| Target | Change | Dependency/risk |
|---|---|---|
| Local main | Fast-forward to fetched main `b114255bd815617068b3b46bfb3848eac0b8e6e5` | Root must be clean; already-merged upstream source only |
| Remote `codex/report-execution-20260929` | Delete merged PR #47 pointer | Expected tip `972a39beb0bcbe61c39606c00ce42f283350dd66` |
| Remote `codex/evidence-provenance-20260929` | Delete merged PR #48 pointer | Expected tip `f856b2973548aced684671654a50ec98e1403dba` |
| This plan, matching report, `tasks/plan.md`, `tasks/todo.md` | Record source synchronization, pointer cleanup and preservation | Documentation only; preserve historical statements and independent acceptance boundaries |

## Test-First Plan

No new runtime behavior is implemented. Git's actual operations and before/after state are the focused acceptance evidence; no new regression test is needed.

Commands: `git fetch origin --prune`; `git merge --ff-only origin/main`; `gh pr view 47` / `48`; `gh pr list --state open`; `git merge-base --is-ancestor <tip> main`; atomic remote deletion with exact expected-ref leases; `git fetch origin --prune`; `git ls-remote --heads origin`; per-worktree `git status --porcelain=v1 --untracked-files=all`; branch/stash comparison; `pnpm workflow:check`; `git diff --check`.

Full runtime gate and provider/crash/benchmark/holdout runs are not rerun for maintenance; upstream source CI remains separate evidence. No runtime verification or independent review is inferred from pointer cleanup.

## Gates and Handoff

Abort deletion if a tip changes, a PR reopens, ancestry fails or ownership is uncertain. Use a normal non-force main push. Preserve dirty work and unresolved branches. Restore a deleted branch with `git branch <name> <recorded-tip>` and, if needed, `git push origin <recorded-tip>:refs/heads/<name>`; tips remain reachable from main.

## Closeout

Verified at source `b114255b`: fast-forward of 15 commits; two merged remote pointers deleted and tracking refs pruned; all nine local feature refs, all 12 worktree paths, non-root HEAD/status inventories and both stashes preserved. `pnpm workflow:check` PASS (10 required files, 16 required headings); `git diff --check` PASS. Only four maintenance documentation files changed. Final documentation-publication refs and clean-root check will be recorded in local `publication.json` after the normal push. Local operational plan and inventories: `.agent_workspace/sync-cleanup-20260929/`. Tracked verification: `docs/reports/2026-09-29-sync-cleanup.md`. Remaining feature-branch owners must reconcile unique work/dirty drafts before later deletion; all existing owner, experiment and production boundaries remain open.
