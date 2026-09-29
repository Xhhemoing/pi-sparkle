# Synchronization and branch cleanup verification — 2026-09-29

## Identity

- Task: `TASK-20260929-sync-cleanup`; [plan](../superpowers/plans/2026-09-29-sync-cleanup.md).
- Executor: Codex, on the user's explicit request; Windows / PowerShell 7 / Asia/Shanghai.
- Local source before: `6ef6a04882ed5a42fa5dae1d37f77b0c48e64689`.
- Synchronized source: `b114255bd815617068b3b46bfb3848eac0b8e6e5`, 15 commits ahead; fast-forward only.

## Commands

| Command | Result | Evidence |
|---|---|---|
| `git fetch origin --prune`; `git rev-list --left-right --count main...origin/main` | PASS | Before sync: 0 local-only / 15 remote-only commits |
| `git merge --ff-only origin/main` | PASS | Local main advanced to `b114255b`; no new runtime edits or conflict resolution |
| `gh pr view 47` / `48`; `gh pr list --state open`; `git merge-base --is-ancestor <tip> main` | PASS | Both target PRs MERGED; no open PRs; both tips reachable from main |
| Atomic remote deletion with the two exact-ref leases below | PASS | Git confirmed both branch deletions |
| `git fetch origin --prune`; `git ls-remote --heads origin` | PASS | GitHub retains only main at synchronized source; both obsolete local remote-tracking refs removed |
| Fresh branch/worktree/stash inventories compared to initial inventory | PASS | All nine local feature refs, all 12 worktree paths, all 11 non-root HEAD/status inventories and both stash identities unchanged |
| `pnpm workflow:check`; `git diff --check` | PASS | workflow-check: ok (10 required files, 16 required headings); diff check exit 0 |
| Full runtime gate; provider/crash/benchmark/holdout runs; independent source review | NOT RUN | Maintenance/documentation only; existing upstream source verification is not claimed as this task's fresh verification |

## Deleted Remote Branches and Recovery

| Branch | Merged PR | Preserved commit in main |
|---|---|---|
| `codex/report-execution-20260929` | #47 | `972a39beb0bcbe61c39606c00ce42f283350dd66` |
| `codex/evidence-provenance-20260929` | #48 | `f856b2973548aced684671654a50ec98e1403dba` |

Exact deletion command:

```text
git push --atomic --force-with-lease=refs/heads/codex/report-execution-20260929:972a39beb0bcbe61c39606c00ce42f283350dd66 --force-with-lease=refs/heads/codex/evidence-provenance-20260929:f856b2973548aced684671654a50ec98e1403dba origin :refs/heads/codex/report-execution-20260929 :refs/heads/codex/evidence-provenance-20260929
```

The leases protect against newly advanced remote tips; main history was not rewritten. Recreate a local pointer using `git branch <name> <recorded-tip>` or the remote pointer using `git push origin <recorded-tip>:refs/heads/<name>` if needed.

## Retained Local Work

No local feature branch was safe to remove. Eight still have commits outside main; this count describes Git ancestry, not an assertion that every patch is unique:

| Local branch | Commits outside main |
|---|---:|
| `codex/ci-e1-20260925` | 10 |
| `codex/ci-e1-support-20260925` | 12 |
| `codex/ci-e2-20260925` | 20 |
| `codex/ci-n1-20260925` | 10 |
| `codex/ci-n3-20260925` | 23 |
| `codex/controlled-improvement-d1-20260925` | 2 |
| `codex/offline-fixes-20260925` | 28 |
| `codex/stage0-review-20260924` | 5 |

Merged `codex/offline-determinism-o09` still owns four uncommitted draft paths and is retained. Stage0-review has four dirty paths; the detached B0 reconstruction tree has 34. No worktree directory, ignored dependency/evidence data, draft or stash was removed. Local branch count remains 10 (main plus nine feature branches); remote branch count changed from 3 to 1.

Stash identities retained: `c967dcf3391d9c0dd5b7e530e9669752cc9c0e3e` (original planning drafts), `b484c3e2c0af33577316d10f518e31002300f6f1` (unfinished O02).

## Integration Status and Handoff

Fresh GitHub metadata confirms PR #47 merged as `4df5baff7f2ed3cec1dbc5fe8db3562b4eb61cf7` and PR #48 as `b114255bd815617068b3b46bfb3848eac0b8e6e5` on 2026-09-29. This dated source-integration evidence supersedes earlier branch-only/main-merge-pending snapshots. It does not grant independent source acceptance, S0-min owner freeze, experiment/production authorization or Outcome-supported status.

Remaining branch owners/maintainer must reconcile unfinished/conflicting work and dirty drafts before later deletion; do not blindly reapply retained stashes. No new hash, freeze, baseline or gate was introduced.

Only this report, its plan, `tasks/plan.md` and `tasks/todo.md` are authored by this maintenance task. Local command evidence and inventories: `.agent_workspace/sync-cleanup-20260929/{plan.md,before.json,sync.log,pr-47.json,pr-48.json,deletion.log,after.json}`. Publish the four reviewed documentation files via a normal `git push origin main`; final main equality/clean-status verification is recorded locally in `publication.json` after the push, avoiding a self-referential commit claim.
