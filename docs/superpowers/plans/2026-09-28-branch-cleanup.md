# Merged branch cleanup — 2026-09-28

## Identity

- ID: `TASK-20260928-branch-cleanup`
- Owner: Codex coordinator; user explicitly requested local/GitHub branch cleanup.
- State: `accepted` for the scoped branch cleanup; unfinished work and owner gates remain open.
- Date opened: 2026-09-28 (Asia/Shanghai).
- Authority: `AGENTS.md`, development workflow, active tasks and the [completed sync record](../../reports/2026-09-28-sync-merge.md).

## Problem and Scope

Remove redundant branch pointers after the verified integration. Starting local and remote main are `ccb8b3422dd182ba1db4211e303c4acd42c10a4e`; its hosted CI run `36383676551` completed successfully. Fresh fetch found no open PRs and PR #46 is MERGED.

In scope: delete five fully merged local branches and the unchanged merged PR #46 remote branch. Detach three clean worktrees at their exact existing commits before deleting their branch pointers; retain their files, ignored evidence, dependencies and worktree registration.

Out of scope: unmerged branches, dirty worktrees, stash changes, worktree/directory removal, source edits, history rewriting, and acceptance of any open runtime/owner/experiment gate.

## Acceptance Criteria

- [x] Verify every deletion target is an ancestor of current main and has no new remote work.
- [x] Delete exactly five eligible local branches and one merged remote branch; preserve main.
- [x] Preserve all 12 worktree paths/HEADs, nine retained feature branches, dirty statuses and both stash objects.
- [x] Verify only cleanup documentation changed; run `pnpm workflow:check` and `git diff --check`.
- [x] Record exact outcomes and recovery instructions in the tracked plan/report/checklist.

## Implementation Slice

| Target | Change | Dependency/risk |
|---|---|---|
| `codex/controlled-improvement-20260925`, `codex/controlled-improvement-b0-20260925` | Delete merged local pointers | Both at `e1ce19c0`; B0 worktree detached at same commit |
| `codex/controlled-improvement-s0-min-20260925` | Delete merged local pointer | `d095a099`; clean worktree detached; owner freeze remains open |
| `codex/reliability-optimization-20260927` | Delete merged local pointer | `8ccdc1f9`; unfinished O02 remains in existing stash |
| `codex/sync-merge-20260928` | Delete merged local pointer | `bb6d59c8`; clean worktree detached with ignored logs retained |
| Remote `codex/report-plan-phase-a-20260927` | Delete merged PR #46 pointer | Expected tip `ce529a4def48989a03734a2b06c64aaf701b9b7d`; use exact-ref lease |
| This plan, dated report, `tasks/plan.md`, `tasks/todo.md` | Durable plan, verification and handoff | Documentation only; preserve historical records |

## Test-First Plan

No runtime behavior changes; no new regression test applies. Use actual Git operations and fresh inventories as acceptance evidence.

- Focused: `git fetch --all --prune`, `git merge-base --is-ancestor <tip> main`, `git status --porcelain=v1 --untracked-files=all` per worktree, `gh pr view 46`, `gh pr list --state open`.
- Execute: `git -C <clean-worktree> switch --detach <existing-tip>`, then `git branch -d <branch>`; delete remote only with an exact expected-ref lease.
- Verify: `git branch -vv`, `git ls-remote --heads origin`, `git worktree list --porcelain`, `git stash list`, before/after worktree comparison, `pnpm workflow:check`, `git diff --check`.
- Full runtime gate: not applicable to this maintenance/docs-only task; previous runtime gate evidence remains historical.

## Gates and Handoff

Abort deletion of any target whose tip, ancestry, clean status or PR status changed. Never discard dirty state. Retain the eight conflict-bearing branches and dirty O09 branch; preserve both stashes and the detached dirty reconstruction worktree. Do not retire worktrees because this request concerns branch pointers and ignored evidence must remain available.

Recover a deleted branch with `git branch <original-name> <recorded-tip>`; all deleted tips remain reachable from main. Recreate the remote branch only if needed with `git push origin <recorded-tip>:refs/heads/<original-name>`.

## Closeout

Verified 2026-09-28: five local branches and one remote branch deleted; local branches 15 -> 10 and remote branches 2 -> 1. At post-deletion verification before the documentation commit, all 12 worktree paths/HEADs, nine retained feature refs, dirty statuses, non-root ignored-entry inventories and both stash objects match the pre-operation inventory. Only four documentation files changed. `pnpm workflow:check` PASS (10 required files, 16 required headings); `git diff --check` PASS. [Verification record](../../reports/2026-09-28-branch-cleanup.md). Local inventories/logs: `.agent_workspace/branch-cleanup-20260928/`; publication refs are recorded there after the normal documentation push.
